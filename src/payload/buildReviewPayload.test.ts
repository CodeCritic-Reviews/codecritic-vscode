import { describe, expect, it } from 'vitest';
import { buildBlobFromParts, resolveBlobLineToFileLine } from './buildReviewPayload';

describe('buildBlobFromParts', () => {
  it('builds a single-file blob with header and language', () => {
    const built = buildBlobFromParts(
      [{ displayPath: 'app.rb', content: "puts 'hi'\nputs 'bye'", languageId: 'ruby' }],
      'Review'
    );
    expect(built.language).toBe('ruby');
    expect(built.title).toBe('Review: app.rb');
    expect(built.code).toContain('=== CodeCritic: app.rb ===');
    expect(built.code).toContain("puts 'hi'");
    expect(built.sections).toHaveLength(1);
    expect(built.sections[0].headerLine).toBe(1);
    expect(built.sections[0].contentStartLine).toBe(2);
    expect(built.sections[0].contentEndLine).toBe(3);
  });

  it('uses autodetect when languages differ', () => {
    const built = buildBlobFromParts(
      [
        { displayPath: 'a.rb', content: 'a', languageId: 'ruby' },
        { displayPath: 'b.ts', content: 'b', languageId: 'typescript' },
      ],
      'Review'
    );
    expect(built.language).toBe('autodetect');
    expect(built.title).toBe('Review: 2 files');
  });
});

describe('resolveBlobLineToFileLine', () => {
  it('maps selection slice with anchorLineInFile', () => {
    const built = buildBlobFromParts(
      [
        {
          displayPath: 'main.ts',
          content: 'line10\nline11',
          languageId: 'typescript',
          anchorLineInFile: 10,
        },
      ],
      'Sel'
    );
    expect(resolveBlobLineToFileLine(built.sections, 1)?.line).toBe(10);
    expect(resolveBlobLineToFileLine(built.sections, 2)?.line).toBe(10);
    expect(resolveBlobLineToFileLine(built.sections, 3)?.line).toBe(11);
    expect(resolveBlobLineToFileLine(built.sections, 99)).toBeNull();
  });

  it('maps whole-file lines from 1 without anchor', () => {
    const built = buildBlobFromParts(
      [{ displayPath: 'x.py', content: 'a\nb\nc', languageId: 'python' }],
      'File'
    );
    expect(resolveBlobLineToFileLine(built.sections, 2)?.line).toBe(1);
    expect(resolveBlobLineToFileLine(built.sections, 4)?.line).toBe(3);
  });
});
