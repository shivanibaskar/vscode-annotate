import * as vscode from 'vscode';
import { AnnotationTag } from '../types';

interface TagQuickPickItem extends vscode.QuickPickItem {
  tag: AnnotationTag | undefined;
}

const TAG_ITEMS: TagQuickPickItem[] = [
  { label: '$(circle-slash) No tag',  description: 'Save without a tag', tag: undefined },
  { label: '$(bug) Bug',              description: 'Mark as a bug',       tag: 'bug' },
  { label: '$(info) Context',         description: 'Provide context',     tag: 'context' },
  { label: '$(question) Question',    description: 'Flag a question',     tag: 'question' },
  { label: '$(check) Todo',           description: 'Action needed',       tag: 'todo' },
  { label: '$(star) Important',       description: 'High importance',     tag: 'important' },
];

export interface AnnotationInputResult {
  comment: string;
  tag: AnnotationTag | undefined;
}

/**
 * Two-step input flow:
 *   1. InputBox  — type the annotation comment (validated non-empty)
 *   2. QuickPick — pick a tag from the list (Escape = save with no tag)
 *
 * Escape on step 1 cancels the whole operation.
 * Escape on step 2 saves without a tag rather than losing the comment.
 *
 * @param opts.title          Title shown at the top of both pickers.
 * @param opts.initialComment Pre-filled comment text (for edits).
 * @param opts.initialTag     Pre-selected tag (for edits).
 * @returns The comment and tag, or `undefined` if the user cancelled.
 */
export async function showAnnotationInput(opts: {
  title: string;
  initialComment?: string;
  initialTag?: AnnotationTag;
}): Promise<AnnotationInputResult | undefined> {
  // ── Step 1: comment ──────────────────────────────────────────────────────
  const comment = await vscode.window.showInputBox({
    title: opts.title,
    prompt: 'Enter your annotation comment',
    value: opts.initialComment ?? '',
    ignoreFocusOut: true,
    validateInput: value =>
      value.trim() ? undefined : 'Comment cannot be empty',
  });

  if (comment === undefined) {
    return undefined; // user pressed Escape → cancel entirely
  }

  // ── Step 2: tag ──────────────────────────────────────────────────────────
  const tag = await pickTag(opts.title, opts.initialTag);

  return { comment: comment.trim(), tag };
}

/**
 * Shows a QuickPick for selecting a tag.
 * Pressing Escape resolves with `undefined` (no tag) rather than cancelling,
 * so the caller doesn't lose the comment the user already entered.
 *
 * @param title      Title shown at the top of the picker.
 * @param initialTag Tag to pre-highlight (for edits).
 */
function pickTag(
  title: string,
  initialTag?: AnnotationTag
): Promise<AnnotationTag | undefined> {
  return new Promise(resolve => {
    const qp = vscode.window.createQuickPick<TagQuickPickItem>();
    qp.title = title;
    qp.placeholder = 'Select a tag — Escape saves without a tag';
    qp.items = TAG_ITEMS;
    qp.ignoreFocusOut = true;

    // Pre-highlight the current tag so edits don't reset it.
    const initial = TAG_ITEMS.find(i => i.tag === initialTag) ?? TAG_ITEMS[0];
    qp.activeItems = [initial];

    let accepted = false;

    qp.onDidAccept(() => {
      accepted = true;
      const tag = qp.activeItems[0]?.tag;
      qp.hide();
      resolve(tag);
    });

    qp.onDidHide(() => {
      qp.dispose();
      if (!accepted) {
        resolve(undefined); // Escape on tag step = save with no tag
      }
    });

    qp.show();
  });
}
