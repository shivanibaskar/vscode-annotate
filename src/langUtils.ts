/**
 * Shared language-detection utilities used by export commands.
 *
 * Centralised here so that adding a new file extension only requires
 * a single change rather than editing every export command separately.
 */

/** Maps file extensions (lower-case, no dot) to fenced-code-block language identifiers. */
export const LANG_MAP: Record<string, string> = {
  ts: 'typescript', tsx: 'typescript',
  js: 'javascript', jsx: 'javascript',
  py: 'python',
  rs: 'rust',
  go: 'go',
  java: 'java',
  cs: 'csharp',
  cpp: 'cpp', cc: 'cpp', cxx: 'cpp',
  c: 'c',
  rb: 'ruby',
  sh: 'bash',
  json: 'json',
  yaml: 'yaml', yml: 'yaml',
  md: 'markdown', mdx: 'markdown',
  rst: 'rst',
  txt: 'plaintext',
  html: 'html',
  css: 'css',
  sql: 'sql',
};

/** Extensions that are prose/markup files (no fenced code block, plain content block instead). */
export const PROSE_EXTS = new Set(['md', 'mdx', 'rst', 'txt']);

/**
 * Returns the fenced-code-block language identifier for a file path.
 * Falls back to the raw extension if not in `LANG_MAP`.
 *
 * @param filePath - Any path or filename; only the extension is examined.
 */
export function langFromPath(filePath: string): string {
  const ext = filePath.split('.').pop()?.toLowerCase() ?? '';
  return LANG_MAP[ext] ?? ext;
}

/**
 * Returns `true` if the file is a prose/markup format that should be
 * rendered as a plain content block rather than a fenced code snippet.
 *
 * @param filePath - Any path or filename; only the extension is examined.
 */
export function isProseFile(filePath: string): boolean {
  const ext = filePath.split('.').pop()?.toLowerCase() ?? '';
  return PROSE_EXTS.has(ext);
}
