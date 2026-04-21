// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
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
  <div class="container">
    <h1>UV UI Tool</h1>
    <p>Send a shell command to the user's machine and run it in an integrated terminal.</p>
    <input id="commandInput" type="text" placeholder="uv --version" />
    <button id="runButton">Run UV command</button>
    <div id="output" class="output">Output from the extension will appear here.</div>
  </div>
  <script src="${scriptUri}"></script>
</body>
</html>`;
}

let uvUiToolTerminal: vscode.Terminal | undefined;

function runUvCommand(commandText: string, webview?: vscode.Webview) {
  if (!commandText || !commandText.trim()) {
    vscode.window.showErrorMessage('Please provide a command to run.');
    webview?.postMessage({ command: 'setOutput', text: 'Command was empty.' });
    return;
  }

  if (!uvUiToolTerminal) {
    uvUiToolTerminal = vscode.window.createTerminal({
      name: 'UV UI Tool',
      cwd: vscode.workspace.workspaceFolders?.[0]?.uri.fsPath
    });

    vscode.window.onDidCloseTerminal(closedTerminal => {
      if (closedTerminal === uvUiToolTerminal) {
        uvUiToolTerminal = undefined;
      }
    });
  }

  uvUiToolTerminal.show(true);
  uvUiToolTerminal.sendText(commandText, true);
  webview?.postMessage({ command: 'setOutput', text: `Running command in terminal: ${commandText}` });
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
  }

  private setWebviewMessageListener(webview: vscode.Webview) {
    webview.onDidReceiveMessage(message => {
      switch (message.command) {
        case 'runUvCommand':
          runUvCommand(message.text, webview);
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
  }

  private setWebviewMessageListener(webview: vscode.Webview) {
    webview.onDidReceiveMessage(message => {
      switch (message.command) {
        case 'runUvCommand':
          runUvCommand(message.text, webview);
          break;
      }
    });
  }
}

export function deactivate() {}
