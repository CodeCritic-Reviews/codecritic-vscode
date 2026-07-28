import * as crypto from 'crypto';
import * as vscode from 'vscode';
import {
  getRecentReviewUuids,
  hasApiKey,
  openDashboardApiKey,
  openLastResult,
  openReviewByUuid,
  reviewActiveFile,
  reviewFolder,
  reviewPickedFiles,
  reviewSelection,
  setApiKey,
} from '../review/runReviewCommands';
import { sidebarBus } from './events';

function getNonce(): string {
  return crypto.randomBytes(16).toString('base64url');
}

function getDashboardUrl(): string {
  const cfg = vscode.workspace.getConfiguration('codecritic');
  return (cfg.get<string>('dashboardUrl') || 'https://code-critic.com').replace(/\/+$/, '');
}

export class HomeViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'codecritic.home';

  private view?: vscode.WebviewView;
  private messageDisposable?: vscode.Disposable;

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly context: vscode.ExtensionContext
  ) {}

  resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken
  ): void {
    this.view = webviewView;
    const { webview } = webviewView;
    webview.options = {
      enableScripts: true,
      localResourceRoots: [
        vscode.Uri.joinPath(this.extensionUri, 'media'),
        vscode.Uri.joinPath(this.extensionUri, 'out'),
      ],
    };
    webview.html = this.buildHtml(webview);

    this.messageDisposable?.dispose();
    this.messageDisposable = webview.onDidReceiveMessage((msg) =>
      void this.onMessage(msg as Record<string, unknown>)
    );

    const onChanged = () => void this.pushState();
    sidebarBus.on('changed', onChanged);
    webviewView.onDidDispose(() => {
      sidebarBus.off('changed', onChanged);
      this.messageDisposable?.dispose();
      this.messageDisposable = undefined;
      this.view = undefined;
    });
  }

  async refresh(): Promise<void> {
    await this.pushState();
  }

  private async pushState(): Promise<void> {
    if (!this.view) return;
    const recent = getRecentReviewUuids(this.context);
    this.view.webview.postMessage({
      type: 'bootstrap',
      hasApiKey: await hasApiKey(this.context),
      recent,
      dashboardUrl: getDashboardUrl(),
    });
  }

  private async onMessage(msg: Record<string, unknown>): Promise<void> {
    const type = typeof msg.type === 'string' ? msg.type : '';
    const extUri = this.extensionUri;
    const ctx = this.context;

    try {
      switch (type) {
        case 'ready':
        case 'refresh':
          await this.pushState();
          return;
        case 'reviewSelection':
          await reviewSelection(ctx, extUri);
          return;
        case 'reviewActiveFile':
          await reviewActiveFile(ctx, extUri);
          return;
        case 'reviewFiles':
          await reviewPickedFiles(ctx, extUri);
          return;
        case 'reviewFolder':
          await reviewFolder(ctx, extUri);
          return;
        case 'openLastResult':
          await openLastResult(ctx, extUri);
          return;
        case 'openRecent': {
          const uuid = typeof msg.uuid === 'string' ? msg.uuid : '';
          if (uuid) await openReviewByUuid(ctx, extUri, uuid);
          return;
        }
        case 'setApiKey':
          await setApiKey(ctx);
          await this.pushState();
          return;
        case 'openDashboard':
          await openDashboardApiKey(ctx);
          return;
        case 'openExternal': {
          const raw = typeof msg.url === 'string' ? msg.url.trim() : '';
          if (!/^https?:\/\//i.test(raw)) {
            void vscode.window.showErrorMessage('CodeCritic: invalid URL.');
            return;
          }
          await vscode.env.openExternal(vscode.Uri.parse(raw));
          return;
        }
        default:
          return;
      }
    } catch (e) {
      const m = e instanceof Error ? e.message : String(e);
      void vscode.window.showErrorMessage(`CodeCritic: ${m}`);
    }
  }

  private buildHtml(webview: vscode.Webview): string {
    const nonce = getNonce();
    const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'out', 'homeView.js'));
    const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'media', 'homeView.css'));
    const logoUri = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'media', 'logo.svg'));
    const csp = [
      `default-src 'none'`,
      `style-src ${webview.cspSource}`,
      `font-src ${webview.cspSource}`,
      `img-src ${webview.cspSource} data:`,
      `script-src 'nonce-${nonce}' ${webview.cspSource}`,
    ].join('; ');

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="${csp}" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <link href="${styleUri}" rel="stylesheet" />
  <title>CodeCritic</title>
</head>
<body>
  <div id="app" data-logo="${logoUri}"></div>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
  }
}
