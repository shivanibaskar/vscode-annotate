import * as assert from 'assert';
import * as vscode from 'vscode';
import { AnnotationStore } from '../../annotationStore';
import { DecorationsManager } from '../../decorations';
import { parseMarkdownSections, annotateFromMarkdownPreview } from '../../commands/annotateFromMarkdownPreview';
import * as annotationInputModule from '../../ui/annotationInput';
import { AnnotationTag } from '../../types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Open an in-memory Markdown document and return it (without showing an editor). */
async function openMdDocument(content: string): Promise<vscode.TextDocument> {
  return vscode.workspace.openTextDocument({ content, language: 'markdown' });
}

type InputResult = { comment: string; tag: AnnotationTag | undefined } | undefined;

async function withInputMock(result: InputResult, fn: () => Promise<void>): Promise<void> {
  const original = annotationInputModule.showAnnotationInput;
  (annotationInputModule as any).showAnnotationInput = () => Promise.resolve(result);
  try {
    await fn();
  } finally {
    (annotationInputModule as any).showAnnotationInput = original;
  }
}

// ---------------------------------------------------------------------------
// parseMarkdownSections
// ---------------------------------------------------------------------------

suite('parseMarkdownSections', () => {
  test('returns entire-document section when no headings', async () => {
    const doc = await openMdDocument('just some text\nwith no headings\n');
    const sections = parseMarkdownSections(doc);
    assert.strictEqual(sections.length, 1);
    assert.strictEqual(sections[0].label, '(entire document)');
    assert.strictEqual(sections[0].startLine, 0);
    assert.strictEqual(sections[0].endLine, doc.lineCount - 1);
  });

  test('parses a single ATX heading, trimming trailing blank lines', async () => {
    const doc = await openMdDocument('# Title\n\nSome content\n');
    const sections = parseMarkdownSections(doc);
    assert.strictEqual(sections.length, 1);
    assert.strictEqual(sections[0].label, '# Title');
    assert.strictEqual(sections[0].startLine, 0);
    // Trailing blank line (from the final \n) is trimmed; last content is on line 2.
    assert.strictEqual(sections[0].endLine, 2);
  });

  test('each section ends one line before the next heading', async () => {
    const content = '# Intro\nLine A\nLine B\n## Sub\nLine C\n';
    const doc = await openMdDocument(content);
    const sections = parseMarkdownSections(doc);
    assert.strictEqual(sections.length, 2);
    // # Intro: lines 0–2 (Line B at index 2, ## Sub starts at 3)
    assert.strictEqual(sections[0].label, '# Intro');
    assert.strictEqual(sections[0].startLine, 0);
    assert.strictEqual(sections[0].endLine, 2);
    // ## Sub: lines 3–4
    assert.strictEqual(sections[1].label, '## Sub');
    assert.strictEqual(sections[1].startLine, 3);
    assert.strictEqual(sections[1].endLine, 4);
  });

  test('handles adjacent headings with no content between them', async () => {
    const doc = await openMdDocument('# A\n# B\n# C\n');
    const sections = parseMarkdownSections(doc);
    assert.strictEqual(sections.length, 3);
    // Each section spans only its own line when headings are adjacent
    assert.strictEqual(sections[0].startLine, 0);
    assert.strictEqual(sections[0].endLine, 0);
    assert.strictEqual(sections[1].startLine, 1);
    assert.strictEqual(sections[1].endLine, 1);
    assert.strictEqual(sections[2].startLine, 2);
    assert.strictEqual(sections[2].endLine, 2);
  });

  test('handles all six heading levels', async () => {
    const doc = await openMdDocument('# H1\n## H2\n### H3\n#### H4\n##### H5\n###### H6\n');
    const sections = parseMarkdownSections(doc);
    assert.strictEqual(sections.length, 6);
    assert.strictEqual(sections[0].label, '# H1');
    assert.strictEqual(sections[5].label, '###### H6');
  });

  test('skips headings inside a backtick fenced code block', async () => {
    const content = [
      '# Real Heading',
      '```',
      '# This is a comment in code',
      '## also not a heading',
      '```',
      '## Another Real Heading',
      '',
    ].join('\n');
    const doc = await openMdDocument(content);
    const sections = parseMarkdownSections(doc);
    assert.strictEqual(sections.length, 2);
    assert.strictEqual(sections[0].label, '# Real Heading');
    assert.strictEqual(sections[1].label, '## Another Real Heading');
  });

  test('skips headings inside a tilde fenced code block', async () => {
    const content = [
      '# Outside',
      '~~~',
      '# Inside fence',
      '~~~',
      '## Also Outside',
    ].join('\n');
    const doc = await openMdDocument(content);
    const sections = parseMarkdownSections(doc);
    assert.strictEqual(sections.length, 2);
    assert.strictEqual(sections[0].label, '# Outside');
    assert.strictEqual(sections[1].label, '## Also Outside');
  });

  test('allows up to 3 spaces of indentation on heading line', async () => {
    const doc = await openMdDocument('   ## Indented Heading\ncontent\n');
    const sections = parseMarkdownSections(doc);
    assert.strictEqual(sections.length, 1);
    assert.strictEqual(sections[0].label, '## Indented Heading');
  });

  test('does not treat 4+ spaces as a heading (code block indent)', async () => {
    const doc = await openMdDocument('    # Not a heading (4-space indent)\nreal content\n');
    const sections = parseMarkdownSections(doc);
    // No headings found → returns entire-document section
    assert.strictEqual(sections.length, 1);
    assert.strictEqual(sections[0].label, '(entire document)');
  });

  test('detail string uses 1-based line numbers', async () => {
    const doc = await openMdDocument('# Section One\ncontent\n');
    const sections = parseMarkdownSections(doc);
    // Heading on line 0 → "Lines 1–N"
    assert.ok(sections[0].detail.startsWith('Lines 1–'));
  });
});

// ---------------------------------------------------------------------------
// annotateFromMarkdownPreview — integration
// ---------------------------------------------------------------------------

suite('annotateFromMarkdownPreview command', () => {
  let store: AnnotationStore;
  let decorations: DecorationsManager;

  setup(async () => {
    store = new AnnotationStore();
    decorations = new DecorationsManager(store);
    await store.clear();
  });

  teardown(async () => {
    await store.clear();
    decorations.dispose();
    await vscode.commands.executeCommand('workbench.action.closeAllEditors');
  });

  test('saves annotation with correct fileUri and range for picked section', async () => {
    // Open a .md file as a visible text editor so resolveMarkdownSourceUri finds it.
    const content = '# Intro\nsome text\n## Details\nmore text\n';
    const doc = await vscode.workspace.openTextDocument({ content, language: 'markdown' });
    await vscode.window.showTextDocument(doc);

    // Mock showQuickPick to select the second section (## Details, line 2–3)
    const origQP = vscode.window.showQuickPick;
    (vscode.window as any).showQuickPick = async (items: any[]) => {
      // Return the item whose label contains "Details"
      return items.find((i: any) => i.label.includes('Details'));
    };

    await withInputMock({ comment: 'check this section', tag: 'context' }, async () => {
      await annotateFromMarkdownPreview(store, decorations);
    });

    (vscode.window as any).showQuickPick = origQP;

    const data = await store.load();
    assert.strictEqual(data.annotations.length, 1);
    const ann = data.annotations[0];
    assert.strictEqual(ann.comment, 'check this section');
    assert.strictEqual(ann.tag, 'context');
    // ## Details is on line index 2; content ends at line 3
    assert.strictEqual(ann.range.start, 2);
    assert.strictEqual(ann.range.end, 3);
    assert.ok(ann.contentSnapshot !== undefined);
    assert.ok(ann.id.length > 0);
  });

  test('does nothing when user cancels section QuickPick', async () => {
    const doc = await vscode.workspace.openTextDocument({ content: '# Heading\ncontent\n', language: 'markdown' });
    await vscode.window.showTextDocument(doc);

    const origQP = vscode.window.showQuickPick;
    (vscode.window as any).showQuickPick = async () => undefined; // cancelled

    await withInputMock(undefined, async () => {
      await annotateFromMarkdownPreview(store, decorations);
    });

    (vscode.window as any).showQuickPick = origQP;

    const data = await store.load();
    assert.strictEqual(data.annotations.length, 0);
  });

  test('does nothing when user cancels annotation input', async () => {
    const doc = await vscode.workspace.openTextDocument({ content: '# Title\ntext\n', language: 'markdown' });
    await vscode.window.showTextDocument(doc);

    const origQP = vscode.window.showQuickPick;
    (vscode.window as any).showQuickPick = async (items: any[]) => items[0];

    await withInputMock(undefined, async () => {
      await annotateFromMarkdownPreview(store, decorations);
    });

    (vscode.window as any).showQuickPick = origQP;

    const data = await store.load();
    assert.strictEqual(data.annotations.length, 0);
  });
});
