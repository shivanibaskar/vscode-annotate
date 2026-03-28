import * as vscode from 'vscode';
import { Annotation, AnnotationsFile } from './types';

const ANNOTATIONS_PATH = '.vscode/annotations.json';

export class AnnotationStore {
  private _cache: AnnotationsFile | null = null;
  // All disk writes are chained onto this promise, eliminating concurrent write races.
  private _flushQueue: Promise<void> = Promise.resolve();

  private readonly _onDidChange = new vscode.EventEmitter<void>();
  /** Fires whenever annotations are added, removed, cleared, or shifted. */
  readonly onDidChange: vscode.Event<void> = this._onDidChange.event;

  private getStoreUri(): vscode.Uri | undefined {
    const folders = vscode.workspace.workspaceFolders;
    if (!folders || folders.length === 0) {
      return undefined;
    }
    return vscode.Uri.joinPath(folders[0].uri, ANNOTATIONS_PATH);
  }

  private async _loadFromDisk(): Promise<AnnotationsFile> {
    const uri = this.getStoreUri();
    if (!uri) {
      return { version: 1, annotations: [] };
    }
    try {
      const raw = await vscode.workspace.fs.readFile(uri);
      const parsed = JSON.parse(Buffer.from(raw).toString('utf8')) as AnnotationsFile;
      if (parsed.version !== 1 || !Array.isArray(parsed.annotations)) {
        return { version: 1, annotations: [] };
      }
      return parsed;
    } catch {
      return { version: 1, annotations: [] };
    }
  }

  private async _ensureLoaded(): Promise<AnnotationsFile> {
    if (!this._cache) {
      this._cache = await this._loadFromDisk();
    }
    return this._cache;
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
          if (start > changeEnd) {
            return { ...ann, range: { start: start + lineDelta, end: end + lineDelta } };
          }

          // Annotation overlaps the changed region: keep start, adjust end.
          return {
            ...ann,
            range: { start, end: end + lineDelta },
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
