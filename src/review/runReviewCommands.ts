import * as vscode from 'vscode';
import { CodeCriticClient, normalizeApiKey, sanitizeApiBaseUrl } from '../api/client';
import type { CodeReviewPayload } from '../api/types';
import { ReviewPanel } from '../panel/reviewPanel';
import {
  buildFromParts,
  DEFAULT_MAX_CODE_CHARS,
  type ReviewContentPart,
} from '../payload/buildReviewPayload';
import { collectFolderFiles } from '../collect/collectFolder';
import { notifySidebarChanged } from '../sidebar/events';
import { pollUntilReviewDone } from './pollUntilDone';

const RECENT_KEY = 'codecritic.recentReviewUuids';
const MAX_RECENT = 15;

export function getRecentReviewUuids(context: vscode.ExtensionContext): string[] {
  return context.workspaceState.get<string[]>(RECENT_KEY) || [];
}

export async function hasApiKey(context: vscode.ExtensionContext): Promise<boolean> {
  const k = normalizeApiKey((await getApiKey(context)) ?? '');
  return Boolean(k);
}

function getBaseUrl(): string {
  const cfg = vscode.workspace.getConfiguration('codecritic');
  return cfg.get<string>('apiBaseUrl') || 'https://api.code-critic.com';
}

async function getApiKey(context: vscode.ExtensionContext): Promise<string | undefined> {
  return context.secrets.get('codecritic.apiKey');
}

function makeClient(context: vscode.ExtensionContext): CodeCriticClient {
  return new CodeCriticClient(sanitizeApiBaseUrl(getBaseUrl()), () => getApiKey(context));
}

async function pushRecent(context: vscode.ExtensionContext, uuid: string): Promise<void> {
  const raw = getRecentReviewUuids(context);
  const next = [uuid, ...raw.filter((u) => u !== uuid)].slice(0, MAX_RECENT);
  await context.workspaceState.update(RECENT_KEY, next);
  notifySidebarChanged();
}

async function ensureKey(context: vscode.ExtensionContext): Promise<boolean> {
  const k = normalizeApiKey((await getApiKey(context)) ?? '');
  if (k) return true;
  void vscode.window.showErrorMessage('CodeCritic: set your API key first (CodeCritic: Set API key).');
  return false;
}

export async function runReviewWithParts(
  context: vscode.ExtensionContext,
  extensionUri: vscode.Uri,
  parts: ReviewContentPart[],
  titleHint: string
): Promise<void> {
  if (!(await ensureKey(context))) return;
  if (parts.length === 0) {
    void vscode.window.showWarningMessage('CodeCritic: nothing to review.');
    return;
  }

  const built = buildFromParts(parts, titleHint);
  if (built.code.length > DEFAULT_MAX_CODE_CHARS) {
    void vscode.window.showErrorMessage(
      `CodeCritic: combined source is ${built.code.length} characters (max ${DEFAULT_MAX_CODE_CHARS}). Reduce scope.`
    );
    return;
  }

  const client = makeClient(context);
  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: 'CodeCritic: creating review…',
      cancellable: true,
    },
    async (progress, token) => {
      let uuid: string;
      try {
        const created = await client.createReview({
          code: built.code,
          language: built.language,
          title: built.title,
        });
        uuid = created.uuid;
      } catch (e) {
        const m = e instanceof Error ? e.message : String(e);
        void vscode.window.showErrorMessage(`CodeCritic: ${m}`);
        return;
      }

      await pushRecent(context, uuid);
      progress.report({ message: 'Waiting for results…' });

      let review: CodeReviewPayload;
      try {
        review = await pollUntilReviewDone(client, uuid, token);
      } catch (e) {
        if (e instanceof vscode.CancellationError) {
          void vscode.window.showInformationMessage('CodeCritic: review cancelled (job may still run on server).');
        } else {
          const m = e instanceof Error ? e.message : String(e);
          void vscode.window
            .showErrorMessage(`CodeCritic: ${m}`, 'Open last result')
            .then((choice) => {
              if (choice === 'Open last result') {
                void openLastResult(context, extensionUri);
              }
            });
        }
        return;
      }

      ReviewPanel.show(extensionUri, client, review, built.sections);
    }
  );
}

export async function reviewSelection(context: vscode.ExtensionContext, extensionUri: vscode.Uri): Promise<void> {
  const ed = vscode.window.activeTextEditor;
  if (!ed) {
    void vscode.window.showWarningMessage('CodeCritic: no active editor.');
    return;
  }
  const text = ed.document.getText(ed.selection);
  if (!text.trim()) {
    void vscode.window.showWarningMessage('CodeCritic: select code first.');
    return;
  }
  const displayPath = ed.document.uri.scheme === 'file' ? ed.document.uri.fsPath.split(/[/\\]/).pop() || 'selection' : 'selection';
  const anchorLineInFile = ed.selection.start.line + 1;
  await runReviewWithParts(
    context,
    extensionUri,
    [
      {
        displayPath,
        uri: ed.document.uri,
        content: text,
        languageId: ed.document.languageId,
        anchorLineInFile,
      },
    ],
    'Selection'
  );
}

export async function reviewActiveFile(context: vscode.ExtensionContext, extensionUri: vscode.Uri): Promise<void> {
  const ed = vscode.window.activeTextEditor;
  if (!ed) {
    void vscode.window.showWarningMessage('CodeCritic: no active editor.');
    return;
  }
  const doc = ed.document;
  const displayPath = doc.uri.scheme === 'file' ? doc.uri.fsPath.split(/[/\\]/).pop() || 'file' : doc.fileName || 'file';
  await runReviewWithParts(
    context,
    extensionUri,
    [{ displayPath, uri: doc.uri, content: doc.getText(), languageId: doc.languageId }],
    'File'
  );
}

export async function reviewPickedFiles(context: vscode.ExtensionContext, extensionUri: vscode.Uri): Promise<void> {
  const picked = await vscode.window.showOpenDialog({
    canSelectMany: true,
    canSelectFolders: false,
    canSelectFiles: true,
    openLabel: 'Review with CodeCritic',
  });
  if (!picked?.length) return;

  const parts: Array<{ displayPath: string; uri: vscode.Uri; content: string; languageId: string }> = [];
  for (const uri of picked) {
    const doc = await vscode.workspace.openTextDocument(uri);
    parts.push({
      displayPath: uri.fsPath.split(/[/\\]/).pop() || uri.fsPath,
      uri,
      content: doc.getText(),
      languageId: doc.languageId,
    });
  }
  await runReviewWithParts(context, extensionUri, parts, 'Files');
}

export async function reviewFolder(context: vscode.ExtensionContext, extensionUri: vscode.Uri): Promise<void> {
  const picked = await vscode.window.showOpenDialog({
    canSelectMany: false,
    canSelectFolders: true,
    canSelectFiles: false,
    openLabel: 'Review folder with CodeCritic',
  });
  const folder = picked?.[0];
  if (!folder) return;

  const parts = await collectFolderFiles(folder, 80, DEFAULT_MAX_CODE_CHARS);
  if (parts.length === 0) {
    void vscode.window.showWarningMessage('CodeCritic: no suitable text files in folder.');
    return;
  }
  const folderName = folder.fsPath.split(/[/\\]/).filter(Boolean).pop() || 'folder';
  await runReviewWithParts(context, extensionUri, parts, `Folder ${folderName}`);
}

export async function openReviewByUuid(
  context: vscode.ExtensionContext,
  extensionUri: vscode.Uri,
  uuid: string
): Promise<void> {
  if (!(await ensureKey(context))) return;
  const client = makeClient(context);
  try {
    const review = await client.getReview(uuid);
    ReviewPanel.show(extensionUri, client, review, []);
  } catch (e) {
    const m = e instanceof Error ? e.message : String(e);
    void vscode.window.showErrorMessage(`CodeCritic: ${m}`);
  }
}

export async function openLastResult(context: vscode.ExtensionContext, extensionUri: vscode.Uri): Promise<void> {
  const uuid = getRecentReviewUuids(context)[0];
  if (!uuid) {
    void vscode.window.showWarningMessage('CodeCritic: no recent review in this workspace.');
    return;
  }
  await openReviewByUuid(context, extensionUri, uuid);
}

export async function setApiKey(context: vscode.ExtensionContext): Promise<void> {
  const current = (await getApiKey(context)) || '';
  const next = await vscode.window.showInputBox({
    title: 'CodeCritic API key',
    prompt: 'Paste the key from Dashboard → Settings → API key',
    password: true,
    value: current,
    ignoreFocusOut: true,
  });
  if (next === undefined) return;
  if (!next.trim()) {
    await context.secrets.delete('codecritic.apiKey');
    notifySidebarChanged();
    void vscode.window.showInformationMessage('CodeCritic: API key cleared.');
    return;
  }
  const normalized = normalizeApiKey(next);
  if (!normalized) {
    void vscode.window.showErrorMessage('CodeCritic: API key must contain hexadecimal characters only.');
    return;
  }
  const compact = next.replace(/\s+/g, '');
  if (compact !== normalized) {
    void vscode.window.showInformationMessage(
      'CodeCritic: removed invisible or non-hex characters from the key. Paste the key from the dashboard if auth fails.'
    );
  }
  await context.secrets.store('codecritic.apiKey', normalized);
  notifySidebarChanged();
  void vscode.window.showInformationMessage('CodeCritic: API key saved.');
}

export async function openDashboardApiKey(_context: vscode.ExtensionContext): Promise<void> {
  const cfg = vscode.workspace.getConfiguration('codecritic');
  const base = (cfg.get<string>('dashboardUrl') || 'https://code-critic.com').replace(/\/+$/, '');
  const url = `${base}/dashboard?tab=settings`;
  await vscode.env.openExternal(vscode.Uri.parse(url));
}
