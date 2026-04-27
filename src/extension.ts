// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as path from 'path';
import { spawn } from 'child_process';
import * as vscode from 'vscode';

type ThemeName = 'sunset' | 'matte-black';
const THEME_KEY = 'uv-ui-tool.theme';
let extensionContextRef: vscode.ExtensionContext | undefined;
let sidebarProviderRef: UVSidebarProvider | undefined;

function normalizeThemeName(value: unknown): ThemeName {
  return value === 'matte-black' ? 'matte-black' : 'sunset';
}

function getCurrentTheme(): ThemeName {
  return normalizeThemeName(extensionContextRef?.globalState.get<string>(THEME_KEY));
}

async function setCurrentTheme(theme: ThemeName) {
  const normalizedTheme = normalizeThemeName(theme);
  await extensionContextRef?.globalState.update(THEME_KEY, normalizedTheme);
  UVPanel.currentPanel?.applyTheme(normalizedTheme);
  sidebarProviderRef?.applyTheme(normalizedTheme);
  UVDependencyGraphPanel.currentPanel?.applyTheme(normalizedTheme);
}

function sendTheme(webview: vscode.Webview) {
  webview.postMessage({ command: 'setTheme', theme: getCurrentTheme() });
}

export function activate(context: vscode.ExtensionContext) {
  extensionContextRef = context;
  console.log('UV UI Tool activated');
  const openPanelCommand = 'uv-ui-tool.openPanel';
  const openSidebarCommand = 'uv-ui-tool.openSidebar';
  const openDependencyGraphCommand = 'uv-ui-tool.openDependencyGraph';
  const helloCommand = 'uv-ui-tool.helloWorld';

  context.subscriptions.push(
    vscode.commands.registerCommand(openPanelCommand, () => {
      UVPanel.createOrShow(context.extensionUri);
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(openSidebarCommand, async () => {
      await vscode.commands.executeCommand('workbench.view.extension.uvUiTool');
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(openDependencyGraphCommand, async () => {
      const parseResult = await parseUvLockDependenciesPayload();
      if (!parseResult.payload) {
        vscode.window.showErrorMessage(parseResult.message);
        return;
      }

      UVDependencyGraphPanel.createOrShow(context.extensionUri, parseResult.payload, getCurrentTheme(), parseResult.projectRoot);
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(helloCommand, () => {
      vscode.window.showInformationMessage('Hello World from UV UI Tool!');
    })
  );

  const provider = new UVSidebarProvider(context.extensionUri);
  sidebarProviderRef = provider;
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(
      'uvUiToolSidebar',
      provider,
      {
        webviewOptions: {
          retainContextWhenHidden: true
        }
      }
    )
  );
}

type UvDetectionResult = { isUvProject: boolean; projectRoot?: string; message: string };
type UvLockedPackage = { name: string; version?: string; dependencies: string[] };
type UvDependenciesPayload = {
  packageCount: number;
  edgeCount: number;
  withoutDependenciesCount: number;
  packages: UvLockedPackage[];
};
type UvParseResult = { payload?: UvDependenciesPayload; message: string; projectRoot?: string };
type DependencyTarget = 'regular' | 'dev';
type PackageAddRequest = {
  packageNames: string[];
  dependencyTarget: DependencyTarget;
  versionSpecifier?: string;
};
type PyPiSearchResult = { name: string; version?: string; summary?: string };
type PyPiPackageIndex = { names: string[]; loadedAt: number };
const PYPI_INDEX_CACHE_TTL_MS = 1000 * 60 * 30;
let cachedPyPiPackageIndex: PyPiPackageIndex | undefined;
let pyPiIndexLoadPromise: Promise<PyPiPackageIndex> | undefined;

async function uriExists(uri: vscode.Uri): Promise<boolean> {
  try {
    await vscode.workspace.fs.stat(uri);
    return true;
  } catch {
    return false;
  }
}

async function findUvProjectFromPath(startFilePath: string, workspaceRootPath: string): Promise<UvDetectionResult | undefined> {
  let currentPath = path.dirname(startFilePath);

  while (currentPath.startsWith(workspaceRootPath)) {
    const currentUri = vscode.Uri.file(currentPath);
    const hasUvLock = await uriExists(vscode.Uri.joinPath(currentUri, 'uv.lock'));
    if (hasUvLock) {
      return {
        isUvProject: true,
        projectRoot: currentPath,
        message: `UV project detected in ${path.basename(currentPath)} (found uv.lock).`
      };
    }

    const hasUvToml = await uriExists(vscode.Uri.joinPath(currentUri, 'uv.toml'));
    if (hasUvToml) {
      return {
        isUvProject: true,
        projectRoot: currentPath,
        message: `UV project detected in ${path.basename(currentPath)} (found uv.toml).`
      };
    }

    const hasPyproject = await uriExists(vscode.Uri.joinPath(currentUri, 'pyproject.toml'));
    if (hasPyproject) {
      return {
        isUvProject: true,
        projectRoot: currentPath,
        message: `Project detected in ${path.basename(currentPath)} (found pyproject.toml).`
      };
    }

    const parentPath = path.dirname(currentPath);
    if (parentPath === currentPath) {
      break;
    }

    currentPath = parentPath;
  }

  return undefined;
}

async function detectUvProject(): Promise<UvDetectionResult> {
  const folders = vscode.workspace.workspaceFolders ?? [];
  if (folders.length === 0) {
    return { isUvProject: false, message: 'No workspace folder is open. Open a folder to detect a UV project.' };
  }

  const activeDocumentPath = vscode.window.activeTextEditor?.document?.uri?.fsPath;
  if (activeDocumentPath) {
    for (const folder of folders) {
      if (activeDocumentPath.startsWith(folder.uri.fsPath)) {
        const activeFileDetection = await findUvProjectFromPath(activeDocumentPath, folder.uri.fsPath);
        if (activeFileDetection) {
          return activeFileDetection;
        }
      }
    }
  }

  const lockFiles = await vscode.workspace.findFiles('**/uv.lock', '**/node_modules/**', 10);
  if (lockFiles.length > 0) {
    const fileUri = lockFiles[0];
    const folder = vscode.workspace.getWorkspaceFolder(fileUri);
    const folderName = folder?.name ?? fileUri.path.split('/').slice(-2, -1)[0] ?? 'workspace';
    return {
      isUvProject: true,
      projectRoot: folder?.uri.fsPath ?? folders[0].uri.fsPath,
      message: `UV project detected in ${folderName} (found uv.lock).`
    };
  }

  const uvTomlFiles = await vscode.workspace.findFiles('**/uv.toml', '**/node_modules/**', 10);
  if (uvTomlFiles.length > 0) {
    const fileUri = uvTomlFiles[0];
    const folder = vscode.workspace.getWorkspaceFolder(fileUri);
    const folderName = folder?.name ?? fileUri.path.split('/').slice(-2, -1)[0] ?? 'workspace';
    return {
      isUvProject: true,
      projectRoot: path.dirname(fileUri.fsPath),
      message: `UV project detected in ${folderName} (found uv.toml).`
    };
  }

  const pyprojectFiles = await vscode.workspace.findFiles('**/pyproject.toml', '**/node_modules/**', 20);
  if (pyprojectFiles.length > 0) {
    const fileUri = pyprojectFiles[0];
    const folder = vscode.workspace.getWorkspaceFolder(fileUri);
    const folderName = folder?.name ?? fileUri.path.split('/').slice(-2, -1)[0] ?? 'workspace';
    return {
      isUvProject: true,
      projectRoot: path.dirname(fileUri.fsPath),
      message: `Project detected in ${folderName} (found pyproject.toml).`
    };
  }

  return { isUvProject: false, message: 'No UV project detected in the current workspace.' };
}

function sendProjectStatus(webview: vscode.Webview) {
  detectUvProject().then(status => {
    webview.postMessage({ command: 'setProjectStatus', ...status });
  });
}

function parseDependencyNamesFromArrayBlock(block: string): string[] {
  const dependencyNames = new Set<string>();
  const namePattern = /name\s*=\s*"([^"]+)"/g;

  let match: RegExpExecArray | null;
  while ((match = namePattern.exec(block)) !== null) {
    dependencyNames.add(match[1]);
  }

  return Array.from(dependencyNames);
}

function parseUvLockDependencies(lockFileContent: string): UvLockedPackage[] {
  const lines = lockFileContent.split(/\r?\n/);
  const packages: UvLockedPackage[] = [];

  let currentPackage: UvLockedPackage | undefined;

  const pushCurrentPackage = () => {
    if (!currentPackage?.name) {
      return;
    }

    currentPackage.dependencies = Array.from(new Set(currentPackage.dependencies)).sort();
    packages.push(currentPackage);
  };

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i].trim();

    if (line === '[[package]]') {
      pushCurrentPackage();
      currentPackage = { name: '', dependencies: [] };
      continue;
    }

    if (!currentPackage) {
      continue;
    }

    const nameMatch = line.match(/^name\s*=\s*"([^"]+)"/);
    if (nameMatch) {
      currentPackage.name = nameMatch[1];
      continue;
    }

    const versionMatch = line.match(/^version\s*=\s*"([^"]+)"/);
    if (versionMatch) {
      currentPackage.version = versionMatch[1];
      continue;
    }

    if (/^dependencies\s*=\s*\[/.test(line)) {
      let dependencyBlock = line;
      let bracketDepth = 0;

      const countBrackets = (value: string) => {
        for (const char of value) {
          if (char === '[') {
            bracketDepth += 1;
          } else if (char === ']') {
            bracketDepth -= 1;
          }
        }
      };

      countBrackets(line);

      while (bracketDepth > 0 && i + 1 < lines.length) {
        i += 1;
        dependencyBlock += `\n${lines[i]}`;
        countBrackets(lines[i]);
      }

      currentPackage.dependencies.push(...parseDependencyNamesFromArrayBlock(dependencyBlock));
    }
  }

  pushCurrentPackage();
  return packages;
}

function buildDependenciesPayload(parsedPackages: UvLockedPackage[]): UvDependenciesPayload {
  const sortedPackages = [...parsedPackages].sort((a, b) => a.name.localeCompare(b.name));
  const edgeCount = sortedPackages.reduce((sum, pkg) => sum + pkg.dependencies.length, 0);
  const withoutDependenciesCount = sortedPackages.filter(pkg => pkg.dependencies.length === 0).length;

  return {
    packageCount: sortedPackages.length,
    edgeCount,
    withoutDependenciesCount,
    packages: sortedPackages
  };
}

async function parseAndSendUvLockDependencies(webview: vscode.Webview, extensionUri: vscode.Uri) {
  const parseResult = await parseUvLockDependenciesPayload();
  if (!parseResult.payload) {
    vscode.window.showErrorMessage(parseResult.message);
    webview.postMessage({ command: 'parseFinished' });
    return;
  }

  UVDependencyGraphPanel.createOrShow(extensionUri, parseResult.payload, getCurrentTheme(), parseResult.projectRoot);
  webview.postMessage({ command: 'parseFinished' });
}

async function parseUvLockDependenciesPayload(): Promise<UvParseResult> {
  const detection = await detectUvProject();
  if (!detection.isUvProject || !detection.projectRoot) {
    return {
      payload: undefined,
      message: detection.message
    };
  }

  const lockFileUri = vscode.Uri.joinPath(vscode.Uri.file(detection.projectRoot), 'uv.lock');
  const hasLock = await uriExists(lockFileUri);
  if (!hasLock) {
    return {
      payload: undefined,
      message: `No uv.lock file found in ${detection.projectRoot}.`,
      projectRoot: detection.projectRoot
    };
  }

  const rawLockContent = await vscode.workspace.fs.readFile(lockFileUri);
  const lockContent = new TextDecoder('utf-8').decode(rawLockContent);
  const parsedPackages = parseUvLockDependencies(lockContent);
  const payload = buildDependenciesPayload(parsedPackages);

  return {
    payload,
    message: `Parsed ${payload.packageCount} packages from uv.lock.`,
    projectRoot: detection.projectRoot
  };
}

function getHtmlForDependencyGraphWebview(
  webview: vscode.Webview,
  extensionUri: vscode.Uri,
  payload: UvDependenciesPayload,
  theme: ThemeName,
  projectRoot?: string
): string {
  const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'media', 'dependency-graph.css'));
  const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'media', 'dependency-graph.js'));
  const graphDataJson = JSON.stringify({ payload, projectRoot, theme }).replace(/</g, '\\u003c');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <link rel="stylesheet" href="${styleUri}" />
  <title>UV Dependency Graph</title>
</head>
<body data-theme="${theme}">
  <main class="graph-shell">
    <header class="graph-header">
      <div>
        <p class="eyebrow">UV lock graph</p>
        <h1>Dependency Graph</h1>
        <p id="graphSubtitle" class="subtitle"></p>
      </div>
      <div class="stats" id="stats"></div>
    </header>

    <section class="controls" aria-label="Graph controls">
      <label class="control-field">
        <span>Search package</span>
        <input id="searchInput" type="search" placeholder="e.g. requests" spellcheck="false" />
      </label>
      <label class="control-field control-small">
        <span>Max edges per node</span>
        <input id="degreeLimitInput" type="number" min="1" max="200" value="30" />
      </label>
      <button id="resetViewButton" type="button" class="btn">Reset view</button>
      <button id="fitViewButton" type="button" class="btn">Fit graph</button>
    </section>

    <section class="graph-panel">
      <canvas id="graphCanvas" aria-label="Dependency graph canvas"></canvas>
      <aside class="inspector" id="inspector">
        <h2>Inspector</h2>
        <p class="hint">Click a node to inspect its direct dependencies and dependents.</p>
        <div id="inspectorContent" class="inspector-content">No package selected.</div>
      </aside>
    </section>
  </main>

  <script id="graphData" type="application/json">${graphDataJson}</script>
  <script src="${scriptUri}"></script>
</body>
</html>`;
}

function getHtmlForWebview(webview: vscode.Webview, extensionUri: vscode.Uri): string {
  const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'media', 'style.css'));
  const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'media', 'script.js'));
  const theme = getCurrentTheme();

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <link rel="stylesheet" href="${styleUri}" />
  <title>UV UI Tool</title>
</head>
<body data-theme="${theme}">
  <div class="app-shell">
    <div class="background-glow background-glow-top"></div>
    <div class="background-glow background-glow-bottom"></div>

    <main class="container">
      <header class="hero">
        <div class="hero-headline">
          <h1>UV UI Tool</h1>
          <button id="openSettingsButton" class="icon-btn" type="button" title="Open settings" aria-label="Open settings">⚙</button>
        </div>
        <div id="settingsMenu" class="settings-menu" hidden>
          <label for="themeSelect" class="settings-label">Theme</label>
          <select id="themeSelect" class="settings-select">
            <option value="sunset">Sunset</option>
            <option value="matte-black">Matte Black</option>
          </select>
        </div>
      </header>

      <section class="status-card">
        <div class="status-meta">
          <span class="status-dot" aria-hidden="true"></span>
          <span class="status-label">Workspace status</span>
        </div>
        <div id="projectStatus" class="status">Detecting UV project...</div>
      </section>

      <section class="command-card">
        <label for="commandInput" class="input-label">Command</label>
        <div class="command-row">
          <input id="commandInput" type="text" placeholder="uv --version" spellcheck="false" />
          <button id="runButton" class="btn btn-primary">Run</button>
        </div>
        <details class="command-library" aria-label="Command menu">
          <summary class="command-library-summary">
            <span class="command-library-title">Popular uv commands</span>
            <span class="command-library-hint">Expand</span>
          </summary>

          <div class="command-library-content">
            <div class="command-group">
              <p class="command-group-title">Project setup</p>
              <div class="command-chips">
                <button type="button" class="chip command-select-btn" data-command="uv --version" title="Check installed uv version">uv --version</button>
                <button type="button" class="chip command-select-btn" data-command="uv sync" title="Sync environment with lockfile">uv sync</button>
                <button type="button" class="chip command-select-btn" data-command="uv lock" title="Regenerate uv.lock">uv lock</button>
                <button type="button" class="chip command-select-btn" data-command="uv tree" title="Show dependency tree">uv tree</button>
              </div>
            </div>

            <div class="command-group">
              <p class="command-group-title">Run and test</p>
              <div class="command-chips">
                <button type="button" class="chip command-select-btn" data-command="uv run python -V" title="Run python from project environment">uv run python -V</button>
                <button type="button" class="chip command-select-btn" data-command="uv run pytest" title="Run tests with uv-managed env">uv run pytest</button>
                <button type="button" class="chip command-select-btn" data-command="uv pip list" title="List installed packages">uv pip list</button>
              </div>
            </div>
          </div>
        </details>
      </section>

      <section class="actions-row">
        <button id="parseDependenciesButton" class="btn btn-secondary">Open dependency graph</button>
      </section>

      <section class="package-card">
        <label for="packageSearchInput" class="input-label">Add packages from PyPI</label>
        <input id="packageSearchInput" type="search" placeholder="Search package names..." spellcheck="false" />
        <p id="packageSearchStatus" class="package-search-status">Type to search PyPI packages.</p>
        <div id="packageResults" class="package-results" aria-live="polite"></div>

        <div class="package-options">
          <label class="package-option">
            <span>Dependency target</span>
            <select id="dependencyTargetSelect" class="settings-select">
              <option value="regular">Regular dependency</option>
              <option value="dev">Dev dependency (--dev)</option>
            </select>
          </label>
          <label class="package-option">
            <span>Version mode</span>
            <select id="versionModeSelect" class="settings-select">
              <option value="latest">Latest</option>
              <option value="custom">Custom specifier</option>
            </select>
          </label>
          <label class="package-option">
            <span>Version specifier</span>
            <input id="versionSpecifierInput" type="text" placeholder="==2.32.3 or >=2.30" spellcheck="false" disabled />
          </label>
        </div>

        <div class="package-actions">
          <button id="prepareAddPackageButton" class="btn btn-secondary">Prepare add command</button>
          <button id="confirmAddPackageButton" class="btn btn-primary" hidden>Confirm and run</button>
        </div>
        <pre id="addPackagePreview" class="package-preview" hidden></pre>
      </section>

      <section class="output-card">
        <div class="output-header">
          <h2>Output</h2>
        </div>
        <div id="output" class="output output-plain">Output from the extension will appear here.</div>
      </section>
    </main>
  </div>
  <script src="${scriptUri}"></script>
</body>
</html>`;
}

function postAppendOutput(
  webview: vscode.Webview | undefined,
  text: string,
  stream: 'command' | 'stdout' | 'stderr' | 'system' = 'stdout'
) {
  if (!text) {
    return;
  }

  webview?.postMessage({ command: 'appendOutput', text, stream });
}

function escapeShellArgForDisplay(value: string): string {
  if (!value) {
    return '""';
  }

  if (!/[\s"]/u.test(value)) {
    return value;
  }

  return `"${value.replace(/"/g, '\\"')}"`;
}

function normalizeDependencyTarget(value: unknown): DependencyTarget {
  return value === 'dev' ? 'dev' : 'regular';
}

function normalizeVersionSpecifier(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return undefined;
  }

  if (/^(==|!=|>=|<=|~=|>|<)/u.test(trimmed)) {
    return trimmed;
  }

  return `==${trimmed}`;
}

function isValidPackageName(name: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9._-]*$/u.test(name);
}

function toPackageSpecifier(packageName: string, versionSpecifier?: string): string {
  return `${packageName}${versionSpecifier ?? ''}`;
}

function buildUvAddArgs(request: PackageAddRequest): string[] {
  const args = ['add'];
  if (request.dependencyTarget === 'dev') {
    args.push('--dev');
  }

  args.push(...request.packageNames.map(name => toPackageSpecifier(name, request.versionSpecifier)));
  return args;
}

function buildUvAddCommandPreview(request: PackageAddRequest): string {
  return ['uv', ...buildUvAddArgs(request)].map(escapeShellArgForDisplay).join(' ');
}

function decodeHtmlEntities(raw: string): string {
  return raw
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, '\'')
    .replace(/&apos;/g, '\'')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#(\d+);/g, (_, digits) => String.fromCharCode(Number(digits)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
}

function parsePyPiSimpleIndexNames(html: string): string[] {
  const names: string[] = [];
  const anchorRegex = /<a\b[^>]*>([^<]+)<\/a>/gu;
  let match: RegExpExecArray | null;
  while ((match = anchorRegex.exec(html)) !== null) {
    const decoded = decodeHtmlEntities(match[1].trim()).toLowerCase();
    if (decoded && isValidPackageName(decoded)) {
      names.push(decoded);
    }
  }

  return Array.from(new Set(names));
}

async function loadPyPiPackageIndex(): Promise<PyPiPackageIndex> {
  if (cachedPyPiPackageIndex && (Date.now() - cachedPyPiPackageIndex.loadedAt) < PYPI_INDEX_CACHE_TTL_MS) {
    return cachedPyPiPackageIndex;
  }

  if (pyPiIndexLoadPromise) {
    return pyPiIndexLoadPromise;
  }

  pyPiIndexLoadPromise = (async () => {
    const response = await fetch('https://pypi.org/simple/', {
      headers: {
        Accept: 'text/html',
        'User-Agent': 'uv-ui-tool-vscode-extension'
      }
    });

    if (!response.ok) {
      throw new Error(`PyPI index returned HTTP ${response.status}`);
    }

    const html = await response.text();
    const names = parsePyPiSimpleIndexNames(html);
    if (names.length === 0) {
      throw new Error('PyPI package index did not contain package names.');
    }

    const index: PyPiPackageIndex = {
      names,
      loadedAt: Date.now()
    };
    cachedPyPiPackageIndex = index;
    return index;
  })();

  try {
    return await pyPiIndexLoadPromise;
  } finally {
    pyPiIndexLoadPromise = undefined;
  }
}

function searchPyPiPackageIndex(names: string[], query: string): PyPiSearchResult[] {
  const resultLimit = 20;
  const matches = names.filter(packageName => packageName.includes(query));
  matches.sort((left, right) => {
    const score = (name: string) => {
      if (name === query) {
        return 0;
      }
      if (name.startsWith(query)) {
        return 1;
      }
      if (name.includes(`-${query}`) || name.includes(`_${query}`) || name.includes(`.${query}`)) {
        return 2;
      }
      return 3;
    };

    const scoreDiff = score(left) - score(right);
    if (scoreDiff !== 0) {
      return scoreDiff;
    }

    const lengthDiff = Math.abs(left.length - query.length) - Math.abs(right.length - query.length);
    if (lengthDiff !== 0) {
      return lengthDiff;
    }

    return left.localeCompare(right);
  });

  return matches.slice(0, resultLimit).map(name => ({ name }));
}

function normalizePackageAddRequest(message: unknown): { request?: PackageAddRequest; error?: string } {
  const payload = (message && typeof message === 'object') ? message as Record<string, unknown> : undefined;
  const namesFromArray = Array.isArray(payload?.packageNames)
    ? payload.packageNames
      .filter((value): value is string => typeof value === 'string')
      .map(value => value.trim())
      .filter(Boolean)
    : [];
  const singlePackageName = typeof payload?.packageName === 'string' ? payload.packageName.trim() : '';
  const packageNames = Array.from(new Set([
    ...namesFromArray,
    ...(singlePackageName ? [singlePackageName] : [])
  ]));

  if (packageNames.length === 0) {
    return { error: 'Please select one or more packages before continuing.' };
  }

  const invalidPackageName = packageNames.find(name => !isValidPackageName(name));
  if (invalidPackageName) {
    return { error: `Invalid package name: ${invalidPackageName}` };
  }

  const request: PackageAddRequest = {
    packageNames,
    dependencyTarget: normalizeDependencyTarget(payload?.dependencyTarget),
    versionSpecifier: normalizeVersionSpecifier(payload?.versionSpecifier)
  };

  return { request };
}

async function searchPyPiPackages(query: string, requestId: number, webview: vscode.Webview) {
  const trimmedQuery = query.trim().toLowerCase();
  if (trimmedQuery.length < 2) {
    webview.postMessage({ command: 'setPyPiSearchResults', requestId, query: trimmedQuery, results: [] });
    return;
  }

  try {
    const index = await loadPyPiPackageIndex();
    const results = searchPyPiPackageIndex(index.names, trimmedQuery);
    webview.postMessage({
      command: 'setPyPiSearchResults',
      requestId,
      query: trimmedQuery,
      results
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'PyPI package search failed.';
    webview.postMessage({
      command: 'setPyPiSearchResults',
      requestId,
      query: trimmedQuery,
      results: [],
      error: `Unable to search PyPI: ${message}`
    });
  }
}

async function prepareAddPackageCommand(message: unknown, webview: vscode.Webview) {
  const normalized = normalizePackageAddRequest(message);
  if (!normalized.request) {
    webview.postMessage({ command: 'showAddPackageConfirmation', error: normalized.error ?? 'Invalid package input.' });
    return;
  }

  webview.postMessage({
    command: 'showAddPackageConfirmation',
    commandText: buildUvAddCommandPreview(normalized.request),
    payload: normalized.request
  });
}

async function runUvAddPackage(message: unknown, webview: vscode.Webview) {
  const normalized = normalizePackageAddRequest(message);
  if (!normalized.request) {
    webview.postMessage({ command: 'showAddPackageConfirmation', error: normalized.error ?? 'Invalid package input.' });
    webview.postMessage({ command: 'packageAddFinished', success: false });
    return;
  }

  const detection = await detectUvProject();
  if (!detection.isUvProject) {
    vscode.window.showErrorMessage('No UV project detected in the current workspace.');
    webview.postMessage({ command: 'setOutput', text: detection.message });
    webview.postMessage({ command: 'packageAddFinished', success: false });
    return;
  }

  const projectRoot = detection.projectRoot ?? vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (!projectRoot) {
    webview.postMessage({ command: 'setOutput', text: 'Unable to determine the project root for command execution.' });
    webview.postMessage({ command: 'packageAddFinished', success: false });
    return;
  }

  const args = buildUvAddArgs(normalized.request);
  const commandPreview = buildUvAddCommandPreview(normalized.request);
  webview.postMessage({ command: 'clearOutput' });
  postAppendOutput(webview, `$ ${commandPreview}\n\n`, 'command');

  await new Promise<void>(resolve => {
    const commandProcess = spawn('uv', args, {
      cwd: projectRoot,
      env: process.env,
      windowsHide: true
    });

    let resolved = false;
    const finalize = () => {
      if (!resolved) {
        resolved = true;
        resolve();
      }
    };

    commandProcess.stdout.on('data', (chunk: Buffer | string) => {
      postAppendOutput(webview, chunk.toString(), 'stdout');
    });

    commandProcess.stderr.on('data', (chunk: Buffer | string) => {
      postAppendOutput(webview, chunk.toString(), 'stderr');
    });

    commandProcess.on('error', error => {
      postAppendOutput(webview, `Failed to run uv add: ${error.message}\n`, 'stderr');
      finalize();
    });

    commandProcess.on('close', (code, signal) => {
      if (signal) {
        postAppendOutput(webview, `\nuv add terminated by signal: ${signal}\n`, 'system');
      } else if (typeof code === 'number' && code !== 0) {
        postAppendOutput(webview, `\nuv add exited with code: ${code}\n`, 'system');
      }

      webview.postMessage({ command: 'packageAddFinished', success: code === 0 });
      finalize();
    });
  });
}

async function runUvCommand(commandText: string, webview?: vscode.Webview) {
  const detection = await detectUvProject();
  if (!detection.isUvProject) {
    vscode.window.showErrorMessage('No UV project detected in the current workspace.');
    webview?.postMessage({ command: 'setOutput', text: detection.message });
    return;
  }

  if (!commandText || !commandText.trim()) {
    vscode.window.showErrorMessage('Please provide a command to run.');
    webview?.postMessage({ command: 'setOutput', text: 'Command was empty.' });
    return;
  }

  const projectRoot = detection.projectRoot ?? vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (!projectRoot) {
    webview?.postMessage({ command: 'setOutput', text: 'Unable to determine the project root for command execution.' });
    return;
  }

  const shell = process.platform === 'win32'
    ? process.env.ComSpec ?? 'cmd.exe'
    : process.env.SHELL ?? '/bin/bash';
  const shellArgs = process.platform === 'win32'
    ? ['/d', '/s', '/c', commandText]
    : ['-lc', commandText];

  webview?.postMessage({ command: 'clearOutput' });
  postAppendOutput(webview, `$ ${commandText}\n\n`, 'command');

  await new Promise<void>(resolve => {
    const commandProcess = spawn(shell, shellArgs, {
      cwd: projectRoot,
      env: process.env,
      windowsHide: true
    });

    let resolved = false;
    const finalize = () => {
      if (!resolved) {
        resolved = true;
        resolve();
      }
    };

    commandProcess.stdout.on('data', (chunk: Buffer | string) => {
      postAppendOutput(webview, chunk.toString(), 'stdout');
    });

    commandProcess.stderr.on('data', (chunk: Buffer | string) => {
      postAppendOutput(webview, chunk.toString(), 'stderr');
    });

    commandProcess.on('error', error => {
      postAppendOutput(webview, `Failed to run command: ${error.message}\n`, 'stderr');
      finalize();
    });

    commandProcess.on('close', (code, signal) => {
      if (signal) {
        postAppendOutput(webview, `\nCommand terminated by signal: ${signal}\n`, 'system');
      } else if (typeof code === 'number' && code !== 0) {
        postAppendOutput(webview, `\nCommand exited with code: ${code}\n`, 'system');
      }

      finalize();
    });
  });

  webview?.postMessage({ command: 'commandFinished' });
}

async function handleWebviewMessage(message: Record<string, unknown>, webview: vscode.Webview, extensionUri: vscode.Uri) {
  switch (message.command) {
    case 'runUvCommand':
      await runUvCommand(typeof message.text === 'string' ? message.text : '', webview);
      break;
    case 'parseDependencies':
      await parseAndSendUvLockDependencies(webview, extensionUri);
      break;
    case 'setTheme':
      await setCurrentTheme(normalizeThemeName(message.theme));
      break;
    case 'searchPyPiPackages':
      await searchPyPiPackages(
        typeof message.query === 'string' ? message.query : '',
        typeof message.requestId === 'number' ? message.requestId : 0,
        webview
      );
      break;
    case 'prepareAddPackageCommand':
      await prepareAddPackageCommand(message, webview);
      break;
    case 'addPackage':
      await runUvAddPackage(message, webview);
      break;
  }
}

class UVPanel {
  public static currentPanel: UVPanel | undefined;
  private readonly panel: vscode.WebviewPanel;
  private readonly extensionUri: vscode.Uri;

  private constructor(panel: vscode.WebviewPanel, extensionUri: vscode.Uri) {
    this.panel = panel;
    this.extensionUri = extensionUri;
    this.setWebviewMessageListener(this.panel.webview);
    this.update();
  }

  public static createOrShow(extensionUri: vscode.Uri) {
    const column = vscode.window.activeTextEditor
      ? vscode.window.activeTextEditor.viewColumn
      : vscode.ViewColumn.One;

    if (UVPanel.currentPanel) {
      UVPanel.currentPanel.panel.reveal(column);
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      'uvUiTool',
      'UV UI Tool',
      column || vscode.ViewColumn.One,
      {
        enableScripts: true,
        localResourceRoots: [vscode.Uri.joinPath(extensionUri, 'media')]
      }
    );

    UVPanel.currentPanel = new UVPanel(panel, extensionUri);

    panel.onDidDispose(() => {
      UVPanel.currentPanel = undefined;
    });
  }

  private update() {
    this.panel.webview.html = getHtmlForWebview(this.panel.webview, this.extensionUri);
    sendTheme(this.panel.webview);
    sendProjectStatus(this.panel.webview);
  }

  public applyTheme(theme: ThemeName) {
    this.panel.webview.postMessage({ command: 'setTheme', theme });
  }

  private setWebviewMessageListener(webview: vscode.Webview) {
    webview.onDidReceiveMessage(async message => {
      if (!message || typeof message !== 'object') {
        return;
      }

      await handleWebviewMessage(message as Record<string, unknown>, webview, this.extensionUri);
    });
  }
}

class UVDependencyGraphPanel {
  public static currentPanel: UVDependencyGraphPanel | undefined;
  private readonly panel: vscode.WebviewPanel;
  private readonly extensionUri: vscode.Uri;

  private constructor(panel: vscode.WebviewPanel, extensionUri: vscode.Uri, payload: UvDependenciesPayload, theme: ThemeName, projectRoot?: string) {
    this.panel = panel;
    this.extensionUri = extensionUri;
    this.update(payload, theme, projectRoot);
  }

  public static createOrShow(extensionUri: vscode.Uri | undefined, payload: UvDependenciesPayload, theme: ThemeName, projectRoot?: string) {
    const resolvedExtensionUri = extensionUri ?? vscode.extensions.getExtension('uv-ui-tool.uv-ui-tool')?.extensionUri;
    if (!resolvedExtensionUri) {
      return;
    }

    const column = vscode.window.activeTextEditor?.viewColumn ?? vscode.ViewColumn.Beside;

    if (UVDependencyGraphPanel.currentPanel) {
      UVDependencyGraphPanel.currentPanel.panel.reveal(column);
      UVDependencyGraphPanel.currentPanel.update(payload, theme, projectRoot);
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      'uvDependencyGraph',
      'UV Dependency Graph',
      vscode.ViewColumn.Beside,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [vscode.Uri.joinPath(resolvedExtensionUri, 'media')]
      }
    );

    UVDependencyGraphPanel.currentPanel = new UVDependencyGraphPanel(panel, resolvedExtensionUri, payload, theme, projectRoot);

    panel.onDidDispose(() => {
      UVDependencyGraphPanel.currentPanel = undefined;
    });
  }

  private update(payload: UvDependenciesPayload, theme: ThemeName, projectRoot?: string) {
    this.panel.webview.html = getHtmlForDependencyGraphWebview(this.panel.webview, this.extensionUri, payload, theme, projectRoot);
  }

  public applyTheme(theme: ThemeName) {
    this.panel.webview.postMessage({ command: 'setTheme', theme });
  }
}

class UVSidebarProvider implements vscode.WebviewViewProvider {
  private currentWebview: vscode.Webview | undefined;

  constructor(private readonly extensionUri: vscode.Uri) {}

  public resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken
  ) {
    console.log('UV UI Tool sidebar view resolved');
    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, 'media')]
    };

    this.currentWebview = webviewView.webview;

    webviewView.webview.html = getHtmlForWebview(webviewView.webview, this.extensionUri);
    this.setWebviewMessageListener(webviewView.webview);
    sendTheme(webviewView.webview);
    sendProjectStatus(webviewView.webview);
  }

  public applyTheme(theme: ThemeName) {
    this.currentWebview?.postMessage({ command: 'setTheme', theme });
  }

  private setWebviewMessageListener(webview: vscode.Webview) {
    webview.onDidReceiveMessage(async message => {
      if (!message || typeof message !== 'object') {
        return;
      }

      await handleWebviewMessage(message as Record<string, unknown>, webview, this.extensionUri);
    });
  }
}

export function deactivate() {}
