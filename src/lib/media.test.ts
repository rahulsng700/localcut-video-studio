import { describe, expect, it } from 'vitest';
import {
  buildFfmpegArgs,
  calculateVideoBitrateKbps,
  estimateSavingsPercent,
  formatBytes,
  formatDuration,
  getRecommendations,
  outputFileName,
  type ConversionSettings,
} from './media';

const settings: ConversionSettings = {
  mode: 'compress',
  videoFormat: 'mp4',
  resolution: '720',
  targetSizeMb: 25,
  audioBitrateKbps: 128,
  audioFormat: 'mp3',
  quality: 'balanced',
};

describe('formatters', () => {
  it('formats bytes with binary units', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(1024)).toBe('1.0 KB');
    expect(formatBytes(1024 * 1024)).toBe('1.0 MB');
    expect(formatBytes(-1)).toBe('—');
  });

  it('formats durations as mm:ss or h:mm:ss', () => {
    expect(formatDuration(0)).toBe('0:00');
    expect(formatDuration(75)).toBe('1:15');
    expect(formatDuration(3661)).toBe('1:01:01');
    expect(formatDuration(Number.NaN)).toBe('—');
  });

  it('calculates output savings and handles invalid sizes', () => {
    expect(estimateSavingsPercent(100, 60)).toBe(40);
    expect(estimateSavingsPercent(100, 120)).toBe(-20);
    expect(estimateSavingsPercent(0, 10)).toBeNull();
  });
});

describe('video bitrate target calculation', () => {
  it('reserves audio and container overhead from the requested target size', () => {
    const bitrate = calculateVideoBitrateKbps(25, 600, 128);
    expect(bitrate).toBe(188);
  });

  it('rejects zero-duration videos and impossibly small targets', () => {
    expect(() => calculateVideoBitrateKbps(20, 0, 128)).toThrow(/duration/i);
    expect(() => calculateVideoBitrateKbps(0.5, 600, 320)).toThrow(/too small/i);
    expect(() => calculateVideoBitrateKbps(Number.MAX_VALUE, 600, 128)).toThrow(/supported range/i);
  });
});

describe('FFmpeg arguments', () => {
  it('builds an MP4 compression command with an optional scaled resolution and target bitrate', () => {
    const args = buildFfmpegArgs('__INPUT_FILE__', 'out.mp4', settings, 600);
    expect(args).toContain('__INPUT_FILE__');
    expect(args).toContain('libx264');
    expect(args).toContain('scale=-2:min(720\\,ih)');
    expect(args).toContain('-b:v');
    expect(args.at(-1)).toBe('out.mp4');
  });

  it('extracts MP3 audio without including the video stream', () => {
    const args = buildFfmpegArgs('__INPUT_FILE__', 'audio.mp3', { ...settings, mode: 'audio' }, 600);
    expect(args).toContain('-vn');
    expect(args).toContain('libmp3lame');
    expect(args).not.toContain('libx264');
    expect(args.at(-1)).toBe('audio.mp3');
  });

  it('extracts lossless WAV audio', () => {
    const args = buildFfmpegArgs('__INPUT_FILE__', 'audio.wav', { ...settings, mode: 'audio', audioFormat: 'wav' }, 600);
    expect(args).toContain('pcm_s16le');
  });

  it('builds a WebM conversion command', () => {
    const args = buildFfmpegArgs('__INPUT_FILE__', 'out.webm', { ...settings, mode: 'convert', videoFormat: 'webm', targetSizeMb: null }, 600);
    expect(args).toContain('libvpx');
    expect(args).toContain('libvorbis');
    expect(args.at(-1)).toBe('out.webm');
  });
});

describe('recommendations and filenames', () => {
  it('suggests compression for larger video files and audio extraction', () => {
    const file = new File(['x'], 'lecture.mp4', { type: 'video/mp4' });
    Object.defineProperty(file, 'size', { value: 100 * 1024 * 1024 });
    const recs = getRecommendations(file, { duration: 120, width: 1920, height: 1080 });
    expect(recs.some((rec) => rec.mode === 'compress')).toBe(true);
    expect(recs.some((rec) => rec.mode === 'audio')).toBe(true);
  });

  it('does not suggest video actions for an audio file', () => {
    const file = new File(['audio'], 'track.mp3', { type: 'audio/mpeg' });
    expect(getRecommendations(file, null)).toEqual([]);
  });

  it('creates a safe output filename from the original name', () => {
    expect(outputFileName('my clip.mov', 'convert', 'mp4')).toBe('my clip.mp4');
    expect(outputFileName('a/b:c.mp4', 'compress', 'webm')).toBe('a_b_c.webm');
    expect(outputFileName('-option.mp4', 'compress', 'mp4')).toBe('video--option.mp4');
  });
});
