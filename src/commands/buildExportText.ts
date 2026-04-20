import * as vscode from 'vscode';
import * as path from 'path';
import { AnnotationStore } from '../annotationStore';
import { Annotation } from '../types';
import { langFromPath, isProseFile } from '../langUtils';

async function readLines(fileUri: string): Promise<string[] | null> {
  const folders = vscode.workspace.workspaceFolders;
  if (!folders || folders.length === 0) { return null; }
  const workspaceRoot = folders[0].uri.fsPath;
  // Validate that the resolved path stays within the workspace — a crafted
  // annotation with "../../.ssh/id_rsa" as fileUri could otherwise escape.
  const resolved = path.resolve(workspaceRoot, fileUri);
  if (resolved !== workspaceRoot && !resolved.startsWith(workspaceRoot + path.sep)) {
    return null;
  }
  try {
    const uri = vscode.Uri.joinPath(folders[0].uri, fileUri);
    const raw = await vscode.workspace.fs.readFile(uri);
    return Buffer.from(raw).toString('utf8').split('\n');
  } catch {
    return null;
  }
}

/** Escapes reserved XML characters in attribute values and text content. */
function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Formats a single annotation as plain text (used by default/gpt/custom templates).
 *
 * @param annotation     - The annotation to format.
 * @param lines          - All lines of the source file; null if unavailable.
 * @param includeContents - Whether to embed the annotated source lines.
 * @param contextLines   - Number of surrounding lines to include above/below the range.
 */
function formatAnnotationPlain(
  annotation: Annotation,
  lines: string[] | null,
  includeContents: boolean,
  contextLines: number
): string {
  const { range, comment } = annotation;
  const startLine = range.start + 1;
  const endLine   = range.end + 1;
  const lineLabel = startLine === endLine ? `Line ${startLine}` : `Lines ${startLine}–${endLine}`;

  const tagLine = annotation.tag ? `  TAG: ${annotation.tag}\n` : '';
  let block = `  [${lineLabel}]\n${tagLine}  COMMENT: ${comment}\n`;

  if (includeContents && lines) {
    // Context lines before the annotated range
    if (contextLines > 0) {
      const ctxStart = Math.max(0, range.start - contextLines);
      const ctxBefore = lines.slice(ctxStart, range.start);
      if (ctxBefore.length > 0) {
        const ctxLabel = ctxStart + 1 === range.start
          ? `line ${ctxStart + 1}`
          : `lines ${ctxStart + 1}–${range.start}`;
        block += `\n  CONTEXT BEFORE (${ctxLabel}):\n${ctxBefore.map(l => `  ${l}`).join('\n')}\n`;
      }
    }

    const snippet = lines.slice(range.start, range.end + 1).join('\n');
    if (isProseFile(annotation.fileUri)) {
      block += `\n  CONTENT:\n${snippet.split('\n').map(l => `  ${l}`).join('\n')}\n`;
    } else {
      const lang = langFromPath(annotation.fileUri);
      block += `\n  CODE:\n  \`\`\`${lang}\n${snippet}\n  \`\`\`\n`;
    }

    // Context lines after the annotated range
    if (contextLines > 0) {
      const ctxEnd = Math.min(lines.length - 1, range.end + contextLines);
      const ctxAfter = lines.slice(range.end + 1, ctxEnd + 1);
      if (ctxAfter.length > 0) {
        const ctxLabel = range.end + 2 === ctxEnd + 1
          ? `line ${range.end + 2}`
          : `lines ${range.end + 2}–${ctxEnd + 1}`;
        block += `\n  CONTEXT AFTER (${ctxLabel}):\n${ctxAfter.map(l => `  ${l}`).join('\n')}\n`;
      }
    }
  }

  return block;
}

/**
 * Builds the full export text in Anthropic-recommended XML format for the `claude` template.
 *
 * Structure: `<code_annotations>` → `<file path="…">` → `<annotation lines="…" tag="…">` →
 * `<note>` + optional `<context position="before/after">` + `<code lang="…">` / `<content>`.
 *
 * XML attributes and text content are fully escaped; code/prose content is left verbatim
 * inside its element so the LLM receives the literal source text.
 *
 * @param byFile          - Annotations grouped by file path (unsorted).
 * @param fileLines       - Source lines for each file, or null if unavailable/skipped.
 * @param includeContents - Whether to embed annotated source lines.
 * @param contextLines    - Number of surrounding lines to include above/below each range.
 */
function buildClaudeXml(
  byFile: Map<string, Annotation[]>,
  fileLines: Map<string, string[] | null>,
  includeContents: boolean,
  contextLines: number
): string {
  const parts: string[] = ['<code_annotations>'];

  for (const filePath of [...byFile.keys()].sort()) {
    const annotations = byFile.get(filePath)!.sort((a, b) => a.range.start - b.range.start);
    parts.push(`  <file path="${escapeXml(filePath)}">`);

    const lines = fileLines.get(filePath) ?? null;

    for (const ann of annotations) {
      const { range, comment, tag } = ann;
      const startLine = range.start + 1;
      const endLine   = range.end + 1;
      const linesAttr = startLine === endLine ? String(startLine) : `${startLine}-${endLine}`;
      const tagAttr   = tag ? ` tag="${escapeXml(tag)}"` : '';

      parts.push(`    <annotation lines="${linesAttr}"${tagAttr}>`);
      parts.push(`      <note>${escapeXml(comment)}</note>`);

      if (includeContents && lines && range.start < lines.length) {
        // Context before the annotated range
        if (contextLines > 0) {
          const ctxStart = Math.max(0, range.start - contextLines);
          const ctxBefore = lines.slice(ctxStart, range.start);
          if (ctxBefore.length > 0) {
            const ctxLinesAttr = ctxStart + 1 === range.start
              ? String(ctxStart + 1)
              : `${ctxStart + 1}-${range.start}`;
            parts.push(`      <context position="before" lines="${ctxLinesAttr}">`);
            parts.push(ctxBefore.join('\n'));
            parts.push('      </context>');
          }
        }

        const snippet = lines.slice(range.start, Math.min(range.end + 1, lines.length)).join('\n');
        if (isProseFile(filePath)) {
          parts.push('      <content>');
          parts.push(snippet);
          parts.push('      </content>');
        } else {
          const lang = langFromPath(filePath);
          parts.push(`      <code lang="${escapeXml(lang)}">`);
          parts.push(snippet);
          parts.push('      </code>');
        }

        // Context after the annotated range
        if (contextLines > 0) {
          const ctxEnd = Math.min(lines.length - 1, range.end + contextLines);
          const ctxAfter = lines.slice(range.end + 1, ctxEnd + 1);
          if (ctxAfter.length > 0) {
            const ctxLinesAttr = range.end + 2 === ctxEnd + 1
              ? String(range.end + 2)
              : `${range.end + 2}-${ctxEnd + 1}`;
            parts.push(`      <context position="after" lines="${ctxLinesAttr}">`);
            parts.push(ctxAfter.join('\n'));
            parts.push('      </context>');
          }
        }
      }

      parts.push('    </annotation>');
    }

    parts.push('  </file>');
  }

  parts.push('</code_annotations>');
  return parts.join('\n');
}

type PromptTemplate = 'default' | 'claude' | 'gpt' | 'custom';

const TEMPLATE_WRAPPERS: Record<Exclude<PromptTemplate, 'claude'>, { header: string; footer: string }> = {
  default: { header: '=== ANNOTATED CODE CONTEXT ===',   footer: '=== END OF ANNOTATIONS ===' },
  gpt:     { header: '```annotated-context',              footer: '```' },
  custom:  { header: '',                                  footer: '' },
};

function resolveWrapper(template: PromptTemplate, customTemplate: string): { header: string; footer: string } {
  if (template === 'claude') {
    // claude uses its own XML render path; this fallback should never be reached.
    return TEMPLATE_WRAPPERS.default;
  }
  if (template === 'custom') {
    const parts = customTemplate.split('|||');
    if (parts.length === 2) { return { header: parts[0], footer: parts[1] }; }
    return TEMPLATE_WRAPPERS.default;
  }
  return TEMPLATE_WRAPPERS[template];
}

/**
 * Builds the full export text for the current annotation set, applying the
 * active prompt template, optional preamble, and optional context lines.
 *
 * The `claude` template generates a semantically structured XML document
 * (`<code_annotations>`) following Anthropic's recommended grounding format.
 * All other templates produce plain/fenced text blocks.
 *
 * Returns `null` if there are no annotations (callers show their own warning).
 *
 * @param store - The active annotation store.
 */
export async function buildExportText(store: AnnotationStore): Promise<string | null> {
  const data = await store.load();
  if (data.annotations.length === 0) { return null; }

  const config          = vscode.workspace.getConfiguration('annotate');
  const includeContents = config.get<boolean>('includeFileContents', true);
  const templateKey     = config.get<PromptTemplate>('promptTemplate', 'default');
  const customTemplate  = config.get<string>('promptTemplateCustom', '');
  const preamble        = config.get<string>('exportPreamble', '').trim();
  // Clamp to 0 to guard against negative values from misconfigured settings.
  const contextLines    = Math.max(0, config.get<number>('exportContextLines', 0));

  const byFile = new Map<string, Annotation[]>();
  for (const annotation of data.annotations) {
    const list = byFile.get(annotation.fileUri) ?? [];
    list.push(annotation);
    byFile.set(annotation.fileUri, list);
  }

  // ── Claude XML template (dedicated render path) ──────────────────────────
  if (templateKey === 'claude') {
    const fileLines = new Map<string, string[] | null>();
    if (includeContents) {
      for (const filePath of byFile.keys()) {
        fileLines.set(filePath, await readLines(filePath));
      }
    }
    const xml = buildClaudeXml(byFile, fileLines, includeContents, contextLines);
    return preamble ? `${preamble}\n\n${xml}` : xml;
  }

  // ── Plain-text templates (default / gpt / custom) ────────────────────────
  const wrapper       = resolveWrapper(templateKey, customTemplate);
  const workspaceName = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? '';

  const parts: string[] = [];
  if (preamble) { parts.push(preamble, ''); }
  parts.push(
    wrapper.header,
    `Generated: ${new Date().toISOString()}`,
    `Workspace: ${workspaceName}`,
    '',
  );

  for (const filePath of [...byFile.keys()].sort()) {
    const annotations = byFile.get(filePath)!.sort((a, b) => a.range.start - b.range.start);
    parts.push(`--- FILE: ${filePath} ---`);
    parts.push('');

    const lines = includeContents ? await readLines(filePath) : null;
    for (const annotation of annotations) {
      parts.push(formatAnnotationPlain(annotation, lines, includeContents, contextLines));
    }
  }

  parts.push(wrapper.footer);
  return parts.join('\n');
}
