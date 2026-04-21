const vscode = acquireVsCodeApi();
const runButton = document.getElementById('runButton');
const commandInput = document.getElementById('commandInput');
const output = document.getElementById('output');

runButton?.addEventListener('click', () => {
  const commandText = commandInput?.value?.trim() || 'uv --version';

  vscode.postMessage({
    command: 'runUvCommand',
    text: commandText
  });
});

window.addEventListener('message', event => {
  const message = event.data;
  if (message.command === 'setOutput') {
    output.textContent = message.text;
  }
});
