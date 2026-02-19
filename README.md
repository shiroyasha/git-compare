# Git Compare

A Cursor/VS Code extension that shows a tree of changed files between your
current branch and a base branch (defaults to `main`).

## Features

- **Tree view** of all changed files grouped by directory
- **Diff viewer** — click any file to see a side-by-side diff against the base branch
- **Status icons** — added, modified, deleted, and renamed files are color-coded
- **Collapsible directories** — single-child folders are collapsed (`a/b/c` style)
- **Configurable base branch** — switch the base branch from the tree view header
- **Auto-refresh** — the tree updates when you switch branches

## Getting Started

```bash
npm install
npm run compile
```

Then press **F5** to launch the Extension Development Host, or install the `.vsix`:

```bash
npx vsce package
code --install-extension git-compare-0.1.0.vsix
```

## Usage

1. Open a Git repository in Cursor/VS Code
2. Click the **Git Compare** icon in the activity bar (left sidebar)
3. The tree shows all files changed between your branch and `main`
4. Click a file to open a diff view
5. Use the branch icon in the tree header to change the base branch
