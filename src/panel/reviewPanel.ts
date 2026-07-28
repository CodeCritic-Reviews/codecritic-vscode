import * as crypto from 'crypto';
import * as vscode from 'vscode';
import type { CodeCriticClient } from '../api/client';
import type { CodeReviewPayload } from '../api/types';
import type { BlobSection } from '../payload/buildReviewPayload';
import { resolveBlobLineToEditor } from '../payload/buildReviewPayload';
import { sendAllFindingsToAgent, sendFindingToAgent } from './sendFindingToAgent';

function getNonce(): string {
  let t = '';
  const c = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  const bytes = crypto.randomBytes(32);
  for (let i = 0; i < 32; i++) {
    t += c.charAt(bytes[i]! % c.length);
  }
  return t;
}

function parseItemKind(value: unknown): 'issue' | 'suggestion' | undefined {
  return value === 'issue' || value === 'suggestion' ? value : undefined;
}

/** Safe embed for <script type="application/json"> - escape < so HTML parsers stay happy. */
function embedJson(data: unknown): string {
  return JSON.stringify(data).replace(/</g, '\\u003c');
}

function getDashboardUrl(): string {
  const cfg = vscode.workspace.getConfiguration('codecritic');
  return (cfg.get<string>('dashboardUrl') || 'https://code-critic.com').replace(/\/+$/, '');
}

export function reviewSiteUrl(uuid: string, dashboardUrl = getDashboardUrl()): string {
  return `${dashboardUrl}/reviews/${uuid}`;
}

export class ReviewPanel {
  public static currentPanel: ReviewPanel | undefined;

  private readonly panel: vscode.WebviewPanel;
  private readonly messageDisposable: vscode.Disposable;
  private pendingReview: CodeReviewPayload | null = null;
  private webviewReady = false;

  private constructor(
    panel: vscode.WebviewPanel,
    private readonly extensionUri: vscode.Uri,
    private client: CodeCriticClient,
    private sections: BlobSection[]
  ) {
    this.panel = panel;
    this.messageDisposable = this.panel.webview.onDidReceiveMessage((msg) =>
      void this.onMessage(msg as Record<string, unknown>)
    );
    this.panel.onDidDispose(() => {
      this.messageDisposable.dispose();
      ReviewPanel.currentPanel = undefined;
    });
  }

  static show(
    extensionUri: vscode.Uri,
    client: CodeCriticClient,
    review: CodeReviewPayload,
    sections: BlobSection[]
  ): void {
    const column = vscode.window.activeTextEditor?.viewColumn ?? vscode.ViewColumn.Beside;
    if (ReviewPanel.currentPanel) {
      ReviewPanel.currentPanel.client = client;
      ReviewPanel.currentPanel.sections = sections;
      ReviewPanel.currentPanel.panel.reveal(column);
      ReviewPanel.currentPanel.pushReview(review);
      return;
    }

    const panel = vscode.window.createWebviewPanel('codecriticReview', 'CodeCritic', column, {
      enableScripts: true,
      retainContextWhenHidden: true,
      localResourceRoots: [
        vscode.Uri.joinPath(extensionUri, 'media'),
        vscode.Uri.joinPath(extensionUri, 'out'),
      ],
    });

    const instance = new ReviewPanel(panel, extensionUri, client, sections);
    ReviewPanel.currentPanel = instance;
    instance.pendingReview = review;
    instance.panel.webview.html = instance.buildHtml(review);
  }

  private pushReview(review: CodeReviewPayload): void {
    this.pendingReview = review;
    if (this.webviewReady) {
      const logoUri = this.panel.webview.asWebviewUri(
        vscode.Uri.joinPath(this.extensionUri, 'media', 'logo.svg')
      );
      this.panel.webview.postMessage({
        type: 'bootstrap',
        review,
        dashboardUrl: getDashboardUrl(),
        logoUrl: String(logoUri),
      });
      this.pendingReview = null;
    }
  }

  private buildHtml(review: CodeReviewPayload): string {
    const { webview } = this.panel;
    const nonce = getNonce();
    const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'out', 'reviewView.js'));
    const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'media', 'reviewPanel.css'));
    const logoUri = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'media', 'logo.svg'));
    const dashboardUrl = getDashboardUrl();
    // nonce + cspSource: external script must be allowed explicitly in some hosts (Cursor).
    const csp = [
      `default-src 'none'`,
      `style-src ${webview.cspSource}`,
      `font-src ${webview.cspSource}`,
      `script-src 'nonce-${nonce}' ${webview.cspSource}`,
      `img-src ${webview.cspSource} data:`,
    ].join('; ');

    const bootPayload = { review, dashboardUrl, logoUrl: String(logoUri) };

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
  <div id="app" data-logo="${logoUri}">
    <div class="boot-loading" id="cc-boot">
      <div class="brand-chip"><img class="brand-logo" src="${logoUri}" alt="" />CodeCritic</div>
      <p class="muted">Loading review…</p>
    </div>
  </div>
  <script type="application/json" id="cc-initial-review" nonce="${nonce}">${embedJson(bootPayload)}</script>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
  }

  private async onMessage(msg: Record<string, unknown>): Promise<void> {
    const type = msg.type as string;
    const uuid = typeof msg.uuid === 'string' ? msg.uuid : '';

    try {
      if (type === 'ready') {
        this.webviewReady = true;
        if (this.pendingReview) {
          const logoUri = this.panel.webview.asWebviewUri(
            vscode.Uri.joinPath(this.extensionUri, 'media', 'logo.svg')
          );
          this.panel.webview.postMessage({
            type: 'bootstrap',
            review: this.pendingReview,
            dashboardUrl: getDashboardUrl(),
            logoUrl: String(logoUri),
          });
          this.pendingReview = null;
        }
        return;
      }

      if (type === 'openExternal' && typeof msg.url === 'string') {
        const raw = msg.url.trim();
        if (!/^https?:\/\//i.test(raw)) {
          void vscode.window.showErrorMessage('CodeCritic: invalid URL.');
          return;
        }
        await vscode.env.openExternal(vscode.Uri.parse(raw));
        return;
      }

      if (type === 'copyAllToAgent' && uuid) {
        const issuesRaw = Array.isArray(msg.issues) ? msg.issues : [];
        const suggestionsRaw = Array.isArray(msg.suggestions) ? msg.suggestions : [];
        await sendAllFindingsToAgent({
          reviewUuid: uuid,
          reviewTitle: typeof msg.review_title === 'string' ? msg.review_title : undefined,
          siteUrl: typeof msg.site_url === 'string' ? msg.site_url : reviewSiteUrl(uuid),
          score: typeof msg.score === 'number' ? msg.score : undefined,
          summary: typeof msg.summary === 'string' ? msg.summary : undefined,
          strengths: Array.isArray(msg.strengths) ? msg.strengths.map(String) : undefined,
          improvements: Array.isArray(msg.improvements) ? msg.improvements.map(String) : undefined,
          issues: issuesRaw.map((row) => {
            const r = row as Record<string, unknown>;
            return {
              message: String(r.message ?? ''),
              severity: typeof r.severity === 'string' ? r.severity : undefined,
              path: typeof r.path === 'string' ? r.path : undefined,
              line: typeof r.line === 'number' ? r.line : undefined,
              suggestion: typeof r.suggestion === 'string' ? r.suggestion : undefined,
              suggestionCode: typeof r.suggestion_code === 'string' ? r.suggestion_code : undefined,
            };
          }),
          suggestions: suggestionsRaw.map(String),
        });
        return;
      }

      if (type === 'goToBlobLine' && typeof msg.line === 'number') {
        const mapped = resolveBlobLineToEditor(this.sections, msg.line);
        if (mapped) {
          const doc = await vscode.workspace.openTextDocument(mapped.uri);
          const ed = await vscode.window.showTextDocument(doc, vscode.ViewColumn.One);
          const pos = new vscode.Position(Math.max(0, mapped.line - 1), 0);
          ed.selection = new vscode.Selection(pos, pos);
          ed.revealRange(new vscode.Range(pos, pos));
        }
        return;
      }

      if (type === 'sendToAgent' && uuid) {
        const itemIndex = Number(msg.item_index);
        const itemKind = parseItemKind(msg.item_kind);
        if (!Number.isFinite(itemIndex) || !itemKind) {
          void vscode.window.showErrorMessage('CodeCritic: invalid finding payload.');
          return;
        }
        await sendFindingToAgent(this.sections, {
          reviewUuid: uuid,
          reviewTitle: typeof msg.review_title === 'string' ? msg.review_title : undefined,
          itemKind,
          itemIndex,
          message: typeof msg.message === 'string' ? msg.message : '',
          path: typeof msg.path === 'string' ? msg.path : undefined,
          line: typeof msg.line === 'number' ? msg.line : undefined,
          suggestion: typeof msg.suggestion === 'string' ? msg.suggestion : undefined,
          suggestionCode: typeof msg.suggestion_code === 'string' ? msg.suggestion_code : undefined,
        });
        return;
      }

      if (type === 'setFinding' && uuid) {
        const itemKind = parseItemKind(msg.item_kind);
        const itemIndex = Number(msg.item_index);
        const state = msg.state === 'dismissed' || msg.state === 'done' ? msg.state : undefined;
        if (!itemKind || !Number.isFinite(itemIndex) || !state) {
          void vscode.window.showErrorMessage('CodeCritic: invalid finding payload.');
          return;
        }
        const findings_ui = await this.client.putFindingState(uuid, {
          item_kind: itemKind,
          item_index: itemIndex,
          state,
        });
        this.panel.webview.postMessage({ type: 'updateFindings', findings_ui });
        return;
      }

      if (type === 'clearFinding' && uuid) {
        const itemKind = parseItemKind(msg.item_kind);
        const itemIndex = Number(msg.item_index);
        if (!itemKind || !Number.isFinite(itemIndex)) {
          void vscode.window.showErrorMessage('CodeCritic: invalid finding payload.');
          return;
        }
        const findings_ui = await this.client.deleteFindingState(uuid, {
          item_kind: itemKind,
          item_index: itemIndex,
        });
        this.panel.webview.postMessage({ type: 'updateFindings', findings_ui });
      }
    } catch (e) {
      const m = e instanceof Error ? e.message : String(e);
      void vscode.window.showErrorMessage(`CodeCritic: ${m}`);
    }
  }
}
