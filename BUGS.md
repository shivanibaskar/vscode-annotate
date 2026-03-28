# Bug Log

## Open

_(none)_

---

## Fixed

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
