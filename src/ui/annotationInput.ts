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
 * Shows a single combined QuickPick where the user types their comment in the
 * input field and selects a tag from the list below — replacing the previous
 * two-step InputBox → QuickPick flow.
 *
 * @param opts.title       Title shown at the top of the picker.
 * @param opts.initialComment  Pre-filled comment text (for edits).
 * @param opts.initialTag  Pre-selected tag (for edits).
 * @returns The comment and tag, or `undefined` if the user cancelled.
 */
export function showAnnotationInput(opts: {
  title: string;
  initialComment?: string;
  initialTag?: AnnotationTag;
}): Promise<AnnotationInputResult | undefined> {
  return new Promise(resolve => {
    const qp = vscode.window.createQuickPick<TagQuickPickItem>();
    qp.title = opts.title;
    qp.placeholder = 'Type your annotation comment…';
    qp.value = opts.initialComment ?? '';
    qp.items = TAG_ITEMS;
    qp.ignoreFocusOut = true;

    // Pre-select the current tag (default to "No tag").
    const initial = TAG_ITEMS.find(i => i.tag === opts.initialTag) ?? TAG_ITEMS[0];
    qp.activeItems = [initial];

    // Prevent the input text from filtering the tag list — always show all options.
    const sub = qp.onDidChangeValue(() => {
      qp.items = TAG_ITEMS;
    });

    qp.onDidAccept(() => {
      const comment = qp.value.trim();
      const tag = qp.activeItems[0]?.tag;
      qp.hide();
      if (!comment) {
        // Empty comment — treated as cancel; caller can warn.
        resolve({ comment: '', tag: undefined });
      } else {
        resolve({ comment, tag });
      }
    });

    qp.onDidHide(() => {
      sub.dispose();
      qp.dispose();
      resolve(undefined);
    });

    qp.show();
  });
}
