# UV UI Tool

A VS Code extension that provides a UI for working with `uv`-managed Python projects: run `uv` commands, create a UV project, pin Python versions, search/add PyPI packages, and visualize `uv.lock` dependencies.

> Status: in development.

## Features

- **Command Center (panel + sidebar)**
   - Run arbitrary `uv …` commands (streaming output + copy button).
   - Quick actions and a small command library for common workflows.
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
   - Searches packages using the PyPI simple index (debounced; ignores queries shorter than 2 characters).
   - Enriches results with version + summary from PyPI JSON metadata (cached for 30 minutes).
   - Multi-select packages, choose regular vs dev dependencies, and optionally apply a version specifier.
   - Two-step “prepare” + “confirm and run” flow that executes `uv add [--dev] …`.

- **Dependency graph (`uv.lock`)**
   - Opens a dedicated graph view by parsing `uv.lock` in the detected project root.
   - Interactive canvas with pan/zoom, search filtering, “max edges per node” limiting, fit/reset controls, and an inspector for dependencies/dependents.

- **Theme sync (light/dark)**
   - Theme changes persist and stay in sync across the panel, sidebar, and dependency graph.

## Requirements

- `uv` must be installed and available on your `PATH`.
- Network access is required for PyPI search / package metadata.
- Open a folder/workspace in VS Code (not just a single file).

## Usage

Open the Command Palette (`Ctrl+Shift+P` / `Cmd+Shift+P`) and run:

- `UV UI Tool: Open Panel` — opens the main webview panel.
- `UV UI Tool: Open Sidebar` — focuses the UV UI Tool view in the Activity Bar.
- `UV UI Tool: Open Dependency Graph` — opens the dependency graph (requires `uv.lock`).
- `UV UI Tool: Hello World` — a simple smoke-test command.

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

## Repo layout

- `src/extension.ts` — command registration, uv execution, project detection, uv.lock parsing, PyPI search, theme persistence.
- `media/script.js` + `media/style.css` — panel/sidebar UI.
- `media/dependency-graph.js` + `media/dependency-graph.css` — dependency graph UI.
