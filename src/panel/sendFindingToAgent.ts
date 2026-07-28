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

export type AllFindingsPromptInput = {
  reviewUuid: string;
  reviewTitle?: string | null;
  siteUrl?: string;
  score?: number;
  summary?: string;
  strengths?: string[];
  improvements?: string[];
  issues: Array<{
    message: string;
    severity?: string;
    path?: string;
    line?: number;
    suggestion?: string;
    suggestionCode?: string;
  }>;
  suggestions: string[];
};

/** Pure builder - unit-tested. */
export function buildAllFindingsPrompt(p: AllFindingsPromptInput): string {
  const title = (p.reviewTitle || 'Code review').trim();
  const lines: string[] = [
    '## CodeCritic review - apply fixes in this workspace',
    '',
    `- **Review:** ${title}`,
    `- **Review id:** ${p.reviewUuid}`,
  ];
  if (p.siteUrl) {
    lines.push(`- **Open on site:** ${p.siteUrl}`);
  }
  if (p.score != null) {
    lines.push(`- **Score:** ${p.score}`);
  }
  if (p.summary?.trim()) {
    lines.push('', '### Summary', p.summary.trim());
  }
  if (p.strengths?.length) {
    lines.push('', '### Strengths');
    for (const s of p.strengths) lines.push(`- ${s}`);
  }
  if (p.improvements?.length) {
    lines.push('', '### Improvements');
    for (const s of p.improvements) lines.push(`- ${s}`);
  }
  if (p.issues.length) {
    lines.push('', `### Issues (${p.issues.length})`);
    p.issues.forEach((iss, i) => {
      const loc = [iss.path, iss.line != null ? `line ${iss.line}` : null].filter(Boolean).join(', ');
      const sev = iss.severity ? ` [${iss.severity}]` : '';
      lines.push('', `#### ${i + 1}.${sev}${loc ? ` (${loc})` : ''}`, iss.message);
      if (iss.suggestion?.trim()) lines.push('', `Hint: ${iss.suggestion.trim()}`);
      if (iss.suggestionCode?.trim()) {
        lines.push('', '```', iss.suggestionCode.trim(), '```');
      }
    });
  }
  if (p.suggestions.length) {
    lines.push('', `### Suggestions (${p.suggestions.length})`);
    p.suggestions.forEach((s, i) => {
      lines.push(`${i + 1}. ${s}`);
    });
  }
  lines.push(
    '',
    'Work through the issues in order. Prefer minimal correct fixes that match project style. Open files as needed.'
  );
  return lines.join('\n');
}

export async function sendAllFindingsToAgent(p: AllFindingsPromptInput): Promise<void> {
  if (!p.issues.length && !p.suggestions.length && !p.summary?.trim()) {
    void vscode.window.showWarningMessage('CodeCritic: nothing to copy - review has no findings yet.');
    return;
  }
  const prompt = buildAllFindingsPrompt(p);
  if (await tryOpenChatWithQuery(prompt)) {
    void vscode.window.showInformationMessage('CodeCritic: full review sent to Chat / Agent.');
    return;
  }
  await vscode.env.clipboard.writeText(prompt);
  try {
    await vscode.commands.executeCommand('workbench.action.chat.open');
    void vscode.window.showInformationMessage(
      'CodeCritic: full review copied. Paste into Chat or Agent if the field is empty.'
    );
  } catch {
    void vscode.window.showInformationMessage(
      'CodeCritic: full review copied to clipboard. Open Chat / Agent and paste.'
    );
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
