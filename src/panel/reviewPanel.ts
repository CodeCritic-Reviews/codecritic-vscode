import * as vscode from 'vscode';
import type { CodeCriticClient } from '../api/client';
import type { CodeReviewPayload } from '../api/types';
import type { BlobSection } from '../payload/buildReviewPayload';
import { resolveBlobLineToEditor } from '../payload/buildReviewPayload';
import { sendFindingToAgent } from './sendFindingToAgent';

function getNonce(): string {
  let t = '';
  const c = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  for (let i = 0; i < 32; i++) {
    t += c.charAt(Math.floor(Math.random() * c.length));
  }
  return t;
}

export class ReviewPanel {
  public static currentPanel: ReviewPanel | undefined;

  private readonly panel: vscode.WebviewPanel;

  private constructor(
    panel: vscode.WebviewPanel,
    private readonly extensionUri: vscode.Uri,
    private client: CodeCriticClient,
    private sections: BlobSection[]
  ) {
    this.panel = panel;
    this.panel.onDidDispose(() => {
      ReviewPanel.currentPanel = undefined;
    });
    this.panel.webview.onDidReceiveMessage((msg) => void this.onMessage(msg as Record<string, unknown>));
  }

  static show(
    extensionUri: vscode.Uri,
    client: CodeCriticClient,
    review: CodeReviewPayload,
    sections: BlobSection[]
  ): void {
    const column = vscode.window.activeTextEditor?.viewColumn ?? vscode.ViewColumn.One;
    if (ReviewPanel.currentPanel) {
      ReviewPanel.currentPanel.client = client;
      ReviewPanel.currentPanel.sections = sections;
      ReviewPanel.currentPanel.panel.reveal(column);
      ReviewPanel.currentPanel.panel.webview.postMessage({ type: 'bootstrap', review });
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      'codecriticReview',
      'CodeCritic',
      column,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [vscode.Uri.joinPath(extensionUri, 'media'), vscode.Uri.joinPath(extensionUri, 'out')],
      }
    );

    ReviewPanel.currentPanel = new ReviewPanel(panel, extensionUri, client, sections);
    ReviewPanel.currentPanel.panel.webview.html = ReviewPanel.currentPanel.buildHtml();
    ReviewPanel.currentPanel.panel.webview.postMessage({ type: 'bootstrap', review });
  }

  private buildHtml(): string {
    const { webview } = this.panel;
    const nonce = getNonce();
    const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'out', 'reviewView.js'));
    const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'media', 'reviewPanel.css'));
    const csp = [
      `default-src 'none'`,
      `style-src ${webview.cspSource}`,
      `script-src 'nonce-${nonce}'`,
      `font-src ${webview.cspSource}`,
    ].join('; ');

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="${csp}" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <link href="${styleUri}" rel="stylesheet" />
</head>
<body>
  <div id="app"></div>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
  }

  private async onMessage(msg: Record<string, unknown>): Promise<void> {
    const type = msg.type as string;
    const uuid = typeof msg.uuid === 'string' ? msg.uuid : '';

    try {
      if (type === 'goToBlobLine' && typeof msg.line === 'number') {
        const mapped = resolveBlobLineToEditor(this.sections, msg.line);
        if (mapped) {
          const doc = await vscode.workspace.openTextDocument(mapped.uri);
          const ed = await vscode.window.showTextDocument(doc);
          const pos = new vscode.Position(Math.max(0, mapped.line - 1), 0);
          ed.selection = new vscode.Selection(pos, pos);
          ed.revealRange(new vscode.Range(pos, pos));
        }
        return;
      }

      if (type === 'sendToAgent' && uuid) {
        const itemIndex = Number(msg.item_index);
        if (!Number.isFinite(itemIndex)) {
          void vscode.window.showErrorMessage('CodeCritic: invalid finding index.');
          return;
        }
        await sendFindingToAgent(this.sections, {
          reviewUuid: uuid,
          reviewTitle: typeof msg.review_title === 'string' ? msg.review_title : undefined,
          itemKind: msg.item_kind as 'issue' | 'suggestion',
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
        const findings_ui = await this.client.putFindingState(uuid, {
          item_kind: msg.item_kind as 'issue' | 'suggestion',
          item_index: msg.item_index as number,
          state: msg.state as 'dismissed' | 'done',
        });
        this.panel.webview.postMessage({ type: 'updateFindings', findings_ui });
        return;
      }

      if (type === 'clearFinding' && uuid) {
        const findings_ui = await this.client.deleteFindingState(uuid, {
          item_kind: msg.item_kind as 'issue' | 'suggestion',
          item_index: msg.item_index as number,
        });
        this.panel.webview.postMessage({ type: 'updateFindings', findings_ui });
      }
    } catch (e) {
      const m = e instanceof Error ? e.message : String(e);
      void vscode.window.showErrorMessage(`CodeCritic: ${m}`);
    }
  }
}
