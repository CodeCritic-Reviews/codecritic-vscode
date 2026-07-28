# CodeCritic (VS Code / Cursor)

[CodeCritic](https://code-critic.com) is a second opinion for AI-written code. Install this extension from the **official editor marketplaces**, then review selection, file, or folder without leaving VS Code or Cursor.

The **CodeCritic** activity bar opens a sidebar (API key, review actions, recent reviews). Results open in a panel: score, issues, suggestions, Trust focus, Mark as done / Dismiss, line jump, and **Fix in Chat**.

Extension ID: `CodeCritic.codecritic-vscode`

## Install

### Visual Studio Code

1. Open **Extensions** (`Ctrl+Shift+X` / `Cmd+Shift+X`).
2. Search for **CodeCritic** (publisher **CodeCritic**).
3. Click **Install**.

Or open the [Visual Studio Marketplace listing](https://marketplace.visualstudio.com/items?itemName=CodeCritic.codecritic-vscode), or from a terminal:

```bash
code --install-extension CodeCritic.codecritic-vscode
```

### Cursor

Cursor uses an Open VSX-compatible marketplace (not the Microsoft Marketplace).

1. Open **Extensions** (`Ctrl+Shift+X` / `Cmd+Shift+X`).
2. Search for **CodeCritic** (publisher **CodeCritic**).
3. Click **Install**.

Or open the [Open VSX listing](https://open-vsx.org/extension/CodeCritic/codecritic-vscode), or from a terminal:

```bash
cursor --install-extension CodeCritic.codecritic-vscode
```

If search does not show the extension yet, install the same ID from Open VSX or use **Extensions: Install from VSIX…** with a release build from the [GitHub repository](https://github.com/CodeCritic-Reviews/codecritic-vscode).

## Requirements

- VS Code 1.80+ or Cursor
- A CodeCritic account and **API key** from [Dashboard → Settings → API key](https://code-critic.com/dashboard?tab=settings)

## Setup

1. Open the CodeCritic sidebar (activity bar) or run **CodeCritic: Set API key** and paste your key (Secret Storage).
2. Optional: **CodeCritic: Open Dashboard (API key)** to copy or rotate the key in the browser.
3. Optional setting **codecritic.apiBaseUrl** (default `https://api.code-critic.com`). For local Rack, use `http://localhost:9292/api`.

## Commands

| Command | Description |
|--------|-------------|
| CodeCritic: Review selection | Selected text in the active editor |
| CodeCritic: Review active file | Whole file |
| CodeCritic: Review files… | Pick one or more files |
| CodeCritic: Review folder… | Text files under a folder (limits apply) |
| CodeCritic: Open last review result | Refetch last UUID for this workspace |
| CodeCritic: Open sidebar | Focus the CodeCritic activity bar view |

Context menu: review selection / active file when an editor is open. The sidebar exposes the same actions and recent history.

## Auth

The extension sends `Authorization: Bearer <API key>` to `/v1/code_reviews` on the API host (default `https://api.code-critic.com`). Billing matches the web app.

## Troubleshooting

**HTTP 404 / “Not Found”:** `codecritic.apiBaseUrl` must be the **API host** (e.g. `https://api.code-critic.com`), not the marketing site.

**ByteString / character greater than 255:** Re-run **CodeCritic: Set API key** and paste the key only from the dashboard, then reload the window.

**Review timed out / Connect Timeout:** The extension retries connect failures. If the panel never opens, use **CodeCritic: Open last review result** - create may have succeeded on the server. On WSL/VPN, a second try often works.

## Limits

Combined payload size is capped (default 20,000 characters on the server). Folder mode skips very large files and common dependency directories.

Trust focus, pay-per-use, and other preferences are configured in the web app only.

## Development

```bash
npm install
npm run watch   # extension + webview
npm test        # unit tests (Vitest)
npx vsce package --no-dependencies   # local .vsix for sideload testing
```

Press **F5** with this folder open (launch config: **Run Extension**) to start the Extension Development Host.

## License

MIT
