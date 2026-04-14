import * as vscode from 'vscode';
import type { BlobSection } from '../payload/buildReviewPayload';
import { resolveBlobLineToEditor } from '../payload/buildReviewPayload';

export interface SendToAgentFields {
  reviewUuid: string;
  reviewTitle?: string | null;
  itemKind: 'issue' | 'suggestion';
  itemIndex: number;
  message: string;
  path?: string;
  line?: number;
  suggestion?: string;
  suggestionCode?: string;
}

function buildPrompt(
  p: SendToAgentFields,
  ctx: { resolvedPath?: string; resolvedLine?: number }
): string {
  const title = (p.reviewTitle || 'Code review').trim();
  const lines: string[] = [
    '## CodeCritic finding (apply a minimal fix in this workspace)',
    '',
    `- **Review:** ${title}`,
    `- **Finding:** ${p.itemKind} #${p.itemIndex} (review ${p.reviewUuid})`,
    `- **Type:** ${p.itemKind}`,
  ];
  if (ctx.resolvedPath) {
    lines.push(`- **File:** ${ctx.resolvedPath}`);
  } else if (p.path) {
    lines.push(`- **Path (from review):** ${p.path}`);
  }
  if (ctx.resolvedLine != null) {
    lines.push(`- **Line (mapped to workspace):** ${ctx.resolvedLine}`);
  } else if (p.line != null) {
    lines.push(
      `- **Line (from review output):** ${p.line} (if the review bundled several files, confirm in the editor)`
    );
  }
  lines.push('', '### Finding', p.message);
  if (p.suggestion?.trim()) {
    lines.push('', '### Extra hint', p.suggestion.trim());
  }
  if (p.suggestionCode?.trim()) {
    lines.push('', '### Suggested code', '```', p.suggestionCode.trim(), '```');
  }
  lines.push(
    '',
    'Open the file above if needed, apply a minimal correct fix, and match the project style.'
  );
  return lines.join('\n');
}

async function tryOpenDocumentForFinding(
  sections: BlobSection[],
  pathRel: string | undefined,
  blobLine: number | undefined
): Promise<{ fsPath?: string; line?: number }> {
  if (blobLine != null && sections.length > 0) {
    const mapped = resolveBlobLineToEditor(sections, blobLine);
    if (mapped) {
      try {
        const doc = await vscode.workspace.openTextDocument(mapped.uri);
        const ed = await vscode.window.showTextDocument(doc);
        const pos = new vscode.Position(Math.max(0, mapped.line - 1), 0);
        ed.selection = new vscode.Selection(pos, pos);
        ed.revealRange(new vscode.Range(pos, pos));
        return { fsPath: doc.uri.fsPath, line: mapped.line };
      } catch {
        /* fall through */
      }
    }
  }

  const clean = pathRel?.trim().replace(/^[/\\]+/, '');
  if (!clean) {
    return {};
  }
  const folders = vscode.workspace.workspaceFolders;
  if (!folders?.length) {
    return {};
  }
  for (const f of folders) {
    const u = vscode.Uri.joinPath(f.uri, clean);
    try {
      const doc = await vscode.workspace.openTextDocument(u);
      await vscode.window.showTextDocument(doc);
      return { fsPath: doc.uri.fsPath };
    } catch {
      /* try next root */
    }
  }
  return {};
}

async function tryOpenChatWithQuery(query: string): Promise<boolean> {
  try {
    await vscode.commands.executeCommand('workbench.action.chat.open', { query });
    return true;
  } catch {
    /* try string form (older / other hosts) */
  }
  try {
    await vscode.commands.executeCommand('workbench.action.chat.open', query);
    return true;
  } catch {
    return false;
  }
}

export async function sendFindingToAgent(sections: BlobSection[], p: SendToAgentFields): Promise<void> {
  const msg = p.message?.trim();
  if (!msg) {
    void vscode.window.showErrorMessage('CodeCritic: empty finding text; nothing to send.');
    return;
  }

  const { fsPath, line } = await tryOpenDocumentForFinding(sections, p.path, p.line);
  const prompt = buildPrompt(p, { resolvedPath: fsPath, resolvedLine: line });

  if (await tryOpenChatWithQuery(prompt)) {
    return;
  }

  await vscode.env.clipboard.writeText(prompt);
  try {
    await vscode.commands.executeCommand('workbench.action.chat.open');
    void vscode.window.showInformationMessage(
      'CodeCritic: fix prompt copied to clipboard. Paste into Chat or Agent if the field is empty (e.g. Ctrl+L / Cmd+L).'
    );
  } catch {
    void vscode.window.showInformationMessage(
      'CodeCritic: fix prompt copied. Open Chat or Agent manually and paste (e.g. Ctrl+L / Cmd+L).'
    );
  }
}
