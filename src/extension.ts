// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as path from 'path';
import { spawn } from 'child_process';
import * as vscode from 'vscode';

export function activate(context: vscode.ExtensionContext) {
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

      UVDependencyGraphPanel.createOrShow(context.extensionUri, parseResult.payload, parseResult.projectRoot);
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(helloCommand, () => {
      vscode.window.showInformationMessage('Hello World from UV UI Tool!');
    })
  );

  const provider = new UVSidebarProvider(context.extensionUri);
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

  UVDependencyGraphPanel.createOrShow(extensionUri, parseResult.payload, parseResult.projectRoot);
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
  projectRoot?: string
): string {
  const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'media', 'dependency-graph.css'));
  const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'media', 'dependency-graph.js'));
  const graphDataJson = JSON.stringify({ payload, projectRoot }).replace(/</g, '\\u003c');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <link rel="stylesheet" href="${styleUri}" />
  <title>UV Dependency Graph</title>
</head>
<body>
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

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <link rel="stylesheet" href="${styleUri}" />
  <title>UV UI Tool</title>
</head>
<body>
  <div class="app-shell">
    <div class="background-glow background-glow-top"></div>
    <div class="background-glow background-glow-bottom"></div>

    <main class="container">
      <header class="hero">
        <h1>UV UI Tool</h1>
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
    sendProjectStatus(this.panel.webview);
  }

  private setWebviewMessageListener(webview: vscode.Webview) {
    webview.onDidReceiveMessage(async message => {
      switch (message.command) {
        case 'runUvCommand':
          await runUvCommand(message.text, webview);
          break;
        case 'parseDependencies':
          await parseAndSendUvLockDependencies(webview, this.extensionUri);
          break;
      }
    });
  }
}

class UVDependencyGraphPanel {
  public static currentPanel: UVDependencyGraphPanel | undefined;
  private readonly panel: vscode.WebviewPanel;
  private readonly extensionUri: vscode.Uri;

  private constructor(panel: vscode.WebviewPanel, extensionUri: vscode.Uri, payload: UvDependenciesPayload, projectRoot?: string) {
    this.panel = panel;
    this.extensionUri = extensionUri;
    this.update(payload, projectRoot);
  }

  public static createOrShow(extensionUri: vscode.Uri | undefined, payload: UvDependenciesPayload, projectRoot?: string) {
    const resolvedExtensionUri = extensionUri ?? vscode.extensions.getExtension('uv-ui-tool.uv-ui-tool')?.extensionUri;
    if (!resolvedExtensionUri) {
      return;
    }

    const column = vscode.window.activeTextEditor?.viewColumn ?? vscode.ViewColumn.Beside;

    if (UVDependencyGraphPanel.currentPanel) {
      UVDependencyGraphPanel.currentPanel.panel.reveal(column);
      UVDependencyGraphPanel.currentPanel.update(payload, projectRoot);
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

    UVDependencyGraphPanel.currentPanel = new UVDependencyGraphPanel(panel, resolvedExtensionUri, payload, projectRoot);

    panel.onDidDispose(() => {
      UVDependencyGraphPanel.currentPanel = undefined;
    });
  }

  private update(payload: UvDependenciesPayload, projectRoot?: string) {
    this.panel.webview.html = getHtmlForDependencyGraphWebview(this.panel.webview, this.extensionUri, payload, projectRoot);
  }
}

class UVSidebarProvider implements vscode.WebviewViewProvider {
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

    webviewView.webview.html = getHtmlForWebview(webviewView.webview, this.extensionUri);
    this.setWebviewMessageListener(webviewView.webview);
    sendProjectStatus(webviewView.webview);
  }

  private setWebviewMessageListener(webview: vscode.Webview) {
    webview.onDidReceiveMessage(async message => {
      switch (message.command) {
        case 'runUvCommand':
          await runUvCommand(message.text, webview);
          break;
        case 'parseDependencies':
          await parseAndSendUvLockDependencies(webview, this.extensionUri);
          break;
      }
    });
  }
}

export function deactivate() {}
