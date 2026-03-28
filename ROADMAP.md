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
