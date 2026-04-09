# Bug Log

## Open

### BUG-011 — Hover popup does not show the annotation tag

**Status:** Open
**Reported:** 2026-03-28

**Description:**
The hover tooltip renders the comment, timestamp, and action buttons but never outputs `ann.tag`. If a tag was set (e.g. `bug`, `context`, `question`) it is invisible in the hover — the user has to open the sidebar to see it.

**Suspected area:** `src/hoverProvider.ts` — tag needs to be rendered in the header line alongside the timestamp.

---

### BUG-012 — Hover timestamp is verbose text, wastes space

**Status:** Open
**Reported:** 2026-03-28

**Description:**
The timestamp renders as a full locale string (e.g. *"created Mar 28, 2026, 11:39 AM"*) which takes up significant horizontal space in the narrow hover popup. It should be a compact relative or short date (e.g. "Mar 28" or "2 hours ago") so the header line stays tight.

**Suspected area:** `src/hoverProvider.ts` — `formatTimestamp()` and the header line in `provideHover`.

---

## Fixed (Security Hardening — 2026-04-08)

### SEC-001 — Weak Content Security Policy in ExportPreviewPanel

**Status:** Fixed
**Reported:** 2026-04-08
**Fixed:** 2026-04-08

**Description:**
The webview CSP used `style-src 'unsafe-inline'`, which defeated CSP's injection protections for styles. Combined with dynamic annotation content in the same panel, this opened a UI-redressing vector.

**Fix:** Moved the `<style>` block to a nonce-protected tag; CSP updated to `style-src 'nonce-*'`.

**Affected files:** `src/panels/exportPreviewPanel.ts`

---

### SEC-002 — Unvalidated annotation data on load (memory/crash risk)

**Status:** Fixed
**Reported:** 2026-04-08
**Fixed:** 2026-04-08

**Description:**
`_loadFromDisk()` only checked top-level structure. Individual annotation fields (range values, comment length, tag enum) were not validated, allowing a crafted `annotations.json` to crash decorations or exhaust memory.

**Fix:** Added per-annotation field validation (`_isValidAnnotation`). Corrupt entries are silently filtered out so partial corruption is recoverable without discarding the whole file. Introduced a shared `MAX_COMMENT_LENGTH = 5000` constant (exported for UI reuse).

**Affected files:** `src/annotationStore.ts`

---

### SEC-003 — Set names from disk not re-validated against allowlist

**Status:** Fixed
**Reported:** 2026-04-08
**Fixed:** 2026-04-08

**Description:**
Set names extracted from filenames via regex were not re-checked against the `[a-zA-Z0-9-]+` allowlist used at creation time. A file created directly in `.vscode/` with a crafted name (e.g. `annotations-../evil.json`) could be loaded as a valid set name.

**Fix:** Added `if (m && /^[a-zA-Z0-9-]+$/.test(m[1]))` guard in `listSets()`.

**Affected files:** `src/annotationStore.ts`

---

### SEC-004 — Comment length not capped in input UI

**Status:** Fixed
**Reported:** 2026-04-08
**Fixed:** 2026-04-08

**Description:**
No maximum length enforced on annotation input. A multi-MB paste could cause performance/memory issues during storage and rendering.

**Fix:** Input box validator now rejects comments exceeding `MAX_COMMENT_LENGTH` (5000 chars), imported from `annotationStore.ts` to stay in sync with storage validation.

**Affected files:** `src/ui/annotationInput.ts`

---

### SEC-005 — postMessage handler in ExportPreviewPanel not type-guarded

**Status:** Fixed
**Reported:** 2026-04-08
**Fixed:** 2026-04-08

**Description:**
`onDidReceiveMessage` checked `msg.command === 'copy'` without first verifying that `msg` is a non-null object. A non-object message (e.g. `null`, a string) would throw at the property access, and future handler extensions could act on unexpected message shapes.

**Fix:** Added `typeof msg === 'object' && msg !== null` guard before checking the command field.

**Affected files:** `src/panels/exportPreviewPanel.ts`

---

### SEC-006 — onDidChange subscription not tracked for disposal

**Status:** Fixed
**Reported:** 2026-04-08
**Fixed:** 2026-04-08

**Description:**
The return value of `store.onDidChange(...)` in `extension.ts` was discarded, so the listener was never explicitly disposed on extension deactivation.

**Fix:** Wrapped the call in `context.subscriptions.push(...)`.

**Affected files:** `src/extension.ts`

---

## Fixed (Production Hardening — 2026-03-28)

### BUG-010 — `exportFiltered.ts` broken store proxy pattern

**Status:** Fixed
**Reported:** 2026-03-28
**Fixed:** 2026-03-28

**Description:**
`Object.create(store)` created a prototype-chain proxy that deceived TypeScript's type system and made private members (`_flushQueue`, etc.) inaccessible if any downstream method reached them. Correctness risk for any future refactor.

**Fix:** Replaced with a plain `{ load }` wrapper cast via `as unknown as AnnotationStore`.

**Affected files:** `src/commands/exportFiltered.ts`

---

### BUG-009 — `shiftAnnotations` drops `startChar`/`endChar` on line shift

**Status:** Fixed
**Reported:** 2026-03-28
**Fixed:** 2026-03-28

**Description:**
Shallow spread `{ start: start + lineDelta, end: end + lineDelta }` silently dropped character-level precision fields. After one edit cycle, character-ranged annotations became full-line permanently.

**Fix:** Spread `ann.range` before overriding `start`/`end`: `{ ...ann.range, start: ..., end: ... }`.

**Affected files:** `src/annotationStore.ts`

---

### BUG-008 — `exportToTerminal.ts` uses non-public `processId` for terminal identity

**Status:** Fixed
**Reported:** 2026-03-28
**Fixed:** 2026-03-28

**Description:**
`(t as any).processId` is not part of the VS Code public API. On remote SSH/WSL targets it is `undefined`, causing `undefined === undefined` to silently match the wrong terminal. No cleanup when the remembered terminal closed.

**Fix:** Switched to `terminal.name` as identity key. Added `onDidCloseTerminal` listener (registered in `extension.ts` via `registerTerminalCloseListener`) to clear the reference when the tracked terminal closes.

**Affected files:** `src/commands/exportToTerminal.ts`, `src/extension.ts`

---

### BUG-007 — Path traversal via crafted `fileUri` in annotation data

**Status:** Fixed
**Reported:** 2026-03-28
**Fixed:** 2026-03-28

**Description:**
`readLines()` in `buildExportText.ts` and `exportMarkdown.ts` passed `annotation.fileUri` directly to `vscode.Uri.joinPath` without validating the resolved path stays within the workspace. A crafted annotation (`"../../.ssh/id_rsa"`) could escape.

**Fix:** Added `path.resolve` validation; returns `null` (skips file content) if the path escapes the workspace root.

**Affected files:** `src/commands/buildExportText.ts`, `src/commands/exportMarkdown.ts`

---

## Fixed

### BUG-003 — No user-facing prompt when annotations are sent/copied for context

**Status:** Fixed
**Reported:** 2026-03-28
**Fixed:** 2026-03-28

**Description:**
Clipboard copy notification gave no guidance on what to do with the copied text.

**Fix:**
Updated notification to: *"Annotations copied to clipboard — paste into your LLM prompt as context, then add your question."*

**Affected files:**
- `src/panels/exportPreviewPanel.ts`

---

### BUG-002 — Copy to clipboard not awaited and untested

**Status:** Fixed
**Reported:** 2026-03-28
**Fixed:** 2026-03-28

**Description:**
`vscode.env.clipboard.writeText` was not `await`ed in the webview message handler, and there was no test coverage for the clipboard path because `ExportPreviewPanel.show` was always mocked in tests.

**Fix:**
- Extracted clipboard logic into a public static `ExportPreviewPanel.copyToClipboard(content)` method that `await`s `writeText`
- `onDidReceiveMessage` now delegates to this method via `void ExportPreviewPanel.copyToClipboard(...)`
- Added `src/test/suite/exportPreviewPanel.test.ts` with 5 tests covering write content, info message, and edge cases

**Affected files:**
- `src/panels/exportPreviewPanel.ts`
- `src/test/suite/exportPreviewPanel.test.ts` (new)

---

### BUG-001 — Whole-line highlight even for single-word selections

**Status:** Fixed (see commit below)
**Reported:** 2026-03-27
**Fixed:** 2026-03-27

**Description:**
Selecting a single word (or any partial-line text) and annotating it highlighted the entire line in the editor. The highlight should match the actual selected character range.

**Root cause:**
`LineRange` only stored line numbers (`start`, `end`). `DecorationsManager` used `isWholeLine: true`, ignoring any character position. Even for a one-word selection, the full line was painted.

**Fix:**
- Added optional `startChar` / `endChar` to `LineRange` in `types.ts`
- `annotateSelection.ts` now stores `selection.start.character` / `selection.end.character`
- `decorations.ts` removed `isWholeLine: true`; when `startChar`/`endChar` are present the decoration range uses those exact characters; otherwise falls back to whole-line (`char 0 → MAX_SAFE_INTEGER`)
- Backward-compatible: existing annotations without char fields degrade gracefully to whole-line

**Affected files:**
- `src/types.ts`
- `src/commands/annotateSelection.ts`
- `src/decorations.ts`
- `src/test/suite/annotationStore.test.ts` (updated helper)
