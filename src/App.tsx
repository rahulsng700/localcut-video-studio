import { useEffect, useMemo, useRef, useState } from 'react';
import type { ChangeEvent, DragEvent } from 'react';
import {
  AudioLines, Check, ChevronDown, CircleAlert, Clapperboard, Download, FileVideo2,
  Film, Gauge, HardDrive, Info, LockKeyhole, Music2, RefreshCw, Scissors,
  ShieldCheck, Sparkles, Upload, Video, X,
} from 'lucide-react';
import {
  buildFfmpegArgs, estimateSavingsPercent, formatBytes, formatDuration,
  getRecommendations, outputFileName,
  type AudioFormat, type ConversionSettings, type MediaMetadata,
  type OutputMode, type Resolution, type VideoFormat,
} from './lib/media';
import { BrowserVideoEngine } from './lib/ffmpeg-client';
import './styles.css';

type AppStatus = 'idle' | 'loading' | 'ready' | 'converting' | 'done' | 'error';

const initialSettings: ConversionSettings = {
  mode: 'compress',
  videoFormat: 'mp4',
  resolution: 'original',
  targetSizeMb: null,
  audioBitrateKbps: 128,
  audioFormat: 'mp3',
  quality: 'balanced',
};

function App() {
  const engineRef = useRef<BrowserVideoEngine>(new BrowserVideoEngine());
  const inputRef = useRef<HTMLInputElement>(null);
  const cancelledRef = useRef(false);
  const [file, setFile] = useState<File | null>(null);
  const [metadata, setMetadata] = useState<MediaMetadata | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [outputUrl, setOutputUrl] = useState<string | null>(null);
  const [outputName, setOutputName] = useState<string>('');
  const [outputSize, setOutputSize] = useState<number | null>(null);
  const [settings, setSettings] = useState<ConversionSettings>(initialSettings);
  const [targetEnabled, setTargetEnabled] = useState(false);
  const [targetSizeInput, setTargetSizeInput] = useState('');
  const [status, setStatus] = useState<AppStatus>('idle');
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);

  useEffect(() => () => engineRef.current.terminate(), []);

  useEffect(() => {
    if (!outputUrl) return;
    return () => URL.revokeObjectURL(outputUrl);
  }, [outputUrl]);

  useEffect(() => {
    if (!file) {
      setMetadata(null);
      setPreviewUrl(null);
      return;
    }

    const url = URL.createObjectURL(file);
    setPreviewUrl(url);
    setMetadata(null);
    setOutputUrl(null);
    setOutputName('');
    setOutputSize(null);
    setError(null);
    setStatus('ready');
    setProgress(0);

    const video = document.createElement('video');
    video.preload = 'metadata';
    video.muted = true;
    video.src = url;
    const onError = () => {
      setError('The browser could not preview this video. The file may still be convertible if FFmpeg supports its codec.');
    };
    const onLoaded = () => {
      setMetadata({
        duration: Number.isFinite(video.duration) ? video.duration : 0,
        width: video.videoWidth,
        height: video.videoHeight,
      });
      video.removeEventListener('error', onError);
      video.removeAttribute('src');
      video.load();
    };
    video.addEventListener('loadedmetadata', onLoaded, { once: true });
    video.addEventListener('error', onError, { once: true });
    return () => {
      video.removeEventListener('loadedmetadata', onLoaded);
      video.removeEventListener('error', onError);
      video.removeAttribute('src');
      video.load();
      URL.revokeObjectURL(url);
    };
  }, [file]);

  const recommendations = useMemo(
    () => file ? getRecommendations(file, metadata) : [],
    [file, metadata],
  );

  const activeTargetSize = targetEnabled && targetSizeInput.trim() !== ''
    ? Number(targetSizeInput)
    : null;
  const canConvert = Boolean(file) && status !== 'loading' && status !== 'converting';
  const isBusy = status === 'loading' || status === 'converting';
  const savings = file && outputSize !== null ? estimateSavingsPercent(file.size, outputSize) : null;

  const updateSettings = (patch: Partial<ConversionSettings>) => {
    setSettings((current) => ({ ...current, ...patch }));
    setOutputUrl(null);
    setOutputSize(null);
    setOutputName('');
    setError(null);
    if (status === 'done') setStatus('ready');
  };

  const setSelectedFile = (selected: File | undefined) => {
    if (!selected) return;
    if (selected.size >= 2 * 1024 * 1024 * 1024) {
      setError('The browser FFmpeg engine has a 2 GB input-file limit. Choose a smaller video.');
      return;
    }
    if (!selected.type.startsWith('video/') && !/\.(mp4|mov|mkv|webm|avi|m4v|3gp|mpeg|mpg)$/i.test(selected.name)) {
      setError('Choose a video file (MP4, MOV, MKV, WebM, AVI and similar formats).');
      return;
    }
    if (isBusy) return;
    setFile(selected);
    const sizeMb = selected.size / (1024 * 1024);
    const suggested = sizeMb >= 30 ? Math.max(5, Math.round(sizeMb * 0.65 * 10) / 10) : '';
    setTargetSizeInput(String(suggested));
    setTargetEnabled(sizeMb >= 30);
    setSettings(initialSettings);
  };

  const onFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    setSelectedFile(event.target.files?.[0]);
    event.target.value = '';
  };

  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setIsDragging(false);
    setSelectedFile(event.dataTransfer.files?.[0]);
  };

  const startConversion = async () => {
    if (!file) return;
    setError(null);
    setOutputUrl(null);
    setOutputSize(null);
    setProgress(0);
    cancelledRef.current = false;

    const isAudio = settings.mode === 'audio';
    const actualSettings: ConversionSettings = {
      ...settings,
      targetSizeMb: !isAudio && settings.mode === 'compress' && targetEnabled ? activeTargetSize : null,
    };
    if (!isAudio && settings.mode === 'compress' && targetEnabled && activeTargetSize === null) {
      setError('Enter the target output size in MB, or switch off the target-size option.');
      return;
    }
    if (actualSettings.targetSizeMb !== null && (!Number.isFinite(actualSettings.targetSizeMb) || actualSettings.targetSizeMb <= 0)) {
      setError('Enter a valid target size greater than zero MB.');
      return;
    }
    if (!isAudio && actualSettings.targetSizeMb !== null && metadata?.duration && actualSettings.targetSizeMb < file.size / (1024 * 1024) * 0.02) {
      setError('That target is unusually small. Choose a more realistic output size.');
      return;
    }
    if (actualSettings.targetSizeMb !== null && !metadata?.duration) {
      setError('Wait for video metadata to load before using a target file size.');
      return;
    }

    const format = isAudio ? actualSettings.audioFormat : actualSettings.videoFormat;
    const outName = outputFileName(file.name, actualSettings.mode, format);

    try {
      const args = buildFfmpegArgs('__INPUT_FILE__', outName, actualSettings, metadata?.duration ?? 0);
      if (!engineRef.current.isLoaded) {
        setStatus('loading');
        await engineRef.current.load();
      }
      setStatus('converting');
      const data = await engineRef.current.convert(file, args, outName, (value) => {
        // FFmpeg's progress event is approximate for some conversion types.
        setProgress(Math.round(Math.max(0, Math.min(1, value)) * 100));
      });
      const mime = isAudio
        ? (actualSettings.audioFormat === 'mp3' ? 'audio/mpeg' : 'audio/wav')
        : (actualSettings.videoFormat === 'mp4' ? 'video/mp4' : 'video/webm');
      const blob = new Blob([new Uint8Array(data)], { type: mime });
      if (blob.size === 0) throw new Error('The output file is empty. Try different settings.');
      setOutputUrl(URL.createObjectURL(blob));
      setOutputName(outName);
      setOutputSize(blob.size);
      setProgress(100);
      setStatus('done');
    } catch (caught) {
      if (cancelledRef.current) {
        setStatus('ready');
        return;
      }
      setStatus('error');
      setError(caught instanceof Error ? caught.message : 'Conversion failed. Please try again.');
    }
  };

  const cancelConversion = () => {
    cancelledRef.current = true;
    engineRef.current.terminate();
    setStatus('ready');
    setError('Conversion stopped. The video engine will reload the next time you convert.');
    setProgress(0);
  };

  const clearFile = () => {
    if (isBusy) return;
    setFile(null);
    setMetadata(null);
    setPreviewUrl(null);
    setOutputUrl(null);
    setOutputName('');
    setOutputSize(null);
    setStatus('idle');
    setError(null);
  };

  const applyRecommendation = (mode: OutputMode) => {
    updateSettings({ mode, videoFormat: 'mp4', resolution: mode === 'compress' ? '720' : 'original' });
    if (mode === 'compress' && file && !targetSizeInput) {
      setTargetSizeInput(String(Math.max(5, Math.round(file.size / (1024 * 1024) * 0.65))));
      setTargetEnabled(true);
    }
  };

  return (
    <div className="app-shell">
      <header className="topbar">
        <a className="brand" href="#top" aria-label="Local Video Studio home">
          <span className="brand-mark"><Clapperboard size={20} strokeWidth={2.2} /></span>
          <span>local<span className="brand-light">cut</span></span>
        </a>
        <div className="topbar-right">
          <span className="privacy-pill"><LockKeyhole size={13} /> 100% local processing</span>
          <a className="github-link" href="https://github.com/ffmpegwasm/ffmpeg.wasm" target="_blank" rel="noreferrer">Powered by FFmpeg</a>
        </div>
      </header>

      <main id="top" className="main-content">
        <section className="hero">
          <div className="eyebrow"><span className="eyebrow-dot" /> PRIVATE VIDEO TOOLKIT</div>
          <h1>Your videos.<br /><span>Your device does the work.</span></h1>
          <p className="hero-copy">Compress, convert and extract audio without sending your files to a server. Everything runs in your browser.</p>
          <div className="hero-points">
            <span><ShieldCheck size={15} /> Files stay on your device</span>
            <span><Gauge size={15} /> Uses your CPU</span>
            <span><Sparkles size={15} /> Free to use</span>
          </div>
        </section>

        <section className="workspace" aria-label="Video converter">
          {!file ? (
            <div
              className={`dropzone ${isDragging ? 'dropzone-active' : ''}`}
              onDragOver={(event) => { event.preventDefault(); setIsDragging(true); }}
              onDragLeave={() => setIsDragging(false)}
              onDrop={onDrop}
              onClick={() => inputRef.current?.click()}
              onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') inputRef.current?.click(); }}
              role="button"
              tabIndex={0}
              aria-label="Choose a video file"
            >
              <input ref={inputRef} type="file" accept="video/*,.mkv,.avi,.mov,.mp4,.webm,.m4v,.3gp" onChange={onFileChange} hidden />
              <div className="upload-icon"><Upload size={25} /></div>
              <h2>Drop your video here</h2>
              <p>or <span className="browse-link">browse files</span> from your device</p>
              <div className="supported-formats">MP4 · MOV · MKV · WEBM · AVI · M4V</div>
            </div>
          ) : (
            <>
              <div className="file-card">
                <div className="file-card-main">
                  <div className="file-icon"><FileVideo2 size={22} /></div>
                  <div className="file-details">
                    <div className="file-name" title={file.name}>{file.name}</div>
                    <div className="file-meta">
                      <span>{formatBytes(file.size)}</span>
                      <i />
                      <span>{metadata ? formatDuration(metadata.duration) : 'Reading duration…'}</span>
                      <i />
                      <span>{metadata?.width && metadata?.height ? `${metadata.width} × ${metadata.height}` : 'Resolution pending'}</span>
                    </div>
                  </div>
                </div>
                <button type="button" className="icon-button" onClick={clearFile} disabled={isBusy} aria-label="Remove video"><X size={18} /></button>
              </div>
              {file.size > 512 * 1024 * 1024 && (
                <div className="notice warning"><CircleAlert size={16} /> Large file: this may need substantial browser memory. Close other tabs and use a device with plenty of RAM.</div>
              )}

              <div className="editor-grid">
                <div className="preview-panel">
                  <div className="panel-heading"><span>PREVIEW</span><span className="muted-label">SOURCE FILE</span></div>
                  {previewUrl ? <video className="video-preview" src={previewUrl} controls playsInline preload="metadata" /> : <div className="preview-placeholder"><Video size={32} /></div>}
                  <div className="privacy-note"><LockKeyhole size={14} /> Your source file is read locally. It is never uploaded.</div>
                </div>

                <div className="settings-panel">
                  <div className="panel-heading"><span>WHAT WOULD YOU LIKE TO DO?</span></div>
                  <div className="mode-tabs" role="tablist" aria-label="Conversion type">
                    <button type="button" role="tab" aria-selected={settings.mode === 'compress'} className={settings.mode === 'compress' ? 'mode-tab active' : 'mode-tab'} disabled={isBusy} onClick={() => updateSettings({ mode: 'compress' })}>
                      <Gauge size={16} /> Compress
                    </button>
                    <button type="button" role="tab" aria-selected={settings.mode === 'convert'} className={settings.mode === 'convert' ? 'mode-tab active' : 'mode-tab'} disabled={isBusy} onClick={() => updateSettings({ mode: 'convert', targetSizeMb: null })}>
                      <RefreshCw size={16} /> Convert
                    </button>
                    <button type="button" role="tab" aria-selected={settings.mode === 'audio'} className={settings.mode === 'audio' ? 'mode-tab active' : 'mode-tab'} disabled={isBusy} onClick={() => updateSettings({ mode: 'audio', targetSizeMb: null })}>
                      <AudioLines size={16} /> Audio
                    </button>
                  </div>

                  {settings.mode === 'audio' ? (
                    <div className="control-group">
                      <label htmlFor="audio-format">Audio format</label>
                      <div className="select-wrap"><select id="audio-format" disabled={isBusy} value={settings.audioFormat} onChange={(event) => updateSettings({ audioFormat: event.target.value as AudioFormat })}><option value="mp3">MP3 — smaller, widely supported</option><option value="wav">WAV — uncompressed, larger</option></select><ChevronDown size={15} /></div>
                      {settings.audioFormat === 'mp3' && <><label htmlFor="audio-bitrate">Audio quality</label><div className="select-wrap"><select id="audio-bitrate" disabled={isBusy} value={settings.audioBitrateKbps} onChange={(event) => updateSettings({ audioBitrateKbps: Number(event.target.value) as ConversionSettings['audioBitrateKbps'] })}><option value="96">96 kbps — smallest</option><option value="128">128 kbps — balanced</option><option value="192">192 kbps — high quality</option><option value="256">256 kbps — very high</option><option value="320">320 kbps — maximum MP3</option></select><ChevronDown size={15} /></div></>}
                      <div className="helper-line"><Music2 size={14} /> Saves only the audio track, without video.</div>
                    </div>
                  ) : (
                    <div className="control-group">
                      <label htmlFor="video-format">Output format</label>
                      <div className="select-wrap"><select id="video-format" disabled={isBusy} value={settings.videoFormat} onChange={(event) => updateSettings({ videoFormat: event.target.value as VideoFormat })}><option value="mp4">MP4 (H.264) — best compatibility</option><option value="webm">WebM (VP8) — web friendly</option></select><ChevronDown size={15} /></div>

                      <label htmlFor="resolution">Video resolution</label>
                      <div className="select-wrap"><select id="resolution" disabled={isBusy} value={settings.resolution} onChange={(event) => updateSettings({ resolution: event.target.value as Resolution })}><option value="original">Keep original</option><option value="1080">Up to 1080p</option><option value="720">Up to 720p — recommended</option><option value="480">Up to 480p — smaller file</option><option value="360">Up to 360p — smallest</option></select><ChevronDown size={15} /></div>

                      {settings.mode === 'compress' && (
                        <>
                          <div className="target-toggle-row">
                            <label className="checkbox-label"><input type="checkbox" disabled={isBusy} checked={targetEnabled} onChange={(event) => setTargetEnabled(event.target.checked)} /> Aim for a specific file size</label>
                            <span className="optional-label">OPTIONAL</span>
                          </div>
                          {targetEnabled ? (
                            <div className="target-input-wrap"><input id="target-size" type="number" min="1" step="0.5" disabled={isBusy} value={targetSizeInput} onChange={(event) => setTargetSizeInput(event.target.value)} aria-label="Target output size in megabytes" /><span>MB target</span></div>
                          ) : (
                            <div className="select-wrap"><select aria-label="Compression quality" disabled={isBusy} value={settings.quality} onChange={(event) => updateSettings({ quality: event.target.value as ConversionSettings['quality'] })}><option value="smaller">Smaller file</option><option value="balanced">Balanced — recommended</option><option value="higher">Higher quality</option></select><ChevronDown size={15} /></div>
                          )}
                          {targetEnabled && <p className="field-hint">Estimated size only. Actual output depends on video complexity and may differ.</p>}
                        </>
                      )}
                      {settings.mode === 'convert' && <><label htmlFor="quality">Encoding quality</label><div className="select-wrap"><select id="quality" disabled={isBusy} value={settings.quality} onChange={(event) => updateSettings({ quality: event.target.value as ConversionSettings['quality'] })}><option value="smaller">Smaller file</option><option value="balanced">Balanced — recommended</option><option value="higher">Higher quality</option></select><ChevronDown size={15} /></div></>}
                    </div>
                  )}

                  <button type="button" className="advanced-toggle" disabled={isBusy} onClick={() => setShowAdvanced((value) => !value)} aria-expanded={showAdvanced}>
                    <span>Advanced settings</span><ChevronDown size={15} className={showAdvanced ? 'rotate' : ''} />
                  </button>
                  {showAdvanced && (
                    <div className="advanced-content">
                      <label htmlFor="audio-track-bitrate">Audio bitrate</label>
                      <div className="select-wrap"><select id="audio-track-bitrate" disabled={isBusy} value={settings.audioBitrateKbps} onChange={(event) => updateSettings({ audioBitrateKbps: Number(event.target.value) as ConversionSettings['audioBitrateKbps'] })}><option value="96">96 kbps</option><option value="128">128 kbps</option><option value="192">192 kbps</option><option value="256">256 kbps</option><option value="320">320 kbps</option></select><ChevronDown size={15} /></div>
                      <p className="field-hint">Higher audio bitrate preserves more detail but uses more space.</p>
                    </div>
                  )}

                  <button type="button" className="convert-button" onClick={startConversion} disabled={!canConvert || (status === 'done' && !file)}>
                    {isBusy ? <><span className="spinner" /> {status === 'loading' ? 'Loading video engine…' : 'Processing on your device…'}</> : <><Sparkles size={17} /> {settings.mode === 'audio' ? 'Extract audio' : settings.mode === 'compress' ? 'Compress video' : 'Convert video'} <span className="button-arrow">→</span></>}
                  </button>
                  {status === 'converting' && <button type="button" className="cancel-button" onClick={cancelConversion}>Cancel processing</button>}
                </div>
              </div>

              {isBusy && (
                <div className="progress-card" role="status" aria-live="polite">
                  <div className="progress-topline"><span>{status === 'loading' ? 'Downloading and starting the video engine' : 'Converting on this device'}</span><strong>{status === 'loading' ? 'Starting' : `${progress}%`}</strong></div>
                  <div className="progress-track"><div className={status === 'loading' ? 'progress-fill progress-indeterminate' : 'progress-fill'} style={status === 'loading' ? undefined : { width: `${Math.max(4, progress)}%` }} /></div>
                  <p>{status === 'loading' ? 'The FFmpeg engine is downloaded once and reused during this session.' : 'Keep this tab open. Large videos can take a while and use significant memory.'}</p>
                </div>
              )}

              {status === 'done' && outputUrl && (
                <div className="result-card" role="status">
                  <div className="result-icon"><Check size={21} /></div>
                  <div className="result-copy">
                    <strong>Your file is ready</strong>
                    <span>{outputName} · {formatBytes(outputSize ?? 0)}</span>
                    {savings !== null && <span className={savings >= 0 ? 'saving-positive' : 'saving-negative'}>{savings >= 0 ? `${savings}% smaller than the original` : `${Math.abs(savings)}% larger than the original`}</span>}
                  </div>
                  <a className="download-button" href={outputUrl} download={outputName}><Download size={16} /> Download</a>
                </div>
              )}

              {error && <div className={`notice ${status === 'error' ? 'error' : 'info'}`}><Info size={16} /><span>{error}</span><button type="button" onClick={() => setError(null)} aria-label="Dismiss message"><X size={14} /></button></div>}

              {recommendations.length > 0 && (
                <div className="suggestions-section">
                  <div className="suggestions-title"><div><Sparkles size={16} /> <strong>Suggestions for this video</strong></div><span>BASED ON YOUR FILE</span></div>
                  <div className="suggestion-grid">
                    {recommendations.map((item) => (
                      <button type="button" className="suggestion-card" key={item.title} disabled={isBusy} onClick={() => applyRecommendation(item.mode)}>
                        <span className="suggestion-icon">{item.mode === 'audio' ? <Scissors size={17} /> : <Film size={17} />}</span>
                        <span className="suggestion-content"><strong>{item.title}</strong><small>{item.description}</small><em>{item.reason}</em></span>
                        <span className="suggestion-arrow">→</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </section>

        <section className="trust-strip">
          <div><LockKeyhole size={17} /><strong>Private by design</strong><span>Your video is never uploaded to our servers.</span></div>
          <div><HardDrive size={17} /><strong>Local processing</strong><span>Your device handles the conversion.</span></div>
          <div><Download size={17} /><strong>Download and go</strong><span>Save the result directly to your device.</span></div>
        </section>

        <section className="how-section">
          <div className="section-kicker">HOW IT WORKS</div>
          <h2>Powerful tools. No upload queue.</h2>
          <div className="how-grid">
            <div className="how-item"><span>01</span><Upload size={20} /><strong>Choose a video</strong><p>Select a video from your device. It stays in your browser.</p></div>
            <div className="how-item"><span>02</span><Gauge size={20} /><strong>Pick your output</strong><p>Choose a format, resolution, audio extraction or target size.</p></div>
            <div className="how-item"><span>03</span><Download size={20} /><strong>Save the result</strong><p>Your browser processes the file and gives you a download.</p></div>
          </div>
        </section>
      </main>

      <footer className="footer">
        <a className="brand footer-brand" href="#top"><span className="brand-mark"><Clapperboard size={17} /></span><span>local<span className="brand-light">cut</span></span></a>
        <span>Free, private video tools that run on your device.</span>
        <span className="footer-small">No account · No upload · No server-side conversion</span>
      </footer>
    </div>
  );
}

export default App;
