# Bug Log

> **Open bugs are tracked on [GitHub Issues](https://github.com/shivanibaskar/vscode-annotate/issues).**
> This file is a historical archive of fixed bugs.

## Fixed (0.1.4 — Compatibility & correctness, 2026-06-09)

### UX-001 — Keybindings shadowed core VS Code shortcuts

**Status:** Fixed
**Reported:** 2026-06-09
**Fixed:** 2026-06-09

**Description:**
Eight default keybindings (`Cmd/Ctrl+Shift+E/D/X/M/F/T/C/Backspace`, all `when: editorTextFocus`) shadowed built-in VS Code shortcuts — search across files, Explorer, Run & Debug, Extensions, Problems panel, replace in files — whenever the editor had focus.

**Fix:** All bindings except the headline `Cmd/Ctrl+Shift+H` (Annotate Selection) moved to two-stroke chords under the `Cmd/Ctrl+Shift+A` leader (e.g. `⌘⇧A E` edit, `⌘⇧A X` export). Welcome toast and README updated.

**Affected files:** `package.json`, `src/extension.ts`, `README.md`

---

### BUG-011 — Markdown preview overlay ignored named annotation sets

**Status:** Fixed
**Reported:** 2026-06-09 (known limitation since P4)
**Fixed:** 2026-06-09

**Description:**
`media/annotationPreview.js` hardcoded `.vscode/annotations.json`, so with a named/branch set active the preview rendered the wrong (default) set's annotations.

**Fix:** The store now writes a pointer file `.vscode/annotate-active-set.json` on every set switch (enqueued on the flush queue so it can't race the preview refresh; the extension awaits `store.flush()` before `markdown.preview.refresh`). The preview script reads the pointer, validates the set name, fetches `annotations-<set>.json`, and falls back to the default set if the pointer or set file is missing. At activation a stale pointer from a previous session is corrected without creating the file for users who never switch sets.

**Affected files:** `media/annotationPreview.js`, `src/annotationStore.ts`, `src/extension.ts`

---

### BUG-012 — Set-name validation inconsistent with sanitized branch names

**Status:** Fixed
**Reported:** 2026-06-09
**Fixed:** 2026-06-09

**Description:**
`syncWithBranch` sanitized only `[/\\:*?"<>|]`, so branches like `release/1.2.0` produced set names with dots (`release-1.2.0`) that the `[a-zA-Z0-9-]+` allowlists in `listSets` and the new-set input validator rejected — the set file was written but invisible in the picker (and would have broken the preview pointer).

**Fix:** Single shared `SET_NAME_PATTERN = /^[a-zA-Z0-9._-]+$/` exported from `annotationStore.ts`, used by `listSets`, the new-set validator, and (duplicated, with a sync comment) the preview script. `syncWithBranch` now sanitizes with the inverse class `[^a-zA-Z0-9._-]`.

**Affected files:** `src/annotationStore.ts`, `src/commands/switchAnnotationSet.ts`, `src/commands/syncWithBranch.ts`, `media/annotationPreview.js`

---

### BUG-013 — Multi-root workspaces resolved every annotation against the first folder

**Status:** Fixed
**Reported:** 2026-06-09
**Fixed:** 2026-06-09

**Description:**
Annotation `fileUri`s were stored relative to their own folder (`asRelativePath(uri, false)`) but resolved back via `joinPath(workspaceFolders[0].uri, fileUri)` in reveal, search, export, stale-diff, and snapshot code — files in any folder but the first opened/exported the wrong path. Same-named files in different folders also collided as annotation keys.

**Fix:** New `src/workspaceUtils.ts`: `toFileUri()` stores folder-name-prefixed paths in multi-root workspaces (single-root output unchanged, so existing data keeps working), and `resolveFileUri()` resolves the prefix back to the right folder (longest-name match) with a centralized path-traversal containment guard — which also extends the guard to reveal/search/snapshot paths that previously had none. All 13 matcher sites and 6 resolution sites migrated. Annotation files themselves remain under the first folder's `.vscode/` by convention.

**Known limitations:** renaming a workspace folder orphans its annotations; the markdown preview overlay reads annotation files only from the first folder.

**Affected files:** `src/workspaceUtils.ts` (new), `src/extension.ts`, `src/decorations.ts`, `src/hoverProvider.ts`, `src/annotationCodeLensProvider.ts`, `src/annotationSnapshotProvider.ts`, `src/commands/*` (11 files)

---

### SEC-007 — Terminal export injected untrusted annotation text into the shell

**Status:** Fixed
**Reported:** 2026-06-09
**Fixed:** 2026-06-09

**Description:**
With Workspace Trust in Restricted Mode, a committed malicious `annotations.json` could put multi-line comments into the export that `exportToTerminal` pipes into a live terminal via `sendText` — embedded newlines can execute commands (bracketed paste is not guaranteed).

**Fix:** `exportToTerminal` is gated on `vscode.workspace.isTrusted` with an explanatory warning. `package.json` now declares `capabilities.untrustedWorkspaces: "limited"` (everything else works in Restricted Mode) and `capabilities.virtualWorkspaces: false`.

**Affected files:** `src/commands/exportToTerminal.ts`, `package.json`

---

## Fixed (Char-precise attribution — 2026-06-09)

### BUG-002 — Partial-line annotation attributed to the whole line in hover, reveal, and search

**Status:** Fixed
**Reported:** 2026-06-09
**Fixed:** 2026-06-09

**Description:**
Annotating part of a sentence highlighted/attributed the annotation to the entire line in several surfaces, even though the stored range and the persistent decoration were already character-precise (BUG-001):

1. **Hover** matched annotations by line only and returned a whole-line hover range. VS Code paints `editor.hoverHighlightBackground` over the hover range while the popup is visible, so hovering anywhere on the line lit up the whole sentence.
2. **Reveal from sidebar/CodeLens** (`annotate.revealAnnotation`) and **Search Annotations** selected whole lines (`char 0 → MAX_SAFE_INTEGER`), ignoring `startChar`/`endChar`.
3. **Creation edge case:** a selection ending at column 0 of the following line decremented `endLine` but kept `endChar: 0`, persisting a reversed (single-line) or zero-coverage (multi-line) range — `vscode.Range` silently swapped the reversed form onto the *unannotated* prefix of the line.

**Root cause:** the char-precise `annotationToRange` conversion lived privately in `decorations.ts`; every other annotation→Range site built its own whole-line range.

**Fix:** Extracted `annotationToRange` into `src/rangeUtils.ts` and reused it in the hover provider (which now also *matches* by character containment, not just line), `revealAnnotation`, and `searchAnnotations`. The helper validates char offsets (hand-editable JSON may contain negative/fractional/NaN values — these fall back to the whole-line span instead of throwing) and repairs ranges persisted by the pre-fix column-0 bug by extending them to end-of-line. `annotateSelection` now stores `endChar` as the end of the last annotated line when the selection ends at column 0. `getAnnotationAtCursor` (edit/delete via keyboard) stays deliberately line-based for discoverability.

**Known limitations:** character offsets can drift on same-line edits (`shiftAnnotations` only handles line insertions/deletions) — pre-existing, applies equally to decorations. The rendered Markdown preview still highlights whole block elements; rendered HTML has no character-level source map.

**Affected files:** `src/rangeUtils.ts` (new), `src/decorations.ts`, `src/hoverProvider.ts`, `src/extension.ts`, `src/commands/searchAnnotations.ts`, `src/commands/annotateSelection.ts`, `src/commands/utils.ts`, `src/test/runTest.ts` (short `--user-data-dir` so the suite runs from deep checkouts)

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
