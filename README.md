# LLM Annotator

Annotate code and Markdown selections with comments and tags, then export them as structured context for LLMs like Claude and GPT — straight from VS Code.

Stop retyping your investigation notes into chat. Highlight what matters, write your thoughts once, and ship the whole bundle to your model as a single well-formatted prompt.

---

## Why use it

- **Capture context where you read it.** Annotations live next to the code, not in a browser tab or a separate note.
- **First-class LLM export formats.** Dedicated Claude XML (`<code_annotations>`), GPT fenced blocks, and plain text — plus custom headers/footers.
- **Branch-aware sets.** Each git branch can have its own annotation set; switch automatically when HEAD changes.
- **Non-invasive.** Nothing is written into your source files. Everything goes to `.vscode/annotations*.json`.
- **Staleness detection.** Annotations remember what the code looked like when you wrote them and warn you when it drifts.

---

## Quick start

1. Select some lines in any file.
2. Press **⌘⇧H** (macOS) or **Ctrl+Shift+H** (Win/Linux) — or right-click → *Annotate Selection*.
3. Type your comment, press Enter. Pick a tag (or press Esc to skip tagging).
4. Keep annotating. When you're ready, press **⌘⇧A then X** / **Ctrl+Shift+A then X** to open the export preview, or **⌘⇧A then C** / **Ctrl+Shift+A then C** to copy the current file's annotations straight to the clipboard.
5. Paste into your LLM, add your question, hit send.

The **LLM Annotator** activity-bar icon opens a sidebar that lists every annotation in the workspace, grouped by file.

---

## Features

### Annotations
- Highlight any line range (or sub-line character range) and attach a comment up to 5,000 characters.
- Six optional tags — **bug**, **question**, **todo**, **context**, **important**, or none — each with its own gutter icon and border color.
- Character-precise decorations (not just full lines) when the selection has column info.
- Annotations survive edits: ranges shift automatically as you add/remove lines above them.
- Hover any annotated line to see the comment, timestamps, `@mentions`, and action links (Edit / Delete / Diff).
- Inline CodeLens above each annotation with a comment preview and one-click Edit / Delete.

### Export formats
Set `annotate.promptTemplate` to pick the wrapper:

| Template | Output |
|----------|--------|
| `default` | `=== ANNOTATED CODE CONTEXT ===` plain-text block with `FILE:` / `CODE:` sections |
| `claude`  | Anthropic-recommended XML: `<code_annotations><file><annotation><note><code>…` |
| `gpt`     | Triple-backtick fenced block tagged `annotated-context` |
| `custom`  | Your own header/footer, separated by `\|\|\|` |

A preamble (`annotate.exportPreamble`) is prepended to every export so the model knows what to do with the context. Set `annotate.exportContextLines` to include N lines above/below each annotated range.

### Markdown preview integration
Open a Markdown file's preview and annotated ranges are highlighted with a colored left border and a pencil badge — in both the source and the rendered preview.

### Branch-aware sets
Run **Use Current Git Branch as Annotation Set** to create (or switch to) a set named after the current branch. When you switch branches, the extension notifies you and offers to switch sets. Your default (unnamed) set is always there as a catch-all.

### Staleness detection
Each annotation captures a snapshot of the lines it covers. When those lines change, the annotation is marked stale (amber gutter, dashed border). Right-click → **Show Stale Annotation Diff** to see the original vs. current side-by-side in VS Code's diff editor.

### @mention filtering
Drop `@question`, `@critical`, `@todo` — any `@word` — into your comments. Run **Export Filtered Annotations (by @mention)** to pick which tags to include in the export.

### Send to terminal (Claude Code workflow)
**⌘⇧A then T** / **Ctrl+Shift+A then T** injects the export into an open VS Code terminal *without* pressing Enter, so you can append your question and submit when ready. Designed for terminal-based agents like Claude Code. (Disabled in Restricted Mode — see [Workspace Trust](#requirements).)

---

## Commands

All commands live under the **Annotate** category in the Command Palette.

Annotate Selection keeps its own shortcut; everything else lives behind the **⌘⇧A** / **Ctrl+Shift+A** chord leader (press the leader, release, then press the second key). Chords avoid shadowing built-in VS Code shortcuts like ⌘⇧F (search) and ⌘⇧E (Explorer).

| Command | Shortcut (Mac / Win+Linux) |
|---------|----------------------------|
| Annotate Selection | ⌘⇧H / Ctrl+Shift+H |
| Edit Annotation | ⌘⇧A then E / Ctrl+Shift+A then E |
| Delete Annotation | ⌘⇧A then D / Ctrl+Shift+A then D |
| Export Annotations for LLM | ⌘⇧A then X / Ctrl+Shift+A then X |
| Export Annotations as Markdown | ⌘⇧A then M / Ctrl+Shift+A then M |
| Search Annotations | ⌘⇧A then F / Ctrl+Shift+A then F |
| Send Annotations to Terminal (Claude Code) | ⌘⇧A then T / Ctrl+Shift+A then T |
| Copy File Annotations to Clipboard | ⌘⇧A then C / Ctrl+Shift+A then C |
| Copy All Annotations to Clipboard | — |
| Export Current File's Annotations | — |
| Export Filtered Annotations (by @mention) | — |
| Switch Annotation Set | — |
| Use Current Git Branch as Annotation Set | — |
| Show Stale Annotation Diff | — |
| Sort Annotations | — |
| Clear Annotations… | ⌘⇧A then ⌫ / Ctrl+Shift+A then Backspace |

> Using the JetBrains keymap extension? It binds Ctrl/Cmd+Shift+A to "Find Action" — rebind either one in Keyboard Shortcuts.

Clearing has a 10-second **Undo** window. The clear dialog lets you scope to the current file or the entire workspace.

---

## Settings

| Key | Type | Default | What it does |
|-----|------|---------|--------------|
| `annotate.includeFileContents` | boolean | `true` | Embed the annotated source lines in exports |
| `annotate.promptTemplate` | enum | `"default"` | `default` \| `claude` \| `gpt` \| `custom` |
| `annotate.promptTemplateCustom` | string | `""` | `"HEADER\|\|\|FOOTER"` for the `custom` template |
| `annotate.exportPreamble` | string | `"Review the following annotated code…"` | Framing prompt prepended to every export (empty = disabled) |
| `annotate.exportContextLines` | number | `0` | Surrounding lines above/below each range (0 = none) |
| `annotate.sidebarSortMode` | enum | `"file"` | Sidebar sort: `file` \| `date` \| `tag` |

---

## Storage format

Annotations are stored as JSON at the workspace root (in a multi-root workspace: the first folder):

- Default set: `.vscode/annotations.json`
- Named / branch set: `.vscode/annotations-<name>.json`
- Active-set pointer (read by the Markdown preview overlay): `.vscode/annotate-active-set.json` — per-machine UI state, add it to `.gitignore`

Schema (version 1):

```json
{
  "version": 1,
  "annotations": [
    {
      "id": "uuid-v4",
      "fileUri": "src/foo.ts",
      "range": { "start": 4, "end": 6, "startChar": 0, "endChar": 12 },
      "comment": "Off-by-one at loop termination.",
      "tag": "bug",
      "contentSnapshot": "for (let i = 0; i <= arr.length; i++) { ... }",
      "createdAt": "2026-04-18T12:34:56.789Z",
      "updatedAt": "2026-04-18T12:34:56.789Z"
    }
  ]
}
```

Set names are restricted to `[a-zA-Z0-9._-]+` (sanitized branch names like `release-1.2.0` and `feat_x` work as-is). Check this file into git to share annotations, or `.gitignore` it if they're personal.

In a multi-root workspace, `fileUri` is prefixed with the workspace folder's name (`backend/src/foo.ts`) so annotations resolve to the right folder. Renaming a workspace folder orphans its annotations until the prefix is updated. The Markdown preview overlay only reads annotation files from the first workspace folder.

---

## Tag colors

| Tag | Border / gutter color | Use for |
|-----|----------------------|---------|
| `bug` | red (`errorForeground`) | Broken behavior |
| `question` | amber (`notificationsWarningIcon.foreground`) | Something you don't understand |
| `todo` | blue (`notificationsInfoIcon.foreground`) | Action needed |
| `context` | green (`editorInfo.foreground`) | Background info for the LLM |
| `important` | purple (`charts.purple`) | High priority |
| *(untagged)* | green | Everything else |
| *(stale)* | amber dashed border | Source changed since annotation |

---

## Requirements

- VS Code `^1.88.0`
- A workspace folder (annotations are scoped per workspace; multi-root workspaces are supported, with annotation files stored under the first folder)
- Git extension is optional — used only for branch-aware sets; extension degrades gracefully without it
- Workspace Trust: everything works in Restricted Mode except **Send Annotations to Terminal**, which is disabled because comments from a committed `annotations.json` would be piped into your shell
- Not available in virtual workspaces (e.g. vscode.dev) — the extension reads files from the local filesystem

---

## License

MIT — see [LICENSE](./LICENSE).
