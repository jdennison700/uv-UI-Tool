// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as path from 'path';
import { spawn } from 'child_process';
import * as vscode from 'vscode';

export function activate(context: vscode.ExtensionContext) {
  console.log('UV UI Tool activated');
  const openPanelCommand = 'uv-ui-tool.openPanel';
  const openSidebarCommand = 'uv-ui-tool.openSidebar';
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

async function parseAndSendUvLockDependencies(webview: vscode.Webview) {
  const detection = await detectUvProject();
  if (!detection.isUvProject || !detection.projectRoot) {
    webview.postMessage({
      command: 'setOutput',
      text: detection.message
    });
    return;
  }

  const lockFileUri = vscode.Uri.joinPath(vscode.Uri.file(detection.projectRoot), 'uv.lock');
  const hasLock = await uriExists(lockFileUri);
  if (!hasLock) {
    webview.postMessage({
      command: 'setOutput',
      text: `No uv.lock file found in ${detection.projectRoot}.`
    });
    return;
  }

  const rawLockContent = await vscode.workspace.fs.readFile(lockFileUri);
  const lockContent = new TextDecoder('utf-8').decode(rawLockContent);
  const parsedPackages = parseUvLockDependencies(lockContent);
  const payload = buildDependenciesPayload(parsedPackages);

  webview.postMessage({
    command: 'setDependenciesOutput',
    ...payload
  });
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
        <p class="eyebrow">Python Environment</p>
        <h1>UV UI Tool</h1>
        <p class="subtitle">Run UV commands, inspect dependencies, and keep context close at hand.</p>
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
        <div class="quick-actions" aria-label="Quick commands">
          <button type="button" class="chip" data-command="uv --version">Version</button>
          <button type="button" class="chip" data-command="uv sync">Sync</button>
          <button type="button" class="chip" data-command="uv lock">Lock</button>
          <button type="button" class="chip" data-command="uv pip list">Packages</button>
        </div>
      </section>

      <section class="actions-row">
        <button id="parseDependenciesButton" class="btn btn-secondary">Parse uv.lock dependencies</button>
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

function postAppendOutput(webview: vscode.Webview | undefined, text: string) {
  if (!text) {
    return;
  }

  webview?.postMessage({ command: 'appendOutput', text });
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
  postAppendOutput(webview, `$ ${commandText}\n\n`);

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
      postAppendOutput(webview, chunk.toString());
    });

    commandProcess.stderr.on('data', (chunk: Buffer | string) => {
      postAppendOutput(webview, chunk.toString());
    });

    commandProcess.on('error', error => {
      postAppendOutput(webview, `Failed to run command: ${error.message}\n`);
      finalize();
    });

    commandProcess.on('close', (code, signal) => {
      if (signal) {
        postAppendOutput(webview, `\nCommand terminated by signal: ${signal}\n`);
      } else if (typeof code === 'number' && code !== 0) {
        postAppendOutput(webview, `\nCommand exited with code: ${code}\n`);
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
          await parseAndSendUvLockDependencies(webview);
          break;
      }
    });
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
          await parseAndSendUvLockDependencies(webview);
          break;
      }
    });
  }
}

export function deactivate() {}
