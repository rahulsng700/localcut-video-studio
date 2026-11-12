
import { FFmpeg } from '@ffmpeg/ffmpeg';

const CORE_VERSION = '0.12.10';

const CORE_BASE_URL =
  `https://cdn.jsdelivr.net/npm/@ffmpeg/core@${CORE_VERSION}/dist/esm`;

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
        await ffmpeg.load({
          coreURL: `${CORE_BASE_URL}/ffmpeg-core.js`,
          wasmURL: `${CORE_BASE_URL}/ffmpeg-core.wasm`,
        });
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
      throw error;
    }
  }

  async convert(
    file: File,
    args: string[],
    outputName: string,
    onProgress?: FfmpegProgress,
  ): Promise<Uint8Array> {
    if (!this.ffmpeg?.loaded) {
      throw new Error('Video engine is not ready.');
    }

    const ffmpeg = this.ffmpeg;

    const inputName =
      `input-${crypto.randomUUID()}-${file.name.replace(/[^a-zA-Z0-9._-]/g, '_')}`;

    const handler = ({ progress }: { progress: number }) => {
      if (Number.isFinite(progress)) {
        onProgress?.(Math.max(0, Math.min(1, progress)));
      }
    };

    ffmpeg.on('progress', handler);

    try {
      await ffmpeg.writeFile(
        inputName,
        new Uint8Array(await file.arrayBuffer())
      );

      const finalArgs = args.map((arg) =>
        arg === '__INPUT_FILE__' ? inputName : arg
      );

      const exitCode = await ffmpeg.exec(finalArgs);

      if (exitCode !== 0) {
        throw new Error(`FFmpeg exited with code ${exitCode}.`);
      }

      const output = await ffmpeg.readFile(outputName);

      if (typeof output === 'string' || output.length === 0) {
        throw new Error('No output file was generated.');
      }

      return output;
    } catch (error) {
      const message =
        error instanceof Error ? error.message : String(error);

      if (/memory|allocation|out of memory/i.test(message)) {
        throw new Error(
          'Insufficient browser memory. Try a smaller video.'
        );
      }

      throw new Error(`Conversion failed: ${message}`);
    } finally {
      ffmpeg.off('progress', handler);

      try {
        await ffmpeg.deleteFile(inputName);
      } catch {
        // Temporary input may not exist.
      }

      try {
        await ffmpeg.deleteFile(outputName);
      } catch {
        // Output may not exist after failure.
      }
    }
  }

  terminate(): void {
    this.ffmpeg?.terminate();
    this.ffmpeg = null;
    this.loading = null;
  }
}
