# CodeCritic (VS Code / Cursor)

Run [CodeCritic](https://code-critic.com) reviews from your editor. Full results in a webview panel: score, issues, suggestions, Trust focus, and Done / Dismiss (same API as the dashboard).

## Requirements

- VS Code 1.80+ or Cursor
- A CodeCritic account and **API key** from Dashboard → Settings → API key

## Install

1. Build or download `codecritic-0.1.0.vsix`.
2. Command Palette → **Extensions: Install from VSIX…** → pick the file.

Or from this repo:

```bash
npm install
npm run compile
npx vsce package --no-dependencies
```

## Setup

1. **CodeCritic: Set API key** → paste your key (stored in Secret Storage).
2. Optional: **CodeCritic: Open Dashboard (API key)** if you need to copy or rotate the key.
3. Optional setting **codecritic.apiBaseUrl** (default `https://api.code-critic.com`). Against local Rack, use `http://localhost:9292/api` so requests hit `/api/v1/...` like the web app.

## Commands

| Command | Description |
|--------|-------------|
| CodeCritic: Review selection | Selected text in the active editor |
| CodeCritic: Review active file | Whole file |
| CodeCritic: Review files… | Pick one or more files |
| CodeCritic: Review folder… | Text files under a folder (limits apply) |
| CodeCritic: Open last review result | Refetch last UUID for this workspace |

Context menu: review selection / active file when editor is open.

## Auth

The extension uses `Authorization: Bearer <API key>` against `/v1/code_reviews` on the API host (default `https://api.code-critic.com`). The same routes accept a JWT from the web app; the server treats a valid API key as an alternative bearer credential.

## Troubleshooting

**HTTP 404 / “Not Found”:** `codecritic.apiBaseUrl` must be the **API host** (e.g. `https://api.code-critic.com`), not the website. The extension calls `…/v1/code_reviews` itself. A 404 with plain text means the request hit a web server or CDN, not Grape JSON.

**ByteString / character greater than 255:** Node’s `fetch` only allows Latin-1 in HTTP headers. The extension normalizes the key with NFKC and keeps only `0-9a-f` code points (no surrogates or homoglyphs). Settings **codecritic.apiBaseUrl** is stripped to ASCII. Re-run **CodeCritic: Set API key** and paste the key only from the dashboard, then reload the window.

## Limits

Combined payload size is capped (default 20,000 characters on the server). The extension checks before sending. Folder mode skips very large files and common dependency directories.

Trust focus, pay-per-use, and other preferences are configured in the web app only.

## Development

```bash
npm install
npm run watch   # extension + webview
```

Press F5 in VS Code with this folder opened to run the Extension Development Host.

## License

MIT
