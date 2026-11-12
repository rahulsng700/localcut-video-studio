
import { FFmpeg } from '@ffmpeg/ffmpeg';

const CORE_VERSION = '0.12.10';

const CORE_BASE_URL =
  `https://cdn.jsdelivr.net/npm/@ffmpeg/core@${CORE_VERSION}/dist/esm`;

export class BrowserVideoEngine {
  private ffmpeg: FFmpeg | null = null;
  private loading: Promise<void> | null = null;

  async load(): Promise<void> {
    if (this.ffmpeg?.loaded) return;
    if (this.loading) return this.loading;

    const ffmpeg = new FFmpeg();
    this.ffmpeg = ffmpeg;

    this.loading = (async () => {
      await ffmpeg.load({
        coreURL: `${CORE_BASE_URL}/ffmpeg-core.js`,
        wasmURL: `${CORE_BASE_URL}/ffmpeg-core.wasm`,
      });
    })();

    try {
      await this.loading;
    } catch (error) {
      ffmpeg.terminate();
      this.ffmpeg = null;
      this.loading = null;
      throw error;
    }
  }
}
