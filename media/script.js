const vscode = acquireVsCodeApi();
const runButton = document.getElementById('runButton');
const output = document.getElementById('output');

runButton?.addEventListener('click', () => {
  vscode.postMessage({
    command: 'runUvCommand',
    text: 'uv --version'
  });
});

window.addEventListener('message', event => {
  const message = event.data;
  if (message.command === 'setOutput') {
    output.textContent = message.text;
  }
});
