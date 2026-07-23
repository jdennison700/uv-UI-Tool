# UV UI Tool

A VS Code extension that provides a UI for working with `uv`-managed Python projects: run `uv` commands, create a UV project, pin Python versions, search/add PyPI packages, and visualize `uv.lock` dependencies.

> Status: in development.

## Features

- **Command Center (panel + sidebar)**
   - Run arbitrary `uv …` commands in the detected project root, with streamed stdout/stderr, version highlighting, and a copy button.
   - A grouped command list (dependencies/lock, run and tools, pip workflows, maintenance) whose entries fill the input so you can edit before running.
   - Windows-only `uv sync` fallback: if `uv sync` fails with “os error 5”, the extension deletes `.venv` and retries once.

- **UV project detection**
   - Detects a project root by walking upward from the active file, then scanning the workspace for `uv.lock`, `uv.toml`, or `pyproject.toml`.
   - Shows connection status and the detected project path in the header.

- **Create UV project**
   - When no project is detected, offers a “Create UV project” action that runs `uv init` in the workspace root.

- **Python version pinning**
   - Loads stable CPython download versions via `uv python list --only-downloads --output-format json`.
   - Reads the current pinned version from `.python-version` (when present).
   - Two-step “prepare” + “confirm and run” flow to execute `uv python pin <version>`.

- **Package adder (PyPI)**
   - Searches packages using the PyPI simple index (250 ms debounce; ignores queries shorter than 2 characters; top 20 matches).
   - Enriches results with version + summary from PyPI JSON metadata (cached for 30 minutes).
   - Multi-select packages, choose regular vs dev dependencies, and optionally apply a version specifier.
   - Two-step “prepare” + “confirm and run” flow that executes `uv add [--dev] …`.

- **Dependency graph (`uv.lock`)**
   - Opens a dedicated graph view by parsing `uv.lock` in the detected project root. The graph is a snapshot taken when it opens — re-run the action to refresh it after the lockfile changes.
   - Force-directed canvas with drag-to-pan, scroll-to-zoom, and fit/reset controls.
   - Search filters the visible packages; pressing `Enter` centres and selects the best match (exact → prefix → substring).
   - “Max connections per package” (default 30) hides packages whose dependency + dependent count exceeds the limit, which keeps large lockfiles readable.
   - Colour key for direct/transitive/related/selected nodes, plus an inspector listing a selected package’s direct dependencies and dependents.

- **Theme sync (light/dark)**
   - Theme changes persist and stay in sync across the panel, sidebar, and dependency graph.

## Requirements

- VS Code `1.116.0` or newer.
- `uv` must be installed and available on your `PATH`.
- Network access is required for PyPI search / package metadata.
- Open a folder/workspace in VS Code (not just a single file). The package adder and Python version controls stay disabled until a project is detected.

## Usage

Open the Command Palette (`Ctrl+Shift+P` / `Cmd+Shift+P`) and run:

- `UV UI Tool: Open Panel` — opens the main webview panel.
- `UV UI Tool: Open Sidebar` — focuses the UV UI Tool view in the Activity Bar.
- `UV UI Tool: Open Dependency Graph` — opens the dependency graph (requires `uv.lock`).

The panel and the sidebar share the same UI and message flow; the dependency graph is a separate webview.

## Run locally (development)

1. Install dependencies:
    ```bash
    npm install
    ```
2. Compile the extension:
    ```bash
    npm run compile
    ```
    Or run the compiler in watch mode:
    ```bash
    npm run watch
    ```
3. Launch the extension host:
    - Press `F5` in VS Code

## Testing

Run the test suite (compiles, lints, then runs the extension tests via `@vscode/test-cli`):

```bash
npm test
```

The first run downloads a VS Code build into `.vscode-test/` before the suites start, so expect a pause with no output. Runner config lives in `.vscode-test.mjs`; the suites execute against the compiled output in `out/test/`.

- `src/test/extension.test.ts` — activation, command registration, and end-to-end command smoke tests.
- `src/test/packageAdd.test.ts` — package name/version validation and `uv add` request building.
- `src/test/pypi.test.ts` — PyPI simple index parsing, HTML entity decoding, and search/metadata normalization.
- `src/test/pythonVersion.test.ts` — Python version comparison/validation and `uv python pin` request building.
- `src/test/shellCommand.test.ts` — `uv sync` detection, Windows "os error 5" detection, and theme name normalization.
- `src/test/uvLock.test.ts` — `uv.lock` dependency parsing and dependency graph payload building.

## Repo layout

- `src/extension.ts` — command registration, uv execution, project detection, uv.lock parsing, PyPI search, theme persistence.
- `src/test/` — unit and integration tests (see [Testing](#testing)).
- `media/script.js` + `media/style.css` — panel/sidebar UI.
- `media/dependency-graph.js` + `media/dependency-graph.css` — dependency graph UI.
