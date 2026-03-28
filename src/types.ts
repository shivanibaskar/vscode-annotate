export interface LineRange {
  /** 0-based, inclusive start line (matches VS Code API) */
  start: number;
  /** 0-based, inclusive end line */
  end: number;
  /** 0-based start character within the start line. When present, the
   *  decoration is character-precise rather than whole-line. */
  startChar?: number;
  /** 0-based end character within the end line. */
  endChar?: number;
}

export type AnnotationTag = 'bug' | 'context' | 'question' | 'todo' | 'important';

export interface Annotation {
  /** UUID v4 — stable identity across edits */
  id: string;
  /** Workspace-relative POSIX path, e.g. "src/foo.ts" */
  fileUri: string;
  range: LineRange;
  comment: string;
  /** Optional tag for categorising annotations. */
  tag?: AnnotationTag;
  createdAt: string; // ISO 8601
  updatedAt: string; // ISO 8601
}

export interface AnnotationsFile {
  version: 1;
  annotations: Annotation[];
}
