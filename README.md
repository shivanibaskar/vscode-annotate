# vscode-annotate

A VS Code extension for annotating file selections with comments and exporting them to LLM context.

## Features

- **Annotate Selection**: Highlight any lines in a file, add a comment, and save the annotation
- **Export for LLM**: Format all annotations as structured context and copy to clipboard
- **Clear Annotations**: Remove all annotations for the current workspace

## Usage

1. Select lines in any file
2. Open Command Palette → `Annotate Selection`
3. Enter your comment
4. When ready, run `Export Annotations for LLM` to copy to clipboard

## Annotations format

Annotations are stored in `.vscode/annotations.json` at the workspace root.

