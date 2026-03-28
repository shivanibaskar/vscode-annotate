import * as vscode from 'vscode';
import { v4 as uuidv4 } from 'uuid';
import { AnnotationStore } from '../annotationStore';
import { DecorationsManager } from '../decorations';
import { showAnnotationInput } from '../ui/annotationInput';

/** A heading-delimited section of a Markdown document. */
export interface MarkdownSection {
  /** Heading text with `#` prefix, e.g. `"## Usage"`. */
  label: string;
  /** Human-readable line range, e.g. `"Lines 3–15"`. */
  detail: string;
  /** 0-based inclusive start line (the heading line itself). */
  startLine: number;
  /** 0-based inclusive end line (last line before the next heading, or EOF). */
  endLine: number;
}

/** QuickPick item that carries a resolved {@link MarkdownSection}. */
interface SectionItem extends vscode.QuickPickItem {
  section: MarkdownSection;
}

/**
 * Parses ATX-style headings (`# … ` through `###### …`) in a Markdown document
 * into annotatable sections. Each section spans from its heading line to the
 * line immediately before the next heading (any level), or the end of the file.
 *
 * Lines inside fenced code blocks (``` or ~~~) are skipped so that comment
 * characters inside code examples are not mistaken for headings.
 *
 * When no headings are found the entire document is returned as a single
 * section so the caller always has at least one option to offer.
 *
 * @param document The Markdown (or plain-text) VS Code document to parse.
 * @returns Ordered array of sections, one per ATX heading found.
 */
export function parseMarkdownSections(document: vscode.TextDocument): MarkdownSection[] {
  const lineCount = document.lineCount;
  // ATX heading: up to 3 leading spaces, 1–6 `#`, mandatory space, then text.
  const atxRe = /^ {0,3}(#{1,6})\s+(.+)/;

  interface RawHeading { text: string; level: number; line: number; }
  const headings: RawHeading[] = [];

  // Track fenced code blocks so `#` inside them is not treated as a heading.
  // Opening and closing fences must use the same character (' ` ' or '~').
  let fenceChar: string | null = null;

  for (let i = 0; i < lineCount; i++) {
    const text = document.lineAt(i).text;

    // Detect opening / closing fences (``` or ~~~, optional leading spaces ≤3).
    const fenceMatch = /^ {0,3}(`{3,}|~{3,})/.exec(text);
    if (fenceMatch) {
      const ch = fenceMatch[1][0]; // '`' or '~'
      if (fenceChar === null) {
        fenceChar = ch; // entering a fence
      } else if (fenceChar === ch) {
        fenceChar = null; // closing the matching fence
      }
      continue;
    }

    if (fenceChar !== null) { continue; } // inside a fence — skip

    const m = atxRe.exec(text);
    if (m) {
      headings.push({ text: m[2].trim(), level: m[1].length, line: i });
    }
  }

  if (headings.length === 0) {
    return [{
      label: '(entire document)',
      detail: `Lines 1–${lineCount}`,
      startLine: 0,
      endLine: lineCount - 1,
    }];
  }

  return headings.map((h, i) => {
    const prefix = '#'.repeat(h.level);
    // Section ends just before the next heading starts, or at the last line.
    const nextHeadingLine = headings[i + 1]?.line ?? lineCount;
    let endLine = Math.max(h.line, nextHeadingLine - 1);
    // Trim trailing blank lines so sections don't absorb inter-heading whitespace
    // (e.g. the blank line after the last content line before EOF or next heading).
    while (endLine > h.line && document.lineAt(endLine).isEmptyOrWhitespace) {
      endLine--;
    }
    return {
      label: `${prefix} ${h.text}`,
      detail: `Lines ${h.line + 1}–${endLine + 1}`,
      startLine: h.line,
      endLine,
    };
  });
}

/**
 * Attempts to locate the `.md` / `.mdx` / `.rst` source URI that corresponds
 * to the currently active Markdown preview tab.
 *
 * Resolution strategy (most-to-least reliable):
 *  1. Tab API adjacency — find the tab group hosting the active preview WebView,
 *     then search all other groups for a Markdown-language tab. This correctly
 *     handles the standard "Open Preview to the Side" layout without relying on
 *     fragile label matching (preview labels reflect document H1, not filename).
 *  2. Visible text editors — if exactly one `.md*` / `.rst` file is open in any
 *     visible editor pane, use it.
 *  3. Workspace file search — find all Markdown files in the workspace and
 *     show a QuickPick when more than one exists.
 *
 * @returns The resolved URI, or `undefined` if no Markdown file could be found.
 */
async function resolveMarkdownSourceUri(): Promise<vscode.Uri | undefined> {
  const mdExtRe = /\.(md|mdx|rst)$/i;
  const allGroups = vscode.window.tabGroups.all;

  // ── Strategy 1: Tab API adjacency ─────────────────────────────────────────
  // The built-in Markdown preview registers its WebView with viewType
  // 'markdown.preview'. When "Open Preview to the Side" is used the source tab
  // stays in one group and the preview opens in an adjacent group.
  const previewGroupIdx = allGroups.findIndex(g =>
    g.tabs.some(t =>
      t.isActive &&
      t.input instanceof vscode.TabInputWebview &&
      t.input.viewType === 'markdown.preview'
    )
  );

  if (previewGroupIdx !== -1) {
    for (let gi = 0; gi < allGroups.length; gi++) {
      if (gi === previewGroupIdx) { continue; }
      for (const tab of allGroups[gi].tabs) {
        if (tab.input instanceof vscode.TabInputText) {
          const uri = tab.input.uri;
          if (mdExtRe.test(uri.path)) { return uri; }
        }
      }
    }
  }

  // ── Strategy 2: Visible text editors ──────────────────────────────────────
  // Also match by languageId so untitled/temp documents with languageId 'markdown'
  // are found (e.g. in tests and workflows where the file has no .md extension).
  const visibleMd = vscode.window.visibleTextEditors.filter(
    e => mdExtRe.test(e.document.uri.path) || e.document.languageId === 'markdown'
  );
  if (visibleMd.length === 1) { return visibleMd[0].document.uri; }
  if (visibleMd.length > 1)  { return visibleMd[0].document.uri; }

  // ── Strategy 3: Workspace file search ─────────────────────────────────────
  const files = await vscode.workspace.findFiles(
    '**/*.{md,mdx,rst}',
    '**/node_modules/**',
    50
  );
  if (files.length === 0) { return undefined; }
  if (files.length === 1) { return files[0]; }

  const picks = files.map(f => ({
    label: vscode.workspace.asRelativePath(f),
    uri: f,
  }));
  const picked = await vscode.window.showQuickPick(picks, {
    placeHolder: 'Select the Markdown file to annotate',
  });
  return picked?.uri;
}

/**
 * Handles the "annotate from Markdown preview tab" workflow.
 *
 * When the built-in VS Code Markdown preview WebView is focused, the normal
 * `annotateSelection` command cannot run (no active text editor, no selection
 * API). This command provides an alternative flow:
 *
 *  1. Locate the source `.md` file being previewed.
 *  2. Parse its ATX headings into selectable sections.
 *  3. Show a QuickPick so the user can choose which section to annotate —
 *     no tab switch required.
 *  4. Collect a comment and optional tag via the standard two-step input.
 *  5. Persist the annotation against the source file and refresh gutter
 *     decorations if the source tab happens to be visible.
 *
 * If the source tab is not visible, the annotation is still saved; gutter
 * decorations will appear the next time the source tab is opened.
 *
 * @param store      The active {@link AnnotationStore}.
 * @param decorations The active {@link DecorationsManager}.
 */
export async function annotateFromMarkdownPreview(
  store: AnnotationStore,
  decorations: DecorationsManager
): Promise<void> {
  const mdUri = await resolveMarkdownSourceUri();
  if (!mdUri) {
    vscode.window.showErrorMessage(
      'Annotate: Could not find a Markdown source file for this preview.'
    );
    return;
  }

  // Open the document model without stealing focus or opening a new editor tab.
  const document = await vscode.workspace.openTextDocument(mdUri);
  const sections = parseMarkdownSections(document);

  const items: SectionItem[] = sections.map(s => ({
    label: s.label,
    detail: s.detail,
    section: s,
  }));

  const picked = await vscode.window.showQuickPick<SectionItem>(items, {
    placeHolder: 'Select the section to annotate',
    matchOnDetail: true,
  });
  if (!picked) { return; }

  const result = await showAnnotationInput({ title: 'New Annotation (Markdown Preview)' });
  if (result === undefined) { return; }
  // Guard retained for consistency with annotateSelection, though showAnnotationInput
  // already validates non-empty via its InputBox validateInput callback.
  if (result.comment === '') {
    vscode.window.showWarningMessage('Annotate: Comment cannot be empty.');
    return;
  }

  const fileUri = vscode.workspace.asRelativePath(mdUri, false);
  const now = new Date().toISOString();
  const { startLine, endLine } = picked.section;

  const snapshotRange = new vscode.Range(
    new vscode.Position(startLine, 0),
    new vscode.Position(endLine, Number.MAX_SAFE_INTEGER)
  );
  const contentSnapshot = document.getText(snapshotRange);

  await store.add({
    id: uuidv4(),
    fileUri,
    range: { start: startLine, end: endLine },
    comment: result.comment,
    ...(result.tag ? { tag: result.tag } : {}),
    contentSnapshot,
    createdAt: now,
    updatedAt: now,
  });

  // Refresh gutter decorations only if the source editor is currently visible.
  // When the source tab is not open the annotation is saved and decorations will
  // appear automatically the next time the file is opened.
  const sourceEditor = vscode.window.visibleTextEditors.find(
    e => e.document.uri.fsPath === mdUri.fsPath
  );
  if (sourceEditor) {
    await decorations.refresh(sourceEditor);
  }

  vscode.window.showInformationMessage('Annotation saved.');
}
