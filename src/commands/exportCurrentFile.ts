import * as vscode from 'vscode';
import { AnnotationStore } from '../annotationStore';
import { ExportPreviewPanel } from '../panels/exportPreviewPanel';
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
  html: 'html',
  css: 'css',
  sql: 'sql',
};

function langFromPath(filePath: string): string {
  const ext = filePath.split('.').pop()?.toLowerCase() ?? '';
  return LANG_MAP[ext] ?? ext;
}

function formatAnnotation(
  annotation: Annotation,
  lines: string[],
  includeContents: boolean
): string {
  const { range, comment, tag } = annotation;
  const startLine = range.start + 1;
  const endLine = range.end + 1;
  const lineLabel = startLine === endLine ? `Line ${startLine}` : `Lines ${startLine}–${endLine}`;

  const tagLine = tag ? `  TAG: ${tag}\n` : '';
  let block = `  [${lineLabel}]\n${tagLine}  COMMENT: ${comment}\n`;

  if (includeContents) {
    const snippet = lines.slice(range.start, range.end + 1).join('\n');
    const lang = langFromPath(annotation.fileUri);
    block += `\n  CODE:\n  \`\`\`${lang}\n${snippet}\n  \`\`\`\n`;
  }

  return block;
}

export async function exportCurrentFile(store: AnnotationStore): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    vscode.window.showErrorMessage('Annotate: No active editor.');
    return;
  }

  const relPath = vscode.workspace.asRelativePath(editor.document.uri, false);
  const annotations = (await store.getForFile(relPath))
    .sort((a, b) => a.range.start - b.range.start);

  if (annotations.length === 0) {
    vscode.window.showWarningMessage(`Annotate: No annotations for ${relPath}.`);
    return;
  }

  const includeContents = vscode.workspace
    .getConfiguration('annotate')
    .get<boolean>('includeFileContents', true);

  const lines = editor.document.getText().split('\n');

  const parts: string[] = [
    `=== ANNOTATED CODE CONTEXT ===`,
    `File: ${relPath}`,
    `Generated: ${new Date().toISOString()}`,
    '',
  ];

  for (const annotation of annotations) {
    parts.push(formatAnnotation(annotation, lines, includeContents));
  }

  parts.push('=== END OF ANNOTATIONS ===');

  ExportPreviewPanel.show(parts.join('\n'));
}
