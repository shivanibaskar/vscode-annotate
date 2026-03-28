# Sharing Annotations with Your Team

Annotations are stored in `.vscode/annotations.json` (default set) or
`.vscode/annotations-<name>.json` (named sets).

## To share annotations

Remove the relevant lines from `.gitignore` and commit the file:

```bash
# Remove from .gitignore, then:
git add .vscode/annotations.json
git commit -m "chore: add shared code annotations"
```

Everyone who clones the repo will see your annotations automatically when
they open VS Code with the Annotate extension installed.

## Named sets

Named sets let you maintain separate annotation collections (e.g. one for a
code-review pass, another for onboarding notes).

Use **Annotate: Switch Annotation Set** (`Cmd+Shift+P` → "Switch Annotation
Set") to create or switch sets. Each set lives in its own file:

```
.vscode/annotations.json          ← default set
.vscode/annotations-auth.json     ← "auth" set
.vscode/annotations-onboarding.json
```

To share a named set, commit its file the same way as above.

## Conflict resolution

If two team members edit the same annotation file, resolve conflicts the same
way as any other JSON file. Each annotation has a stable UUID `id` field, so
adding/removing annotations in parallel results in clean JSON array merges
most of the time.
