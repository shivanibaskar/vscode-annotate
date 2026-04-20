# Bug Log

> **Open bugs are tracked on [GitHub Issues](https://github.com/shivanibaskar/vscode-annotate/issues).**
> This file is a historical archive of fixed bugs.

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

### `_ensureLoaded` cold-start concurrency race — FIXED (2026-04-16)

**Root cause:** `_ensureLoaded()` used a plain `if (!_cache)` check before calling `_loadFromDisk()`. Two concurrent callers on a null cache each initiated independent disk reads; whichever resolved last silently overwrote any mutations the other caller had already applied to the cache.
**Affected files:** `src/annotationStore.ts`
**Fix:** Added `_loadPromise` gate — all concurrent callers on a null cache share the same in-flight `_loadFromDisk()` promise. Added set-name snapshot to discard stale load results if `switchSet()` fires mid-flight. Added `_loadPromise = null` to `clear()` to prevent stale load from repopulating a just-cleared cache.

---

### `_scheduleFlush` stale-cache race under `switchSet` — FIXED (2026-04-16)

**Root cause:** `_flush()` captured `this._cache` and `this.getStoreUri()` at execution time, not enqueue time. If `switchSet()` fired between `_scheduleFlush()` and flush execution, the queued flush would write the new set's data to the new set's URI — corrupting both files and losing the original set's pending changes.
**Affected files:** `src/annotationStore.ts`
**Fix:** Removed `_flush()`. `_scheduleFlush` now accepts URI and data as parameters captured synchronously before any `await` in each mutating method. Snapshot deep-copies each annotation and its `range` to prevent post-enqueue mutation corruption.

---

### Hover command URIs embedding full Annotation objects — FIXED (2026-04-16)

**Root cause:** `commandLink` in `hoverProvider.ts` serialised the entire `Annotation` object (including `contentSnapshot`, potentially kilobytes of source code) into the command URI query parameter on every hover render.
**Affected files:** `src/hoverProvider.ts`, `src/commands/editAnnotation.ts`, `src/commands/deleteAnnotation.ts`, `src/commands/showStaleDiff.ts`
**Fix:** `commandLink` now serialises only `[{ id }]`. Handlers detect the bare `{ id }` shape via `'comment' in nodeOrAnnotation` discriminator and look up the full annotation from the store. Added `HoverArg` type to `src/types.ts` and updated all three handler signatures.

---

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
