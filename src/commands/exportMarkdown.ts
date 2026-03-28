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
  html: 'html',
  css: 'css',
  sql: 'sql',
};

function langFromPath(filePath: string): string {
  const ext = filePath.split('.').pop()?.toLowerCase() ?? '';
  return LANG_MAP[ext] ?? ext;
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
  const { range, comment, tag } = annotation;
  const startLine = range.start + 1;
  const endLine = range.end + 1;
  const lineLabel = startLine === endLine ? `Line ${startLine}` : `Lines ${startLine}–${endLine}`;

  const tagBadge = tag ? ` \`[${tag}]\`` : '';
  let block = `### ${lineLabel}${tagBadge}\n\n> ${comment}\n`;

  if (includeContents && lines) {
    const snippet = lines.slice(range.start, range.end + 1).join('\n');
    const lang = langFromPath(annotation.fileUri);
    block += `\n\`\`\`${lang}\n${snippet}\n\`\`\`\n`;
  }

  return block;
}

export async function exportMarkdown(store: AnnotationStore): Promise<void> {
  const data = await store.load();

  if (data.annotations.length === 0) {
    vscode.window.showWarningMessage('Annotate: No annotations to export.');
    return;
  }

  const includeContents = vscode.workspace
    .getConfiguration('annotate')
    .get<boolean>('includeFileContents', true);

  const byFile = new Map<string, Annotation[]>();
  for (const annotation of data.annotations) {
    const list = byFile.get(annotation.fileUri) ?? [];
    list.push(annotation);
    byFile.set(annotation.fileUri, list);
  }

  const parts: string[] = ['# Annotated Code Context\n'];

  const sortedFiles = [...byFile.keys()].sort();
  for (const filePath of sortedFiles) {
    const annotations = byFile.get(filePath)!
      .sort((a, b) => a.range.start - b.range.start);

    parts.push(`## ${filePath}\n`);

    const lines = includeContents ? await readLines(filePath) : null;
    for (const annotation of annotations) {
      parts.push(formatAnnotation(annotation, lines, includeContents));
    }
  }

  const output = parts.join('\n');

  const doc = await vscode.workspace.openTextDocument({
    language: 'markdown',
    content: output,
  });
  await vscode.window.showTextDocument(doc);
}
