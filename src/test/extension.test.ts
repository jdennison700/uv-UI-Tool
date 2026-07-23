import * as assert from 'assert';

import * as vscode from 'vscode';

const EXTENSION_ID = 'jdennison700.uv-ui-tool';
const CONTRIBUTED_COMMANDS = [
  'uv-ui-tool.openPanel',
  'uv-ui-tool.openSidebar',
  'uv-ui-tool.openDependencyGraph'
];

suite('Extension activation', () => {
  test('the extension is installed in the test host', () => {
    assert.ok(vscode.extensions.getExtension(EXTENSION_ID), `${EXTENSION_ID} was not found`);
  });

  test('activating the extension resolves', async () => {
    const extension = vscode.extensions.getExtension(EXTENSION_ID);
    assert.ok(extension);

    await extension.activate();
    assert.strictEqual(extension.isActive, true);
  });

  test('every contributed command is registered', async () => {
    await vscode.extensions.getExtension(EXTENSION_ID)?.activate();
    const registered = await vscode.commands.getCommands(true);

    for (const command of CONTRIBUTED_COMMANDS) {
      assert.ok(registered.includes(command), `${command} was not registered`);
    }
  });

  test('the package manifest and the registered commands agree', () => {
    const contributed = vscode.extensions.getExtension(EXTENSION_ID)?.packageJSON?.contributes?.commands as
      | { command: string }[]
      | undefined;

    assert.deepStrictEqual(contributed?.map(entry => entry.command).sort(), [...CONTRIBUTED_COMMANDS].sort());
  });
});

suite('Extension commands', () => {
  suiteSetup(async () => {
    await vscode.extensions.getExtension(EXTENSION_ID)?.activate();
  });

  test('opening the panel twice reuses the existing panel', async () => {
    await vscode.commands.executeCommand('uv-ui-tool.openPanel');
    await vscode.commands.executeCommand('uv-ui-tool.openPanel');
  });

  test('opening the dependency graph without a uv project does not throw', async () => {
    await vscode.commands.executeCommand('uv-ui-tool.openDependencyGraph');
  });

  teardown(async () => {
    await vscode.commands.executeCommand('workbench.action.closeAllEditors');
  });
});
