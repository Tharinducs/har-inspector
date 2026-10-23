# HAR Inspector Dashboard (Chrome Extension)

A React + Webpack 5 + Chrome Manifest V3 extension that opens a full dashboard in a new tab when its toolbar icon is clicked. It reads a user-selected HAR file locally in the browser.

## UI refresh

- Modern, colorful dashboard styling with distinct status-card accents, soft gradients, rounded panels, and clearer spacing.
- Settings button switches to a high-visibility red close state while settings are open; the settings panel also has a red Close settings button.
- Custom document-plus-magnifier extension artwork is included in `icons/` and wired into the Chrome toolbar and extension listing.

## Features

- Summary counts for 2xx success, 3xx redirects, 4xx client errors, 5xx server errors, and configured response-body search matches.
- Select a request to inspect request/response body, request/response headers, status, resource type, total duration, and HAR timing breakdown (blocked, DNS, connect, send, wait, receive, SSL).
- Separates JavaScript, image, and JSON resource loading and offers successful/failed resource filters.
- Settings for each status group, resource-loading visibility, and comma-separated body search terms. Default search term: `-ERR-`.
- Settings are saved using `chrome.storage.local`.
- No backend or network upload. The HAR is parsed in the extension tab.
- Uses `@material-ui/core` v4 and `@material-ui/icons` dependency (not MUI v5), React 17, Webpack 5; no Vite.

## Build and install

1. Install Node.js (18+ recommended).
2. From this folder run:
   ```bash
   npm install
   npm run build
   ```
3. Open `chrome://extensions` in Chrome.
4. Enable **Developer mode**.
5. Click **Load unpacked** and select this project's `dist` folder. The build script copies `manifest.json`, `background.js`, and the icon assets into `dist`.
   ```bash
   cp manifest.json background.js dist/
   ```
6. Click the extension toolbar icon. It opens the dashboard in a new tab. Upload a `.har` file.

### Build everything into dist

`npm run build` copies the manifest, background worker, and icon assets into `dist`. The extension manifest points to `background.js` at the root of the loaded extension folder.

## Export a HAR

In Chrome DevTools, open **Network**, reproduce the issue, right-click the request list, and choose **Save all as HAR with content**. HAR files can include sensitive cookies, bearer tokens, personal data and request payloads. Store and share them carefully.

## Notes / limitations

- HAR export does not always include request or response bodies. When a body is absent from the HAR, the UI indicates that no body was recorded.
- The `200` setting is the UI label for the 2xx success class, not only status code 200. The `30x`, `40x`, and `50x` settings represent 3xx, 4xx and 5xx status classes.
- Resource types are inferred from HAR MIME types and URL extensions. Unrecognized resource types are shown as `Other`.
- Total response time uses the HAR `entry.time` value; detailed timing fields are shown as recorded, including `-1` when the browser reports a timing value as unavailable.
- Body search is case-insensitive and scans response-body text included in the HAR. For large HAR files, the browser may need a little time and memory to parse and render all requests.

The `npm run build` script copies `manifest.json` and `background.js` into `dist` automatically, so the generated `dist` folder is ready to load unpacked.
