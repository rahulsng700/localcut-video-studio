import { FFmpeg } from '@ffmpeg/ffmpeg';
import { toBlobURL } from '@ffmpeg/util';

// Pinned core version keeps the JavaScript wrapper and WebAssembly core compatible.
// Core files are loaded on demand from jsDelivr, not included in the static-site bundle.
const CORE_VERSION = '0.12.10';
const CORE_BASE_URL = `https://cdn.jsdelivr.net/npm/@ffmpeg/core@${CORE_VERSION}/dist/umd`;

export type FfmpegProgress = (progress: number) => void;

export class BrowserVideoEngine {
  private ffmpeg: FFmpeg | null = null;
  private loading: Promise<void> | null = null;

  get isLoaded(): boolean {
    return Boolean(this.ffmpeg?.loaded);
  }

  async load(): Promise<void> {
    if (this.isLoaded) return;
    if (this.loading) return this.loading;

    this.loading = (async () => {
      const ffmpeg = new FFmpeg();
      this.ffmpeg = ffmpeg;
      try {
        const [coreURL, wasmURL] = await Promise.all([
          toBlobURL(`${CORE_BASE_URL}/ffmpeg-core.js`, 'text/javascript'),
          toBlobURL(`${CORE_BASE_URL}/ffmpeg-core.wasm`, 'application/wasm'),
        ]);
        await ffmpeg.load({ coreURL, wasmURL });
      } catch (error) {
        ffmpeg.terminate();
        this.ffmpeg = null;
        throw error;
      }
    })();

    try {
      await this.loading;
    } catch (error) {
      this.loading = null;
      throw new Error(this.describeError(error, 'Could not load the video engine. Check your connection and try again.'));
    }
  }

  async convert(
    file: File,
    args: string[],
    outputName: string,
    onProgress?: FfmpegProgress,
  ): Promise<Uint8Array> {
    if (!this.ffmpeg?.loaded) throw new Error('Video engine is not ready.');
    const ffmpeg = this.ffmpeg;
    const inputName = `input-${crypto.randomUUID()}-${file.name.replace(/[^a-zA-Z0-9._-]/g, '_')}`;

    const handler = ({ progress }: { progress: number }) => {
      if (Number.isFinite(progress)) onProgress?.(Math.max(0, Math.min(1, progress)));
    };
    ffmpeg.on('progress', handler);

    try {
      await ffmpeg.writeFile(inputName, new Uint8Array(await file.arrayBuffer()));
      const finalArgs = args.map((arg) => arg === '__INPUT_FILE__' ? inputName : arg);
      const exitCode = await ffmpeg.exec(finalArgs);
      if (exitCode !== 0) throw new Error(`FFmpeg exited with code ${exitCode}.`);

      const output = await ffmpeg.readFile(outputName);
      if (typeof output === 'string' || output.length === 0) {
        throw new Error('The converter did not produce an output file.');
      }
      return output;
    } catch (error) {
      throw new Error(this.describeError(error, 'Conversion failed. Try another format or a smaller resolution.'));
    } finally {
      ffmpeg.off('progress', handler);
      try { await ffmpeg.deleteFile(inputName); } catch { /* Temporary file may not exist. */ }
      try { await ffmpeg.deleteFile(outputName); } catch { /* Output may not exist after a failed run. */ }
    }
  }

  terminate(): void {
    this.ffmpeg?.terminate();
    this.ffmpeg = null;
    this.loading = null;
  }

  private describeError(error: unknown, fallback: string): string {
    const message = error instanceof Error ? error.message : String(error);
    if (/memory|allocation|out of memory/i.test(message)) {
      return 'This video is too large for the available browser memory. Try a shorter clip, close other tabs, or use a device with more RAM.';
    }
    if (/codec|encoder|not found|unknown encoder/i.test(message)) {
      return `This browser video engine does not include the required codec: ${message}`;
    }
    return message || fallback;
  }
}
