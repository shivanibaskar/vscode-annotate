# Architecture: vscode-annotate

## 1. Purpose & Design Philosophy

**vscode-annotate** (shipped as *LLM Annotator*) is a VS Code extension for annotating code and Markdown selections with comments and tags, then exporting that context as structured input for LLMs like Claude and GPT.

**Core principles:**
- **LLM-centric exports.** First-class Claude XML format (`<code_annotations>`) alongside GPT-style fenced blocks, plain text, and user-defined wrappers.
- **Non-invasive storage.** Annotations live in `.vscode/annotations*.json`, never embedded in source files.
- **Branch-aware.** Multiple annotation sets indexed by git branch for context-switching across features.
- **Two-step input UX.** Comment InputBox → tag QuickPick. Escape on the tag step saves without a tag; Escape on the comment step cancels entirely.
- **Staleness detection.** A content snapshot captured at creation time is compared against the current text to flag annotations whose source has drifted.
- **Reactive UI.** `AnnotationStore.onDidChange` drives the sidebar tree, status bar, gutter icons, hover tooltips, CodeLens, and Markdown-preview overlay in lockstep.

---

## 2. Directory layout

```
vscode-annotate/
├── src/
│   ├── extension.ts                    # Activation, command + event wiring
│   ├── types.ts                        # Annotation, LineRange, AnnotationTag, HoverArg
│   ├── annotationStore.ts              # Persistence, cache, serialized writes
│   ├── annotationsTreeProvider.ts      # Sidebar TreeView (sort by file / date / tag)
│   ├── annotationCodeLensProvider.ts   # Inline preview · Edit · Delete lenses
│   ├── hoverProvider.ts                # Hover tooltip with action command links
│   ├── decorations.ts                  # Gutter icons + line highlights per tag / stale
│   ├── staleDetector.ts                # Snapshot comparison
│   ├── gitBranchWatcher.ts             # Watch vscode.git HEAD; fire onDidChangeBranch
│   ├── mentions.ts                     # @mention parsing / filtering
│   ├── annotationSnapshotProvider.ts   # Virtual docs for the stale-diff editor
│   ├── langUtils.ts                    # Shared extension → language mapping
│   │
│   ├── commands/
│   │   ├── annotateSelection.ts        # Create annotation from selection
│   │   ├── editAnnotation.ts           # Modify comment / tag
│   │   ├── deleteAnnotation.ts         # Remove by id
│   │   ├── clearAnnotations.ts         # Clear file or workspace (with 10-s undo)
│   │   ├── buildExportText.ts          # Canonical export renderer (all templates)
│   │   ├── exportForLLM.ts             # Build → show in preview WebView
│   │   ├── exportMarkdown.ts           # Markdown export → untitled document
│   │   ├── exportCurrentFile.ts        # Active-file preview (self-contained formatter)
│   │   ├── exportFiltered.ts           # @mention multi-select → filtered export
│   │   ├── exportToTerminal.ts         # Inject export into a terminal (no Enter)
│   │   ├── copyToClipboard.ts          # All annotations → clipboard
│   │   ├── copyFileAnnotations.ts      # Active file → clipboard (live buffer, not disk)
│   │   ├── searchAnnotations.ts        # Fuzzy QuickPick → reveal
│   │   ├── switchAnnotationSet.ts      # Pick existing or create new set
│   │   ├── syncWithBranch.ts           # Switch set to sanitized git branch name
│   │   ├── showStaleDiff.ts            # vscode.diff on snapshot vs. current
│   │   └── utils.ts                    # getAnnotationAtCursor
│   │
│   ├── panels/
│   │   └── exportPreviewPanel.ts       # Singleton WebView with CSP nonce + Copy button
│   │
│   ├── ui/
│   │   └── annotationInput.ts          # showAnnotationInput: InputBox → QuickPick
│   │
│   └── test/
│       ├── runTest.ts
│       └── suite/                       # Mocha test suites (see §10)
│
├── media/
│   ├── logo.svg / logo.png
│   ├── gutter-{bug|question|todo|context|important|default|stale}.svg
│   └── annotationPreview.js            # Markdown-preview overlay script
│
├── package.json                        # Manifest + VS Code contributions
├── tsconfig.json · tsconfig.test.json
└── webpack.config.js                   # Production bundle → out/extension.js
```

---

## 3. Core data model

### `Annotation` (`src/types.ts`)

```ts
interface Annotation {
  id: string;                 // UUID v4, stable across edits
  fileUri: string;            // Workspace-relative POSIX path
  range: LineRange;           // 0-based inclusive [start, end] (+ optional char bounds)
  comment: string;            // 1..5,000 chars (enforced at input and on load)
  tag?: AnnotationTag;        // 'bug' | 'context' | 'question' | 'todo' | 'important'
  contentSnapshot?: string;   // Lines at creation time, joined by '\n' (absent pre-P4.4)
  createdAt: string;          // ISO 8601
  updatedAt: string;          // ISO 8601
}

interface LineRange {
  start: number;              // 0-based, inclusive
  end: number;                // 0-based, inclusive
  startChar?: number;         // enables character-precise decorations
  endChar?: number;
}

interface AnnotationsFile { version: 1; annotations: Annotation[]; }

type HoverArg = { readonly id: string };  // Minimal shape passed by hover command links
```

### Storage

- **Default set:** `.vscode/annotations.json`
- **Named set:** `.vscode/annotations-<setName>.json`

Set names are constrained to `[a-zA-Z0-9-]+` and are re-validated when enumerating existing sets from disk. Branch names are sanitized into set names by replacing `/\:*?"<>|` with `-`.

---

## 4. Module responsibilities

### `extension.ts` — activation hub
Instantiates `AnnotationStore`, `DecorationsManager`, `GitBranchWatcher`, `AnnotationsTreeProvider`, and registers the `ExportPreviewPanel` singleton on demand. Registers every command, the hover provider, the CodeLens provider, and the virtual `annotate-snapshot:` content provider.

Wires event listeners:
- `onDidChangeActiveTextEditor` → refresh decorations for the newly focused editor.
- `onDidChangeTextDocument` → `store.shiftAnnotations` + decoration refresh.
- `store.onDidChange` → update tree view title, annotation-count status bar item, and trigger `markdown.preview.refresh` if a preview is open.
- `onDidChangeConfiguration('annotate.sidebarSortMode')` → sync sort mode when `settings.json` is edited directly (no persistence write-back).
- `branchWatcher.onDidChangeBranch` → offer to switch annotation set (and switch automatically via `syncWithBranch` if the user confirms).

Also owns the **first-install welcome notification** (gated by `context.globalState['annotate.welcomed']`) and the **annotation-count status bar item** (hidden at zero; clicks open the sidebar).

### `annotationStore.ts` — persistence & cache
Single source of truth for annotation data. Key invariants:

- **Serialized writes.** All flushes chain onto a single `_flushQueue: Promise<void>` — eliminating concurrent-write races during rapid mutation bursts.
- **Snapshotted flushes.** `_scheduleFlush` deep-copies annotations (including their nested `range`) before queuing, so later in-memory mutations cannot corrupt an in-flight write.
- **URI captured pre-suspension.** Each mutation resolves `getStoreUri()` *before* awaiting disk I/O so a `switchSet()` during the await cannot redirect the write to the wrong file.
- **Shared-promise cold load.** `_ensureLoaded()` memoizes an in-flight `_loadFromDisk()` so concurrent callers share one read; a `switchSet()` during the read discards the stale result.
- **Field-level validation.** `_isValidAnnotation` rejects individual malformed entries rather than dropping the whole file (recoverable partial corruption). Validates id, fileUri, comment (1–`MAX_COMMENT_LENGTH`=5000 chars), ISO timestamps, numeric in-bounds range, and the tag allowlist.

Public API:
| Method | Purpose |
|--------|---------|
| `load()` | Returns a shallow-cloned `AnnotationsFile`. |
| `save(data)` | Replaces the cache and enqueues a flush. |
| `add` / `remove` / `update` | Mutate cache + enqueue flush + fire `onDidChange`. |
| `clear()` | Empties cache and waits for the flush queue to drain. |
| `getForFile(relPath)` | Filtered view. |
| `shiftAnnotations(relPath, changes)` | Adjusts ranges on document edits (details in §6). |
| `switchSet(name)` | Invalidates cache + load promise, fires `onDidChange`. |
| `flush()` | Awaits the write queue (used in tests). |
| `static listSets()` | Enumerates `.vscode/annotations*.json` with allowlist re-validation. |

### `annotationsTreeProvider.ts` — sidebar tree
Two-level tree: **FileNode** (collapsible, shows annotation count) → **AnnotationNode** (truncated comment ≤60 chars, line range, tag icon, `@mention` labels). Clicking a node fires `annotate.revealAnnotation`.

Sort modes (initialised from `annotate.sidebarSortMode`, written back on user change):

| Mode | File order | Annotation order |
|------|-----------|-----------------|
| `file` | Alphabetical | By start line |
| `date` | Newest annotation first | Newest `createdAt` first |
| `tag` | Alphabetical | Tag priority → start line (bug > important > question > todo > context > untagged) |

### `decorations.ts` — gutter icons & highlights
`DecorationsManager` owns one `TextEditorDecorationType` per tag plus a dedicated stale type (dashed amber border). `refresh(editor)`:
1. Load annotations for the file.
2. For each, evaluate `isAnnotationStale(a, docText)`; stale entries route to `staleRanges`, the rest bucket by tag (`_default` for untagged).
3. Call `setDecorations` for every bucket (including empty ones — required to clear previously-applied decorations).

Ranges are character-precise when `startChar`/`endChar` are present; otherwise full-line (`Number.MAX_SAFE_INTEGER` end column).

Tag → theme color:
| Tag | Token |
|-----|-------|
| `bug` | `errorForeground` |
| `question` | `notificationsWarningIcon.foreground` |
| `todo` | `notificationsInfoIcon.foreground` |
| `context` / untagged | `editorInfo.foreground` |
| `important` | `charts.purple` |
| stale | `editorWarning.foreground` (dashed) |

**Eager icon validation.** On construction, `_warnIfIconsMissing` asynchronously stats every SVG in `media/` and surfaces a warning if any is absent — catching packaging mistakes at load rather than at first use.

### `staleDetector.ts`
```ts
if (!annotation.contentSnapshot) return false;              // legacy — never stale
if (annotation.range.start >= lines.length) return true;    // range fell off EOF
return current.trimEnd() !== annotation.contentSnapshot.trimEnd();
```
`trimEnd` on both sides suppresses false positives from formatters that add/remove trailing whitespace.

### `annotationCodeLensProvider.ts`
For each annotation, emits lenses at its (clamped) start line:
- **Single annotation:** three lenses — `<tag-icon> truncated-preview`, `$(pencil)`, `$(trash)`.
- **Multiple on the same line:** a single summary lens — `$(comment) N annotations on this line`.

All lenses invoke commands by passing the annotation object directly. Re-fires on `store.onDidChange` via `_onDidChangeCodeLenses`.

### `hoverProvider.ts`
Renders a **trusted** `MarkdownString` (required for `command:` URIs) with `supportThemeIcons`. For each annotation at the hovered line:
- Header with `$(comment)` icon and `created`/`edited` timestamp (human-formatted).
- Comment body inserted via `appendText` so user content cannot inject Markdown.
- `@mention` badges rendered as inline code tokens.
- Action links: `$(pencil) Edit`, `$(trash) Delete`, and — when a snapshot exists — `$(diff) Diff`.

Multiple annotations on the same range are separated by `---`. Command link args are JSON-encoded to `{ id }` only (not the full annotation); handlers resolve the full record via `store.load()`.

### `gitBranchWatcher.ts`
Optional dependency on the built-in `vscode.git` extension.
- Activates git if needed, then attaches to `repositories[0]`.
- Listens on `repo.state.onDidChange`; fires `onDidChangeBranch(name)` when `HEAD.name` changes.
- Also subscribes to `onDidOpenRepository` so late-opened repos are picked up.
- No-ops silently if the git extension is unavailable (branch awareness is a progressive enhancement).

### `mentions.ts`
`@mention` regex: `/(?<!\w)@[a-zA-Z]\w*/g` — negative lookbehind excludes email addresses.
- `parseMentions(comment)` → deduplicated, lowercased `string[]`.
- `collectAllMentions(comments)` → sorted union.
- `commentHasMention(comment, Set<string>)` → boolean.

### `annotationSnapshotProvider.ts`
Registers the `annotate-snapshot:` scheme. URIs are of the form `annotate-snapshot://<original|current>/<annotationId>`.
- `original` → returns `annotation.contentSnapshot` (or a placeholder for pre-P4.4 data).
- `current` → reads the live file and slices the annotated line range; returns a placeholder if the range has fallen off EOF.

### `langUtils.ts`
Central extension → fenced-language map (`ts → typescript`, `py → python`, …) and a `PROSE_EXTS` set (`md`, `mdx`, `rst`, `txt`) that switches exports from fenced `<code>` to plain `<content>` blocks. `exportCurrentFile.ts` and `exportMarkdown.ts` predate this module and keep local copies.

---

## 5. Command inventory

All commands are contributed under the `Annotate` category. Shortcuts apply when `editorTextFocus` unless noted.

| Command | Mac / Win shortcut | Notes |
|---------|-------------------|-------|
| `annotate.annotateSelection` | ⌘⇧H / Ctrl+Shift+H | Requires `editorHasSelection` |
| `annotate.editAnnotation` | ⌘⇧E / Ctrl+Shift+E | Resolves from node / `{id}` / cursor |
| `annotate.deleteAnnotation` | ⌘⇧D / Ctrl+Shift+D | Same resolver as edit |
| `annotate.exportForLLM` | ⌘⇧X / Ctrl+Shift+X | Opens preview WebView |
| `annotate.exportMarkdown` | ⌘⇧M / Ctrl+Shift+M | Opens an untitled Markdown doc |
| `annotate.searchAnnotations` | ⌘⇧F / Ctrl+Shift+F | Fuzzy QuickPick → reveal |
| `annotate.exportToTerminal` | ⌘⇧T / Ctrl+Shift+T | Injects without pressing Enter |
| `annotate.copyToClipboard` | ⌘⇧C / Ctrl+Shift+C | No preview, just copy |
| `annotate.copyFileAnnotations` | — | Active file → clipboard |
| `annotate.exportCurrentFile` | — | Active file → preview panel |
| `annotate.exportFiltered` | — | Pick @mentions, then export |
| `annotate.switchAnnotationSet` | — | Pick or create set |
| `annotate.syncWithBranch` | — | Switch set to current branch |
| `annotate.showStaleDiff` | — | Opens VS Code diff editor |
| `annotate.clearAnnotations` | — | File or workspace, 10-s undo |
| `annotate.setSortMode` | — | view/title on sidebar |
| `annotate.refreshAnnotationsView` | — | view/title on sidebar |
| `annotate.revealAnnotation` | — | Internal — opens file + selects range |

**Menu wiring:**
- `editor/context`: annotateSelection, editAnnotation, deleteAnnotation, exportCurrentFile, clearAnnotations, copyFileAnnotations.
- `view/item/context` (annotationNode): editAnnotation, deleteAnnotation, showStaleDiff.
- `view/title` (annotationsView): refresh, switchAnnotationSet, setSortMode, clearAnnotations.

---

## 6. Data flow

### Creating an annotation

```
User selects text
  → annotateSelection
      → showAnnotationInput()              // InputBox → QuickPick
      → adjust end line (column-0 rule)
      → capture contentSnapshot from editor.document.getText()
      → store.add({ id: uuid, fileUri, range, comment, tag?, contentSnapshot, now, now })
          → _ensureLoaded → push → _scheduleFlush(uri, data) → _onDidChange.fire()
  → onDidChange listeners:
      treeProvider._onDidChangeTreeData.fire()
      codeLens._onDidChangeCodeLenses.fire()
      extension.ts: updateTreeViewTitle + updateStatusBar + refreshMarkdownPreviewIfOpen
  → annotateSelection: decorations.refresh(editor)
```

Column-0 rule: if the selection ends at column 0 on a later line (common when selecting whole lines by dragging), the trailing line is *not* included in the annotation.

### Document edits → `shiftAnnotations`

Called from `onDidChangeTextDocument`. Processes changes bottom-to-top (sorted by `range.start.line` descending) to prevent cascading offset errors:

```
for each change:
  lineDelta = newlines(change.text) - (change.range.end.line - change.range.start.line)
  if lineDelta === 0: skip
  for each annotation in this file:
    - entirely before the change:  unchanged
    - entirely after the change:   shift both bounds by lineDelta
    - overlaps:
        · insertion at/before start: shift both bounds (content moved down)
        · otherwise: only end shifts
  filter: drop annotations where end < start or start < 0
  if modified: _scheduleFlush + _onDidChange.fire
```

### Exporting (⌘⇧X)

```
exportForLLM(store)
  → buildExportText(store)
      → store.load() → read config → group by file
      → claude path:        buildClaudeXml(byFile, fileLines, includeContents, contextLines)
        plain/gpt/custom:   wrap with { header, footer } + per-annotation formatAnnotationPlain
      → prepend preamble
  → ExportPreviewPanel.show(text)
      → singleton WebView, CSP nonce, escaped <pre>, Copy button
      → postMessage('copy') → env.clipboard.writeText
```

---

## 7. Export pipeline

### `buildExportText()` — canonical renderer (`src/commands/buildExportText.ts`)

The single path for `exportForLLM`, `exportFiltered`, `exportToTerminal`, and `copyToClipboard`.

- Reads `annotate.includeFileContents`, `annotate.promptTemplate`, `annotate.promptTemplateCustom`, `annotate.exportPreamble` (trimmed), `annotate.exportContextLines` (clamped to ≥ 0).
- Groups annotations by `fileUri`; iterates file paths sorted alphabetically; annotations sorted by start line.
- **Path-traversal defense.** `readLines(fileUri)` resolves against the workspace root and refuses any path that escapes it (`../../.ssh/id_rsa` and similar).
- **Prose handling.** `isProseFile(fileUri)` (md/mdx/rst/txt) renders `CONTENT` / `<content>` instead of fenced code.

#### Templates

**`default`** — `=== ANNOTATED CODE CONTEXT ===` … `--- FILE: … ---` blocks with `[Lines X–Y]`, optional `TAG:`, `COMMENT:`, `CODE:` (fenced with language) or `CONTENT:` sections. Optional `CONTEXT BEFORE/AFTER` blocks when `exportContextLines > 0`.

**`claude`** — dedicated XML render path (`buildClaudeXml`):
```xml
<code_annotations>
  <file path="src/foo.ts">
    <annotation lines="5-7" tag="bug">
      <note>Off-by-one error</note>
      <context position="before" lines="3-4">…</context>
      <code lang="typescript">for (let i = 0; i &lt;= arr.length; i++) { ... }</code>
      <context position="after" lines="8">…</context>
    </annotation>
  </file>
</code_annotations>
```
Attributes and text (comments, paths, tags) are XML-escaped (`& < > "`). Code content is left verbatim inside its element so the LLM sees the literal source.

**`gpt`** — triple-backtick block tagged `annotated-context`.

**`custom`** — user-supplied `"HEADER|||FOOTER"` (split on `|||`); falls back to default if the split doesn't yield exactly two parts.

### `exportMarkdown` (`Cmd+Shift+M`)
Opens an untitled Markdown document: `# Annotated Code Context`, then `## <file>`, then `### Lines X–Y \`[tag]\`` with the comment as a blockquote and fenced code snippet. Language inferred from extension. Uses its own local `LANG_MAP` rather than `langUtils` (historical; not a functional difference).

### `exportCurrentFile`
Active file only. Self-contained plain formatter; opens in the `ExportPreviewPanel`.

### `exportFiltered`
1. `collectAllMentions(comments)` across all annotations.
2. If none, fall back to full `exportForLLM`.
3. Multi-select QuickPick → filter annotations whose comment contains ≥1 selected mention.
4. Wrap the filtered list in a minimal `{ load: async () => ({ version: 1, annotations: filtered }) }` and cast to `AnnotationStore`. Reuses `exportForLLM` unmodified — no subclassing, no proxy.

### `exportToTerminal` (`Cmd+Shift+T`)
1. `buildExportText` → text.
2. Resolve target terminal:
   - 0 terminals: warn.
   - 1 terminal: auto-select.
   - 2+: remember the last-used terminal by **name** (process id isn't part of the public API and may be undefined on remote/WSL); picker otherwise.
3. `terminal.sendText(output, /* addNewLine */ false)` — leaves the cursor in the buffer so the user appends their question before hitting Enter.
4. `registerTerminalCloseListener` clears `_lastTerminalName` when the targeted terminal closes.

### `copyToClipboard` / `copyFileAnnotations`
- `copyToClipboard` reuses `buildExportText` and writes the result to `vscode.env.clipboard`. Honors every export setting.
- `copyFileAnnotations` is file-scoped and reads lines **from the live editor buffer** (not disk), so the `readLines` path-traversal guard is irrelevant here. Intentionally does **not** apply `exportPreamble` or `exportContextLines` — it produces a compact file snapshot, not a full workspace export.

### `searchAnnotations` (`Cmd+Shift+F`)
`QuickPick` with `matchOnDescription` + `matchOnDetail` across `comment` / filename / tag. Selection → open file + select range.

### `showStaleDiff`
Accepts a tree node, a full `Annotation`, a `HoverArg` (`{id}`), or nothing (resolves from cursor).
- Bails if no `contentSnapshot`.
- Reads the current file and returns early with an info message if the annotation is **not** actually stale.
- Opens VS Code's built-in diff: `vscode.diff(originalUri, currentUri, title)` using the `annotate-snapshot:` scheme for both sides.

---

## 8. WebView panels

### `ExportPreviewPanel` (`src/panels/exportPreviewPanel.ts`)
Singleton — subsequent exports re-render the same panel. Security model:
- CSP meta tag: `default-src 'none'; script-src 'nonce-{nonce}'; style-src 'nonce-{nonce}'`.
- Nonce generated per build via `crypto.randomBytes(16).toString('hex')`.
- Export text HTML-escaped before insertion into a `<pre>`.
- Only message accepted: `{ command: 'copy' }` — shape-validated on receive.
- Styles use `var(--vscode-*)` theme tokens so the panel adapts to the active theme.

### `media/annotationPreview.js` — Markdown preview overlay
Contributed via `markdown.previewScripts` in `package.json`. Runs inside VS Code's built-in Markdown preview WebView.

- Reads `.vscode/annotations.json` via `fetch(resourceBase + '.vscode/annotations.json')` — currently only the default set.
- Matches each annotation's `fileUri` against the preview's `settings.source` (full URI, suffix match).
- For every `[data-line]` element in the annotated line range: applies a colored left border, subtle background tint, and attaches a `✎ tag` badge on the first line.
- Debounced `MutationObserver` on `document.body` re-runs after each preview re-render (the extension triggers `markdown.preview.refresh` on `store.onDidChange`).
- Styles are injected once; all colors come from `--vscode-*` variables with fallback hex.

---

## 9. Configuration (`annotate.*`)

| Key | Type | Default | Effect |
|-----|------|---------|--------|
| `includeFileContents` | boolean | `true` | Embed code/content snippets in exports |
| `promptTemplate` | enum | `"default"` | `default` \| `claude` \| `gpt` \| `custom` |
| `promptTemplateCustom` | string | `""` | `"HEADER\|\|\|FOOTER"` for custom template |
| `exportPreamble` | string | `"Review the following annotated code and address each note in context."` | Framing prompt prepended to every export (empty = disabled) |
| `exportContextLines` | number | `0` | Lines of context above/below each annotated range (clamped to ≥ 0) |
| `sidebarSortMode` | enum | `"file"` | Sidebar sort order; persisted to workspace settings |

---

## 10. Test suite (`src/test/suite/`)

Run with `npm test` — pretest compiles via `tsconfig.test.json`, then `@vscode/test-electron` boots a VS Code instance.

| Test file | Covers | Key scenarios |
|-----------|--------|---------------|
| `annotationStore.test.ts` | AnnotationStore | CRUD, cache invalidation, validation, range shifting, write queue |
| `annotationsTreeProvider.test.ts` | TreeProvider | Sort modes (file/date/tag), grouping, node labels |
| `annotationCodeLensProvider.test.ts` | CodeLensProvider | Single vs. grouped lenses, bounds clamping |
| `buildExportText.test.ts` | buildExportText | All templates, XML escaping, context lines, path traversal |
| `exportForLLM.test.ts` | exportForLLM | Panel creation, content rendering |
| `exportMarkdown.test.ts` | exportMarkdown | Markdown format, file grouping |
| `exportCurrentFile.test.ts` | exportCurrentFile | File-scoped preview |
| `exportFiltered.test.ts` | exportFiltered | @mention parsing, multi-select, empty fallback |
| `exportToTerminal.test.ts` | exportToTerminal | Terminal resolution, injection, session memory |
| `exportPreviewPanel.test.ts` | ExportPreviewPanel | HTML output, CSP nonce, clipboard message |
| `copyToClipboard.test.ts` | copyToClipboard | Workspace-wide clipboard write |
| `copyFileAnnotations.test.ts` | copyFileAnnotations | File-scoped filter, live-buffer read |
| `searchAnnotations.test.ts` | searchAnnotations | QuickPick match, reveal behavior |
| `hoverProvider.test.ts` | hoverProvider | Tooltip rendering, action links, @mention badges |
| `staleDetector.test.ts` | staleDetector | Snapshot comparison, whitespace tolerance |
| `mentions.test.ts` | mentions | Parse, collect, filter, email exclusion |
| `showStaleDiff.test.ts` | showStaleDiff | Snapshot diff, cursor resolution, line clamping |
| `syncWithBranch.test.ts` | syncWithBranch | Branch-name sanitization, set switching |
| `annotationSnapshotProvider.test.ts` | SnapshotProvider | Virtual doc serving |
| `commands.test.ts` | Integration | Annotate → export → clear end-to-end |

---

## 11. Key design patterns

### Two-step input UX
`showAnnotationInput()` runs an `InputBox` for the comment, then a `QuickPick` for the tag. Escape on step 2 saves the comment without a tag; Escape on step 1 cancels entirely. Prevents the prior combined-widget design where escaping the picker discarded the comment.

### Serialized write queue
All `AnnotationStore` flushes chain onto a single promise:
```ts
this._flushQueue = this._flushQueue.then(async () => { /* write */ });
```
Combined with a deep-cloned snapshot captured at enqueue time, this guarantees disk consistency even during rapid sequential mutations.

### Shared-promise cold load
`_ensureLoaded` memoizes the first in-flight load so concurrent callers see one disk read. A concurrent `switchSet()` invalidates the cache assignment, discarding the stale load — preventing the "load from branch A arrives after switch to branch B" race.

### URI captured pre-suspension
Every mutation resolves `getStoreUri()` *before* `await`ing `_ensureLoaded()`, pinning the target file. A `switchSet()` during the await cannot redirect the subsequent flush.

### Proxy-free filtered export
`exportFiltered` creates a plain object `{ load: async () => ({ version: 1, annotations: filtered }) }` cast to `AnnotationStore`. Avoids subclassing or prototype tricks while reusing `exportForLLM` unmodified.

### Nonce-based CSP
`ExportPreviewPanel` generates a fresh `crypto.randomBytes(16).toString('hex')` nonce per render and applies it to the CSP meta tag and to every `<script>` / `<style>` tag. No `unsafe-inline`; inbound messages are shape-validated before acting.

### Eager icon validation
`DecorationsManager` fires `_warnIfIconsMissing()` asynchronously on construction. Surfaces missing SVG files at extension load rather than silently producing blank gutters at first use.

### Content-snapshot staleness
Snapshot is the raw text of annotated lines joined by `\n`. Comparison trims trailing whitespace to suppress formatter noise. `range.start >= lines.length` is an unconditional stale signal.

### Undo window via `Promise.race`
`clearAnnotations` races a 10-second timeout against the post-clear notification:
```ts
Promise.race([
  vscode.window.showInformationMessage(msg, 'Undo'),
  new Promise<undefined>(r => setTimeout(() => r(undefined), 10_000)),
]);
```

### Graceful git degradation
`GitBranchWatcher` no-ops if `vscode.git` is unavailable. Branch-aware sets are a progressive enhancement, not a hard dependency.

### Bottom-to-top range shifting
`shiftAnnotations` sorts changes by `range.start.line` descending before applying offsets. Processing top-to-bottom would make every shift's line numbers stale relative to the next change; bottom-to-top keeps each change's coordinate system intact.
