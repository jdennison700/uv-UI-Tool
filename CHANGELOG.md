# Change Log

All notable changes to the "uv-ui-tool" extension will be documented in this file.

Check [Keep a Changelog](http://keepachangelog.com/) for recommendations on how to structure this file.

## [0.0.1] - 2026-07-23

Initial release.

### Added

- **Command Center (panel + sidebar)** — run arbitrary `uv …` commands in the detected project root, with streamed stdout/stderr, version highlighting, and a copy button. Grouped command list (dependencies/lock, run and tools, pip workflows, maintenance) fills the input for editing before running.
- **UV project detection** — detects a project root by walking upward from the active file, then scanning the workspace for `uv.lock`, `uv.toml`, or `pyproject.toml`, and shows connection status in the header.
- **Create UV project** — offers a "Create UV project" action that runs `uv init` when no project is detected.
- **Python version pinning** — lists stable CPython download versions via `uv python list`, reads the current pin from `.python-version`, and runs `uv python pin <version>` through a two-step prepare/confirm flow.
- **Package adder (PyPI)** — debounced package search against the PyPI simple index with cached metadata, multi-select, regular/dev dependency toggle, optional version specifier, and a two-step prepare/confirm flow that runs `uv add [--dev] …`.
- **Dependency graph (`uv.lock`)** — force-directed canvas view of `uv.lock` with drag-to-pan, scroll-to-zoom, fit/reset controls, search-to-select, a "max connections per package" filter for large lockfiles, and an inspector for a selected package's dependencies/dependents.
- **Theme sync** — light/dark theme choice persists and stays in sync across the panel, sidebar, and dependency graph.
- Windows-only `uv sync` fallback: retries once after deleting `.venv` if the command fails with "os error 5".
- Test suite covering activation/command registration, package add validation, PyPI parsing, Python version handling, shell command detection, and `uv.lock` parsing.