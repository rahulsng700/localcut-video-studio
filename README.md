# LocalCut — Local Video Studio

A static, client-side video converter built with React, TypeScript, Vite and FFmpeg.wasm. Users select a video and the browser does the conversion locally. The application has no application backend, accounts, analytics, upload endpoint or database.

## Features

- Local video preview and basic metadata (duration, dimensions and file size).
- Video compression to MP4 (H.264) or WebM (VP8).
- Optional target output size in MB, estimated using source duration and selected audio bitrate.
- Resolution choices: original, up to 1080p, 720p, 480p or 360p.
- Quality presets when no target size is selected.
- Audio extraction to MP3 or WAV.
- File-size comparison after conversion and direct download.
- Recommendations based on file size and dimensions.
- Progress feedback, cancellation, readable error messages and cleanup of temporary FFmpeg files.
- Responsive, keyboard-accessible upload area.

## Privacy and data flow

The selected `File` is read into browser memory and written to FFmpeg.wasm's virtual filesystem. The output is read back into a Blob URL for download. The video itself is not sent to an application server.

On first conversion, the page downloads the pinned FFmpeg JavaScript/WebAssembly core from jsDelivr (`@ffmpeg/core@0.12.10`). The app's own JavaScript bundle is served by the static host. This engine download is separate from the user's video. No analytics or telemetry are configured.

The user should be told that network requests still occur to load the application and FFmpeg engine. A static host/CDN can see normal request metadata (such as IP address and requested asset); the app does not upload the selected media file.

## Requirements

- Node.js 20.19+ (or a current supported LTS release)
- npm
- A modern desktop browser. Chrome, Edge and Firefox are recommended for large files; Safari support depends on the browser's codec and WebAssembly capabilities.

## Run locally

```bash
npm install
npm run dev
```

Open the URL shown by Vite (usually `http://localhost:5173`). The first conversion downloads the FFmpeg core (about 31 MB according to the upstream usage guide), so the first conversion can take longer.

## Test and build

```bash
npm test
npm run build
npm run preview
```

`npm test` runs unit tests for sizing, argument construction and filename handling, plus React component smoke/interaction tests. `npm run build` performs TypeScript checks and creates the production static bundle in `dist/`. GitHub Actions runs both checks on pushes and pull requests to `main`.

## Free hosting: GitHub Pages

This is a static Vite application, so it can be deployed to GitHub Pages without a backend. The repository includes `.github/workflows/deploy-pages.yml`; it runs the test suite, builds the site with the correct project-site base path, and deploys on every push to `main`.

1. Create a **public** GitHub repository on GitHub Free and push this project to its `main` branch.
2. In the repository, open **Settings → Pages**.
3. Under **Build and deployment → Source**, select **GitHub Actions**.
4. Push to `main` (or run **Actions → Deploy to GitHub Pages → Run workflow**).
5. When the workflow succeeds, open **Settings → Pages** to find the published URL: `https://<owner>.github.io/<repository>/`.

The workflow automatically sets Vite's `base` path for a project site. For a user site repository named `<owner>.github.io`, it uses `/`.

**GitHub Pages policy note:** GitHub Pages is intended for project, personal and organization sites. GitHub says it is not intended or permitted as free hosting for a site primarily directed at running an online business or providing commercial SaaS. It is suitable to consider for a personal/open-source project or demo; choose another host for a commercial video-conversion service. GitHub Pages also has a 1 GB published-site limit and a soft 100 GB/month bandwidth limit. Review the current [GitHub Pages limits and usage policy](https://docs.github.com/en/pages/getting-started-with-github-pages/github-pages-limits) before publishing.

## Free hosting: Cloudflare Pages

This project is static; there is no server or database to provision. Cloudflare Pages has a free plan for static sites. The FFmpeg core is intentionally loaded from jsDelivr rather than copied into `dist/`, because the upstream core is around 31 MB and Cloudflare Pages limits a single static asset to 25 MiB.

### Git-based deployment

1. Create a GitHub repository and push this project.
2. In Cloudflare Dashboard, open **Workers & Pages → Create → Pages → Connect to Git**.
3. Select the repository.
4. Set **Framework preset** to `Vite` (or `None`), **Build command** to `npm run build`, and **Build output directory** to `dist`.
5. Deploy. Cloudflare provides a `*.pages.dev` address.

### Wrangler deployment

```bash
npm install
npm run build
npx wrangler pages project create localcut
npx wrangler pages deploy dist --project-name localcut
```

The first Wrangler command requires you to sign in to Cloudflare. You can also use Git integration to deploy automatically on each push.

## Important operational limits

- Conversion runs on the user's device. The user must keep the tab open until processing finishes; closing the tab interrupts the job.
- WebAssembly transcoding is memory- and CPU-intensive. Large 4K/long videos may fail on phones or low-memory devices. This app warns above 512 MiB and rejects input files at or above 2 GiB (the upstream FFmpeg.wasm FAQ documents a 2 GB hard input limit); practical device memory limits are usually lower.
- The browser may briefly hold the input, decoded frames, FFmpeg memory and output in memory. For best results, close other heavy tabs and use shorter clips for memory-constrained devices.
- The target size is an estimate, not a guarantee. Variable visual complexity, audio, container overhead and encoder behavior affect final size. If the result is too large, reduce resolution/target bitrate or run another pass with a larger target-quality compromise.
- The standard single-thread FFmpeg core is used so the app does not need `SharedArrayBuffer`, cross-origin isolation, or custom COOP/COEP headers. It may be slower than a correctly configured multi-thread build.
- Codec availability depends on the selected FFmpeg core build. If an encoder is not included by the upstream core, the UI reports the engine error rather than silently producing another format.

## Production checklist

Before public launch:

- Pin and periodically update npm dependencies and the FFmpeg core version together after testing compatibility.
- Add a Content Security Policy using your chosen CDN origins. Avoid an overly strict CSP that blocks the FFmpeg worker/blob loading path.
- Test the formats you advertise on current Chrome, Edge, Firefox and Safari versions, on both desktop and mobile.
- Add real-device tests with large, long, variable-frame-rate and rotation-metadata samples.
- Consider a worker queue with a hard concurrency limit of one (the current interface already permits one active conversion per page).
- If you later add a server fallback, make it explicit to users and do not silently upload private files.

## License

The LocalCut application source is MIT licensed. FFmpeg.wasm and the FFmpeg WebAssembly core are separate third-party components with their own licenses and notices. Review the upstream FFmpeg.wasm and FFmpeg license information before redistributing a modified or bundled core.
