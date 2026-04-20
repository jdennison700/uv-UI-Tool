const runButton = document.getElementById('runButton');
const output = document.getElementById('output');

runButton?.addEventListener('click', () => {
  window.parent.postMessage({
    command: 'runUvCommand',
    text: 'uv --version'
  }, '*');
});

window.addEventListener('message', event => {
  const message = event.data;
  if (message.command === 'setOutput') {
    output.textContent = message.text;
  }
});
