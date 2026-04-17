import * as vscode from 'vscode';
import { Annotation, AnnotationTag, AnnotationsFile } from './types';

const DEFAULT_SET = 'default';

/** Maximum allowed comment length — enforced both here and in the input UI. */
export const MAX_COMMENT_LENGTH = 5000;

const VALID_TAGS = new Set<AnnotationTag>(['bug', 'context', 'question', 'todo', 'important']);

function annotationsPath(setName: string): string {
  return setName === DEFAULT_SET
    ? '.vscode/annotations.json'
    : `.vscode/annotations-${setName}.json`;
}

export class AnnotationStore {
  private _setName: string = DEFAULT_SET;
  private _cache: AnnotationsFile | null = null;
  /** Shared in-flight load promise — prevents concurrent callers from each calling _loadFromDisk. */
  private _loadPromise: Promise<AnnotationsFile> | null = null;
  // All disk writes are chained onto this promise, eliminating concurrent write races.
  private _flushQueue: Promise<void> = Promise.resolve();

  private readonly _onDidChange = new vscode.EventEmitter<void>();
  /** Fires whenever annotations are added, removed, cleared, or shifted. */
  readonly onDidChange: vscode.Event<void> = this._onDidChange.event;

  get setName(): string { return this._setName; }

  /**
   * Switch to a different annotation set. Resets the in-memory cache so the
   * next read loads from the new file on disk.
   */
  switchSet(name: string): void {
    if (name === this._setName) { return; }
    this._setName = name;
    this._cache = null;
    this._loadPromise = null;
    this._onDidChange.fire();
  }

  /** Returns the names of all annotation sets that exist on disk. */
  static async listSets(): Promise<string[]> {
    const folders = vscode.workspace.workspaceFolders;
    if (!folders || folders.length === 0) { return [DEFAULT_SET]; }
    const vscodeDirUri = vscode.Uri.joinPath(folders[0].uri, '.vscode');
    try {
      const entries = await vscode.workspace.fs.readDirectory(vscodeDirUri);
      const sets = new Set<string>([DEFAULT_SET]);
      for (const [name] of entries) {
        if (name === 'annotations.json') {
          sets.add(DEFAULT_SET);
        } else {
          const m = name.match(/^annotations-(.+)\.json$/);
          // Re-validate captured name against the same allowlist used at creation time.
          if (m && /^[a-zA-Z0-9-]+$/.test(m[1])) { sets.add(m[1]); }
        }
      }
      return [...sets].sort();
    } catch {
      return [DEFAULT_SET];
    }
  }

  private getStoreUri(): vscode.Uri | undefined {
    const folders = vscode.workspace.workspaceFolders;
    if (!folders || folders.length === 0) {
      return undefined;
    }
    return vscode.Uri.joinPath(folders[0].uri, annotationsPath(this._setName));
  }

  private async _loadFromDisk(): Promise<AnnotationsFile> {
    const uri = this.getStoreUri();
    if (!uri) {
      return { version: 1, annotations: [] };
    }
    try {
      const raw = await vscode.workspace.fs.readFile(uri);
      const parsed = JSON.parse(Buffer.from(raw).toString('utf8')) as unknown;
      if (
        typeof parsed !== 'object' || parsed === null ||
        (parsed as Record<string, unknown>)['version'] !== 1 ||
        !Array.isArray((parsed as Record<string, unknown>)['annotations'])
      ) {
        return { version: 1, annotations: [] };
      }
      // Filter out any individual annotations that fail field-level validation
      // rather than discarding the entire file, so partial corruption is recoverable.
      const all = (parsed as Record<string, unknown>)['annotations'] as unknown[];
      const valid = all.filter(a => this._isValidAnnotation(a)) as Annotation[];
      return { version: 1, annotations: valid };
    } catch {
      return { version: 1, annotations: [] };
    }
  }

  /**
   * Validates a single annotation object loaded from disk.
   * Rejects entries with out-of-bounds ranges, overlong comments, unknown tags,
   * or missing required fields so malformed data cannot crash decorations or the UI.
   *
   * @param ann The unknown value read from JSON.
   * @returns `true` if the value satisfies the `Annotation` contract.
   */
  private _isValidAnnotation(ann: unknown): ann is Annotation {
    if (typeof ann !== 'object' || ann === null) { return false; }
    const a = ann as Record<string, unknown>;

    if (typeof a['id'] !== 'string' || !a['id']) { return false; }
    if (typeof a['fileUri'] !== 'string' || !a['fileUri']) { return false; }
    if (typeof a['comment'] !== 'string') { return false; }
    if (a['comment'].length === 0 || a['comment'].length > MAX_COMMENT_LENGTH) { return false; }
    if (typeof a['createdAt'] !== 'string' || typeof a['updatedAt'] !== 'string') { return false; }

    const r = a['range'];
    if (typeof r !== 'object' || r === null) { return false; }
    const range = r as Record<string, unknown>;
    if (typeof range['start'] !== 'number' || typeof range['end'] !== 'number') { return false; }
    if (!Number.isFinite(range['start']) || !Number.isFinite(range['end'])) { return false; }
    if ((range['start'] as number) < 0 || (range['end'] as number) < (range['start'] as number)) { return false; }

    if (a['tag'] !== undefined && !VALID_TAGS.has(a['tag'] as AnnotationTag)) { return false; }

    return true;
  }

  private _ensureLoaded(): Promise<AnnotationsFile> {
    if (this._cache) { return Promise.resolve(this._cache); }
    if (!this._loadPromise) {
      this._loadPromise = this._loadFromDisk().then(data => {
        this._cache = data;
        this._loadPromise = null;
        return data;
      });
    }
    return this._loadPromise;
  }

  private _scheduleFlush(): void {
    this._flushQueue = this._flushQueue.then(() => this._flush());
  }

  private async _flush(): Promise<void> {
    if (!this._cache) {
      return;
    }
    const uri = this.getStoreUri();
    if (!uri) {
      vscode.window.showErrorMessage('Annotate: No workspace folder is open.');
      return;
    }
    const encoded = Buffer.from(JSON.stringify(this._cache, null, 2), 'utf8');
    await vscode.workspace.fs.writeFile(uri, encoded);
  }

  /** Wait for all pending disk writes to complete. Useful in tests. */
  async flush(): Promise<void> {
    await this._flushQueue;
  }

  async load(): Promise<AnnotationsFile> {
    const data = await this._ensureLoaded();
    return { version: data.version, annotations: [...data.annotations] };
  }

  async save(data: AnnotationsFile): Promise<void> {
    this._cache = data;
    this._scheduleFlush();
    this._onDidChange.fire();
  }

  async add(annotation: Annotation): Promise<void> {
    const data = await this._ensureLoaded();
    data.annotations.push(annotation);
    this._scheduleFlush();
    this._onDidChange.fire();
  }

  async remove(id: string): Promise<void> {
    const data = await this._ensureLoaded();
    data.annotations = data.annotations.filter(a => a.id !== id);
    this._scheduleFlush();
    this._onDidChange.fire();
  }

  async update(annotation: Annotation): Promise<void> {
    const data = await this._ensureLoaded();
    const idx = data.annotations.findIndex(a => a.id === annotation.id);
    if (idx === -1) { return; }
    data.annotations[idx] = { ...annotation, updatedAt: new Date().toISOString() };
    this._scheduleFlush();
    this._onDidChange.fire();
  }

  async clear(): Promise<void> {
    this._cache = { version: 1, annotations: [] };
    this._scheduleFlush();
    this._onDidChange.fire();
    await this._flushQueue;
  }

  async getForFile(relPath: string): Promise<Annotation[]> {
    const data = await this._ensureLoaded();
    return data.annotations.filter(a => a.fileUri === relPath);
  }

  /**
   * Shifts annotation ranges in response to document edits.
   * Called from the onDidChangeTextDocument listener so decorations stay in sync.
   * Changes are processed bottom-to-top to prevent cascading offset errors.
   */
  async shiftAnnotations(
    fileUri: string,
    changes: readonly vscode.TextDocumentContentChangeEvent[]
  ): Promise<void> {
    const data = await this._ensureLoaded();
    if (!data.annotations.some(a => a.fileUri === fileUri)) {
      return;
    }

    const sorted = [...changes].sort((a, b) => b.range.start.line - a.range.start.line);
    let modified = false;

    for (const change of sorted) {
      const newlineCount = (change.text.match(/\n/g) ?? []).length;
      const removedLines = change.range.end.line - change.range.start.line;
      const lineDelta = newlineCount - removedLines;
      if (lineDelta === 0) {
        continue;
      }

      const changeStart = change.range.start.line;
      const changeEnd = change.range.end.line;

      data.annotations = data.annotations
        .map(ann => {
          if (ann.fileUri !== fileUri) {
            return ann;
          }

          const { start, end } = ann.range;

          // Annotation is entirely before the change: untouched.
          if (end < changeStart) {
            return ann;
          }

          // Annotation is entirely after the change: shift both bounds.
          // Spread ann.range first to preserve startChar/endChar if present.
          if (start > changeEnd) {
            return { ...ann, range: { ...ann.range, start: start + lineDelta, end: end + lineDelta } };
          }

          // Annotation overlaps the changed region.
          // For insertions (lineDelta > 0) at or before the annotation start,
          // the annotated content has moved down — shift both bounds.
          // For deletions, or changes strictly inside the span, only end shifts
          // (the filter below removes annotations whose end falls below start).
          if (lineDelta > 0 && changeStart <= start) {
            return {
              ...ann,
              range: { ...ann.range, start: start + lineDelta, end: end + lineDelta },
              updatedAt: new Date().toISOString(),
            };
          }
          return {
            ...ann,
            range: { ...ann.range, start, end: end + lineDelta },
            updatedAt: new Date().toISOString(),
          };
        })
        .filter(ann => ann.range.start >= 0 && ann.range.end >= ann.range.start);

      modified = true;
    }

    if (modified) {
      this._scheduleFlush();
      this._onDidChange.fire();
    }
  }

  dispose(): void {
    this._onDidChange.dispose();
  }
}
