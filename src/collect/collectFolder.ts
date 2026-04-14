import * as vscode from 'vscode';

const SKIP_DIRS = new Set([
  'node_modules',
  '.git',
  'dist',
  'out',
  'build',
  '.next',
  'coverage',
  '__pycache__',
  '.venv',
  'vendor',
]);

const TEXT_EXT = /\.(ts|tsx|js|jsx|mjs|cjs|py|rb|go|java|kt|kts|swift|rs|c|h|cpp|hpp|cc|cs|php|vue|svelte|astro|json|yaml|yml|toml|md|html|css|scss|less|sql|sh|bash|zsh|dockerfile|graphql)$/i;

export async function collectFolderFiles(
  folder: vscode.Uri,
  maxFiles: number,
  maxTotalChars: number
): Promise<Array<{ displayPath: string; uri: vscode.Uri; content: string; languageId: string }>> {
  const found: { rel: string; uri: vscode.Uri }[] = [];

  async function walk(dir: vscode.Uri, relBase: string): Promise<void> {
    if (found.length >= maxFiles) return;
    let entries: [string, vscode.FileType][];
    try {
      entries = await vscode.workspace.fs.readDirectory(dir);
    } catch {
      return;
    }
    entries.sort((a, b) => a[0].localeCompare(b[0]));
    for (const [name, typ] of entries) {
      if (found.length >= maxFiles) return;
      if (typ === vscode.FileType.Directory) {
        if (SKIP_DIRS.has(name)) continue;
        const nextRel = relBase ? `${relBase}/${name}` : name;
        await walk(vscode.Uri.joinPath(dir, name), nextRel);
      } else if (typ === vscode.FileType.File) {
        if (!TEXT_EXT.test(name) && name !== 'Dockerfile') continue;
        const rel = relBase ? `${relBase}/${name}` : name;
        found.push({ rel, uri: vscode.Uri.joinPath(dir, name) });
      }
    }
  }

  await walk(folder, '');

  const parts: Array<{ displayPath: string; uri: vscode.Uri; content: string; languageId: string }> = [];
  let total = 0;

  for (const f of found) {
    if (parts.length >= maxFiles) break;
    let raw: Uint8Array;
    try {
      raw = await vscode.workspace.fs.readFile(f.uri);
    } catch {
      continue;
    }
    if (raw.byteLength > 512 * 1024) continue;
    const text = new TextDecoder('utf-8', { fatal: false }).decode(raw);
    const slice = text.length + f.rel.length + 80;
    if (total + slice > maxTotalChars) break;
    total += slice;
    const doc = await vscode.workspace.openTextDocument(f.uri);
    parts.push({
      displayPath: f.rel,
      uri: f.uri,
      content: text,
      languageId: doc.languageId,
    });
  }

  return parts;
}
