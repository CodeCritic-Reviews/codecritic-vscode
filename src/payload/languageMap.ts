/** Map VS Code language id to CodeCritic API language (see CodeReview::LANGUAGES). */
const MAP: Record<string, string> = {
  javascript: 'javascript',
  jsx: 'javascript',
  typescript: 'typescript',
  typescriptreact: 'typescript',
  python: 'python',
  ruby: 'ruby',
  java: 'java',
  go: 'go',
  php: 'php',
  csharp: 'csharp',
  cpp: 'cpp',
  c: 'c',
  rust: 'rust',
  swift: 'swift',
  kotlin: 'kotlin',
};

export function vscodeLanguageToApi(languageId: string): string {
  const id = languageId.toLowerCase();
  return MAP[id] ?? 'autodetect';
}
