import * as vscode from 'vscode';
import { vscodeLanguageToApi } from './languageMap';

export const DEFAULT_MAX_CODE_CHARS = 20_000;

export interface BlobSection {
  displayPath: string;
  uri: vscode.Uri;
  /** 1-based line index in the combined blob where the `===` header line starts */
  headerLine: number;
  /** 1-based first line of file content inside the blob */
  contentStartLine: number;
  /** 1-based last line of file content (inclusive) */
  contentEndLine: number;
  /** If set, content is a slice: this is the real 1-based file line for `contentStartLine` in the blob */
  anchorLineInFile?: number;
}

export interface BuiltPayload {
  code: string;
  language: string;
  title: string;
  sections: BlobSection[];
}

/** One file or selection sent as part of a combined review payload */
export type ReviewContentPart = {
  displayPath: string;
  uri: vscode.Uri;
  content: string;
  languageId: string;
  anchorLineInFile?: number;
};

const HEADER_PREFIX = '=== CodeCritic: ';
const HEADER_SUFFIX = ' ===';

export function buildFromParts(parts: ReviewContentPart[], titleHint: string): BuiltPayload {
  const lines: string[] = [];
  const sections: BlobSection[] = [];
  let blobLine = 1;

  const languages = new Set<string>();

  for (const p of parts) {
    const header = `${HEADER_PREFIX}${p.displayPath}${HEADER_SUFFIX}`;
    const headerLine = blobLine;
    lines.push(header);
    blobLine += 1;

    const contentStartLine = blobLine;
    const body = p.content.replace(/\r\n/g, '\n');
    const bodyLines = body.length === 0 ? [''] : body.split('\n');
    for (const bl of bodyLines) {
      lines.push(bl);
    }
    blobLine += bodyLines.length;
    const contentEndLine = blobLine - 1;

    languages.add(vscodeLanguageToApi(p.languageId));

    sections.push({
      displayPath: p.displayPath,
      uri: p.uri,
      headerLine,
      contentStartLine,
      contentEndLine,
      anchorLineInFile: p.anchorLineInFile,
    });
  }

  const code = lines.join('\n');
  let language = 'autodetect';
  if (languages.size === 1) {
    language = [...languages][0];
  }

  const title =
    parts.length === 1
      ? `${titleHint}: ${parts[0].displayPath}`
      : `${titleHint}: ${parts.length} files`;

  return { code, language, title, sections };
}

export function resolveBlobLineToEditor(
  sections: BlobSection[],
  blobLine: number
): { uri: vscode.Uri; line: number } | null {
  for (const s of sections) {
    if (blobLine === s.headerLine) {
      const line = s.anchorLineInFile ?? 1;
      return { uri: s.uri, line };
    }
    if (blobLine >= s.contentStartLine && blobLine <= s.contentEndLine) {
      const offset = blobLine - s.contentStartLine;
      const line =
        s.anchorLineInFile != null ? s.anchorLineInFile + offset : offset + 1;
      return { uri: s.uri, line };
    }
  }
  return null;
}
