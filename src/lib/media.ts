export type OutputMode = 'compress' | 'convert' | 'audio';
export type VideoFormat = 'mp4' | 'webm';
export type Resolution = 'original' | '1080' | '720' | '480' | '360';
export type AudioFormat = 'mp3' | 'wav';

export interface MediaMetadata {
  duration: number;
  width: number;
  height: number;
}

export interface ConversionSettings {
  mode: OutputMode;
  videoFormat: VideoFormat;
  resolution: Resolution;
  targetSizeMb: number | null;
  audioBitrateKbps: 96 | 128 | 192 | 256 | 320;
  audioFormat: AudioFormat;
  quality: 'smaller' | 'balanced' | 'higher';
}

export interface Recommendation {
  title: string;
  description: string;
  mode: OutputMode;
  reason: string;
}

const QUALITY_CRF: Record<ConversionSettings['quality'], number> = {
  smaller: 30,
  balanced: 25,
  higher: 21,
};

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '—';
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / 1024 ** index;
  return `${value.toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
}

export function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '—';
  const total = Math.floor(seconds);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`
    : `${minutes}:${String(secs).padStart(2, '0')}`;
}

/**
 * Estimate an average video bitrate for a target output size.
 * FFmpeg's -b:v value is in kbit/s. We reserve audio bitrate plus 8% for
 * container overhead. The final file size is an estimate, not a guarantee.
 */
export function calculateVideoBitrateKbps(
  targetSizeMb: number,
  durationSeconds: number,
  audioBitrateKbps: number,
): number {
  if (!Number.isFinite(targetSizeMb) || targetSizeMb <= 0) {
    throw new Error('Target size must be greater than zero.');
  }
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
    throw new Error('Video duration must be greater than zero to calculate a target bitrate.');
  }
  if (!Number.isFinite(audioBitrateKbps) || audioBitrateKbps < 0) {
    throw new Error('Audio bitrate must be zero or greater.');
  }

  const totalKbits = targetSizeMb * 1024 * 8;
  const totalKbps = totalKbits / durationSeconds;
  const usableKbps = totalKbps / 1.08 - audioBitrateKbps;
  if (!Number.isFinite(usableKbps)) {
    throw new Error('Target size is outside the supported range.');
  }
  if (usableKbps < 80) {
    throw new Error('That target is too small for this video duration. Choose a larger size.');
  }
  return Math.floor(usableKbps);
}

export function getRecommendations(file: File, metadata: MediaMetadata | null): Recommendation[] {
  const suggestions: Recommendation[] = [];
  const mb = file.size / (1024 * 1024);
  const hasAudioName = /\.(mp3|wav|m4a|aac|ogg|flac)$/i.test(file.name);
  if (hasAudioName) return suggestions;

  if (mb >= 80) {
    suggestions.push({
      title: 'Make it easier to share',
      description: 'Compress to a smaller MP4 with H.264 video and AAC audio.',
      mode: 'compress',
      reason: `This file is ${formatBytes(file.size)}. A lower resolution or bitrate can reduce its size.`,
    });
  }
  if (metadata && metadata.width >= 1920) {
    suggestions.push({
      title: 'Create a 720p copy',
      description: 'Keep a clear picture while reducing the number of pixels.',
      mode: 'compress',
      reason: `The source is ${metadata.width}×${metadata.height}; 720p may be enough for everyday sharing.`,
    });
  }
  suggestions.push({
    title: 'Extract the audio',
    description: 'Save the soundtrack as an MP3 or a lossless WAV file.',
    mode: 'audio',
    reason: 'Useful for interviews, lectures, podcasts and music recordings.',
  });
  if (suggestions.length === 0) {
    suggestions.push({
      title: 'Convert to MP4',
      description: 'Create a widely compatible H.264 MP4 version.',
      mode: 'convert',
      reason: 'MP4 is a practical default for sharing across devices.',
    });
  }
  return suggestions;
}

export function buildFfmpegArgs(
  inputName: string,
  outputName: string,
  settings: ConversionSettings,
  durationSeconds: number,
): string[] {
  if (settings.mode === 'audio') {
    const args = ['-i', inputName, '-vn'];
    if (settings.audioFormat === 'mp3') {
      args.push('-c:a', 'libmp3lame', '-b:a', `${settings.audioBitrateKbps}k`);
    } else {
      args.push('-c:a', 'pcm_s16le');
    }
    args.push(outputName);
    return args;
  }

  const args = ['-i', inputName, '-map', '0:v:0', '-map', '0:a:0?'];
  if (settings.resolution !== 'original') {
    const height = Number(settings.resolution);
    args.push('-vf', `scale=-2:min(${height}\\,ih)`);
  }

  if (settings.videoFormat === 'mp4') {
    args.push('-c:v', 'libx264', '-preset', 'veryfast', '-pix_fmt', 'yuv420p');
    if (settings.targetSizeMb !== null && settings.mode === 'compress') {
      const videoBitrate = calculateVideoBitrateKbps(
        settings.targetSizeMb,
        durationSeconds,
        settings.audioBitrateKbps,
      );
      args.push('-b:v', `${videoBitrate}k`, '-maxrate', `${videoBitrate}k`, '-bufsize', `${videoBitrate * 2}k`);
    } else {
      args.push('-crf', String(QUALITY_CRF[settings.quality]));
    }
    args.push('-c:a', 'aac', '-b:a', `${settings.audioBitrateKbps}k`, '-movflags', '+faststart');
  } else {
    args.push('-c:v', 'libvpx', '-deadline', 'realtime', '-cpu-used', '5', '-pix_fmt', 'yuv420p');
    if (settings.targetSizeMb !== null && settings.mode === 'compress') {
      const videoBitrate = calculateVideoBitrateKbps(
        settings.targetSizeMb,
        durationSeconds,
        settings.audioBitrateKbps,
      );
      args.push('-b:v', `${videoBitrate}k`);
    } else {
      const crf = settings.quality === 'smaller' ? '38' : settings.quality === 'balanced' ? '32' : '26';
      args.push('-crf', crf, '-b:v', '0');
    }
    args.push('-c:a', 'libvorbis', '-b:a', `${settings.audioBitrateKbps}k`);
  }

  if (settings.mode === 'convert') {
    // Convert mode intentionally ignores a target-size setting if one is supplied.
  }
  args.push(outputName);
  return args;
}

export function outputFileName(inputName: string, _mode: OutputMode, format: VideoFormat | AudioFormat): string {
  const rawBase = inputName.replace(/\.[^.]+$/, '').replace(/[\\/:*?"<>|]/g, '_') || 'converted-video';
  const base = rawBase.startsWith('-') ? `video-${rawBase}` : rawBase;
  return `${base}.${format}`;
}

export function estimateSavingsPercent(originalBytes: number, outputBytes: number): number | null {
  if (originalBytes <= 0 || outputBytes < 0) return null;
  return Math.round((1 - outputBytes / originalBytes) * 100);
}
