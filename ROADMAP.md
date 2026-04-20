# vscode-annotate — Feature Roadmap

## Personas

### Alex — Senior Backend Engineer (Developer)
Writes complex systems code daily. Uses LLMs constantly for code review, debugging, and onboarding teammates into unfamiliar areas. Works across large repos with many files open at once.

**Pain points:**
- Decorations have no hover tooltip — can't see the comment without exporting
- Can't edit or delete a single annotation (only "clear all")
- Annotations break silently when lines shift after edits
- No tagging — can't distinguish "this is a bug" from "explain this to LLM"

---

### Priya — Product Manager
Manages a dev team, writes specs, does light code reading for context. Uses LLMs to summarize and explain code before writing tickets. Wants structured output she can paste into Notion or share with stakeholders.

**Pain points:**
- Export format is developer-centric (raw code blocks) — hard to share with non-devs
- No way to organize annotations by topic or sprint
- Can't tell which annotations are "done" vs "still needs attention"
- No Markdown export — only clipboard

---

### Jordan — Junior/Mid Dev (User)
Newer to the codebase. Uses the extension to build understanding while reading unfamiliar code, and to prep questions for senior devs or LLMs. Learns by annotating as they go.

**Pain points:**
- No Annotations Panel / sidebar — can't browse all annotations at a glance
- No way to jump from an annotation to its code location
- Deleting one annotation requires knowing its ID — no UI for it
- Export goes straight to clipboard with no preview

---

## Feature Backlog

### P0 — Core UX gaps ✅
> All three personas are blocked without these.

- [x] **Hover tooltip on decorated lines** — show comment, timestamp, Edit/Delete buttons inline
- [x] **Annotations sidebar panel** — TreeView grouped by file; click to navigate
- [x] **Edit / delete single annotation** — sidebar right-click + editor context menu + hover buttons
- [x] **Keyboard shortcuts** — Cmd+Shift+H annotate, E edit, D delete, X export

### P1 — Quality & reliability
> Developer + User personas

- [x] **Stale annotation detection** — `shiftAnnotations` repositions ranges on every document edit
- [x] **Export preview** — show formatted output in a WebView before copying to clipboard
- [x] **Annotation labels / tags** — `bug`, `context`, `question`, `todo`, `important`; per-tag border colors

### P2 — Collaboration & output formats ✅
> PM + broader team

- [x] **Markdown export** — `## File > ### Lines X–Y` format for Notion/Confluence; Cmd+Shift+M
- [x] **Named annotation sets / sessions** — switch sets via toolbar; each set is a separate `.json` file
- [x] **Copy single file's annotations** — "Export Current File's Annotations" from editor context menu

### P3 — Power features ✅
> Developer persona

- [x] **`annotations.json` in source control** — `.gitignore` comments + `docs/team-sharing.md`
- [x] **Quick-pick search across annotations** — fuzzy search across all comments; Cmd+Shift+F
- [x] **LLM prompt templates** — `default`, `claude`, `gpt`, `custom` presets via settings

### P6 — LLM export quality ✅
> All personas; directly improves the core use case

- [x] **Revamp `claude` template to proper XML** — replaced the old `<annotated_context>` wrapper with `<code_annotations>` → `<file path="…">` → `<annotation lines="…" tag="…">` → `<note>` + `<code lang="…">` / `<content>`; all attribute values and note text are XML-escaped; `buildExportText.ts` uses a dedicated `buildClaudeXml` render path separate from the plain-text templates
- [x] **Configurable intent preamble** — `annotate.exportPreamble` setting (string, default: `""`); prepended before the annotation block (before the XML root or the `===` header); empty string disables it with no leading blank line
- [x] **Surrounding context lines setting** — `annotate.exportContextLines` (default: `0`); exports N lines above and below each annotated range; clamped to file bounds; rendered as `CONTEXT BEFORE / CONTEXT AFTER` labeled blocks in plain templates and `<context position="before/after" lines="…">` elements in the `claude` XML template
- [x] **Copy to clipboard commands** — `annotate.copyFileAnnotations` (`src/commands/copyFileAnnotations.ts`) copies the active file's annotations using the live editor buffer; bound to `Cmd+Shift+C` (Mac) / `Ctrl+Shift+C`. `annotate.copyToClipboard` (`src/commands/copyToClipboard.ts`) copies the full workspace export via `buildExportText`; unbound by default, available from the Command Palette.

### P5 — Discoverability & UX polish ✅
> All three personas; low-effort, high-visibility wins

#### Sidebar panel
- [x] **"Clear All Annotations" discoverability** — surfaced in `editor/context` menu and sidebar `view/title` toolbar with a `$(trash)` icon; renamed to "Clear Annotations…" to hint at the two-option modal
- [x] **Annotation count badges on file nodes** — already implemented: `FileNode.description` shows `"N annotation(s)"` text alongside each file
- [x] **Sort options in sidebar** — `$(sort-precedence)` button in sidebar toolbar opens a QuickPick to toggle sort-by-file / sort-by-date / sort-by-tag; preference persisted to `annotate.sidebarSortMode` workspace setting; syncs if `settings.json` is edited directly
- [x] **Inline comment preview on sidebar hover** — already implemented: `AnnotationNode.tooltip` shows full comment text on hover

#### Editor / gutter
- [x] **Gutter icon differentiation by tag** — per-tag SVG gutter icons in `media/` (`gutter-bug.svg`, `gutter-question.svg`, `gutter-todo.svg`, `gutter-context.svg`, `gutter-important.svg`, `gutter-default.svg`, `gutter-stale.svg`); `DecorationsManager` loads them via `extensionUri`
- [x] **Annotation count in status bar** — `$(comment) N annotation(s)` item in the right status bar; hidden when count is 0; click opens the LLM Annotator sidebar

#### Onboarding / empty states
- [x] **Empty sidebar state** — `treeView.message` shows platform-aware "No annotations yet — select text and press ⌘/Ctrl+Shift+H to start" when the store is empty
- [x] **First-install welcome notification** — one-time toast on first activation listing the three core shortcuts; `globalState` flag prevents re-showing

#### Destructive action safety
- [x] **"Clear This File" option** — the "Clear Annotations…" modal now offers "Clear This File" (when an editor is active) and "Clear Workspace"; file-scoped clear is one atomic `store.save(filtered)` call
- [x] **Undo last clear** — 10-second "Undo" toast after either clear action; `store.save(snapshot)` restores the pre-clear state and fires `onDidChange` so tree and decorations refresh automatically

---

### P4 — Power-user depth
> Heavy Claude Code users, markdown-heavy workflows

- [x] **Branch-aware annotations** — store annotations per git branch; warn when switching branches would surface a different annotation set; surface "orphaned" annotations when a branch is deleted
- [x] **Markdown file annotation support** — annotate sections of `.md`, `.mdx`, `.rst` docs the same way as code (READMEs, ADRs, PRDs, RFCs); critical for workflows where docs are half the LLM context
- [x] **`@mention` tags in comments** — structured inline tags (`@question`, `@todo`, `@critical`, `@stale`) parsed from comment text; filter export to only emit annotations matching a given tag set
- [x] **Stale annotation diff view** — when annotated source lines have changed since the note was written, show a side-by-side diff of the original captured content vs current; surface as a distinct "stale" gutter state beyond just line-shift detection
- [x] **Annotate from Markdown preview tab** — `Cmd/Ctrl+Shift+H` fires from the built-in Markdown preview WebView (`when: activeWebviewPanelId == 'markdown.preview'`); resolves the source `.md` file via Tab API adjacency heuristic (handles "Open Preview to Side" layout) with fallback to visible editors and workspace search; parses ATX headings into sections (fence-aware, trailing-blank trimmed) and presents a QuickPick so the user annotates without leaving reading mode; gutter decorations appear in the source tab on next open; `src/commands/annotateFromMarkdownPreview.ts`
- [x] **Render annotations inside the Markdown preview** — `media/annotationPreview.js` contributed via `"markdown.previewScripts"`; on `store.onDidChange` the extension calls `markdown.preview.refresh` (if a preview tab is open); the script fetches `.vscode/annotations.json` via `resourceBase`, filters to the current file by URI suffix matching, and overlays a colored left border + tag badge on each `[data-line]` element within annotated ranges; hovering the badge shows the full comment via native `title` tooltip; a debounced `MutationObserver` re-applies after each re-render; **known limitation:** only reads the default annotation set (`.vscode/annotations.json`), not branch-named sets

---

### Production Readiness — Pre-release hardening ✅

Reviewed 2026-03-28. Fixed all critical and major issues identified before public release.

- [x] **Store proxy pattern** (`exportFiltered.ts`) — replaced `Object.create(store)` prototype-chain proxy with a plain `{ load }` wrapper; eliminates inaccessible-private-member risk
- [x] **Character-level range data preserved on shift** (`annotationStore.ts`) — spread `ann.range` before overriding `start`/`end` so `startChar`/`endChar` survive `shiftAnnotations`
- [x] **Terminal identity via `terminal.name`** (`exportToTerminal.ts`) — replaced `(t as any).processId` (non-public API, undefined on remote/WSL) with the stable `t.name`; added `onDidCloseTerminal` listener to clear stale reference
- [x] **Section end-line off-by-one** (`annotateFromMarkdownPreview.ts`) — guard changed from `endLine > h.line + 1` to `endLine > h.line` so consecutive headings no longer produce a range that includes the heading line of the next section
- [x] **Path traversal via `fileUri`** (`buildExportText.ts`, `exportMarkdown.ts`) — `readLines()` now validates that the resolved path starts with the workspace root before reading
- [x] **Overly aggressive stale marking** (`staleDetector.ts`) — changed guard from `range.end >= lines.length` to `range.start >= lines.length`; partial overlaps are now compared rather than nuked
- [x] **Fire-and-forget error swallowing** (`extension.ts`) — `updateTreeViewTitle` IIFE now wraps `store.load()` in try/catch and logs errors
- [x] **Cryptographic CSP nonce** (`exportPreviewPanel.ts`) — replaced `Math.random` loop with `crypto.randomBytes(16).toString('hex')`
- [x] **Case-insensitive path comparison** (`annotateFromMarkdownPreview.ts`) — `fsPath` comparison for gutter refresh now lowercases on `win32` and `darwin`
- [x] **Inconsistent bounds clamping in stale diff** (`showStaleDiff.ts`) — `startLine`/`endLine` are now clamped to `≥ 1` for safe display in diff title
- [x] **Empty-comment validation consolidated** (`annotateSelection.ts`, `editAnnotation.ts`) — removed redundant downstream guards; validation is owned exclusively by `showAnnotationInput`'s InputBox validator
- [x] **`group[0]` defensive guard** (`annotationCodeLensProvider.ts`) — added explicit `if (group.length === 0) continue` before accessing `group[0]`
- [x] **Tag mutation via `delete`** (`editAnnotation.ts`) — `updated` annotation now constructed in a single expression using conditional spread; no post-spread `delete`
- [x] **Gutter icon validation at activation** (`decorations.ts`) — `DecorationsManager` fires an async check on construction; warns if any SVG is missing from `media/` rather than silently degrading
- [x] **Removed "annotate from Markdown preview" command** — section-picker UX was removed because the WebView selection API doesn't exist; replaced by the richer "render annotations in preview" feature above
