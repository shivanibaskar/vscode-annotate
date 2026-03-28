import * as vscode from 'vscode';
import { AnnotationStore } from '../annotationStore';
import { Annotation } from '../types';

const LANG_MAP: Record<string, string> = {
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
  md: 'markdown',
  mdx: 'markdown',
  rst: 'rst',
  txt: 'plaintext',
  html: 'html',
  css: 'css',
  sql: 'sql',
};

const PROSE_EXTS = new Set(['md', 'mdx', 'rst', 'txt']);

function langFromPath(filePath: string): string {
  const ext = filePath.split('.').pop()?.toLowerCase() ?? '';
  return LANG_MAP[ext] ?? ext;
}

function isProseFile(filePath: string): boolean {
  const ext = filePath.split('.').pop()?.toLowerCase() ?? '';
  return PROSE_EXTS.has(ext);
}

async function readLines(fileUri: string): Promise<string[] | null> {
  const folders = vscode.workspace.workspaceFolders;
  if (!folders || folders.length === 0) { return null; }
  try {
    const uri = vscode.Uri.joinPath(folders[0].uri, fileUri);
    const raw = await vscode.workspace.fs.readFile(uri);
    return Buffer.from(raw).toString('utf8').split('\n');
  } catch {
    return null;
  }
}

function formatAnnotation(
  annotation: Annotation,
  lines: string[] | null,
  includeContents: boolean
): string {
  const { range, comment } = annotation;
  const startLine = range.start + 1;
  const endLine   = range.end + 1;
  const lineLabel = startLine === endLine ? `Line ${startLine}` : `Lines ${startLine}–${endLine}`;

  const tagLine = annotation.tag ? `  TAG: ${annotation.tag}\n` : '';
  let block = `  [${lineLabel}]\n${tagLine}  COMMENT: ${comment}\n`;

  if (includeContents && lines) {
    const snippet = lines.slice(range.start, range.end + 1).join('\n');
    if (isProseFile(annotation.fileUri)) {
      block += `\n  CONTENT:\n${snippet.split('\n').map(l => `  ${l}`).join('\n')}\n`;
    } else {
      const lang = langFromPath(annotation.fileUri);
      block += `\n  CODE:\n  \`\`\`${lang}\n${snippet}\n  \`\`\`\n`;
    }
  }

  return block;
}

type PromptTemplate = 'default' | 'claude' | 'gpt' | 'custom';

const TEMPLATE_WRAPPERS: Record<PromptTemplate, { header: string; footer: string }> = {
  default: { header: '=== ANNOTATED CODE CONTEXT ===',   footer: '=== END OF ANNOTATIONS ===' },
  claude:  { header: '<annotated_context>',               footer: '</annotated_context>' },
  gpt:     { header: '```annotated-context',              footer: '```' },
  custom:  { header: '',                                  footer: '' },
};

function resolveWrapper(template: PromptTemplate, customTemplate: string): { header: string; footer: string } {
  if (template === 'custom') {
    const parts = customTemplate.split('|||');
    if (parts.length === 2) { return { header: parts[0], footer: parts[1] }; }
    return TEMPLATE_WRAPPERS.default;
  }
  return TEMPLATE_WRAPPERS[template];
}

/**
 * Builds the full export text for the current annotation set.
 * Returns `null` if there are no annotations (callers show their own warning).
 *
 * @param store - The active annotation store.
 */
export async function buildExportText(store: AnnotationStore): Promise<string | null> {
  const data = await store.load();
  if (data.annotations.length === 0) { return null; }

  const config           = vscode.workspace.getConfiguration('annotate');
  const includeContents  = config.get<boolean>('includeFileContents', true);
  const templateKey      = config.get<PromptTemplate>('promptTemplate', 'default');
  const customTemplate   = config.get<string>('promptTemplateCustom', '');
  const wrapper          = resolveWrapper(templateKey, customTemplate);

  const byFile = new Map<string, Annotation[]>();
  for (const annotation of data.annotations) {
    const list = byFile.get(annotation.fileUri) ?? [];
    list.push(annotation);
    byFile.set(annotation.fileUri, list);
  }

  const workspaceName = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? '';
  const parts: string[] = [
    wrapper.header,
    `Generated: ${new Date().toISOString()}`,
    `Workspace: ${workspaceName}`,
    '',
  ];

  for (const filePath of [...byFile.keys()].sort()) {
    const annotations = byFile.get(filePath)!.sort((a, b) => a.range.start - b.range.start);
    parts.push(`--- FILE: ${filePath} ---`);
    parts.push('');

    const lines = includeContents ? await readLines(filePath) : null;
    for (const annotation of annotations) {
      parts.push(formatAnnotation(annotation, lines, includeContents));
    }
  }

  parts.push(wrapper.footer);
  return parts.join('\n');
}
