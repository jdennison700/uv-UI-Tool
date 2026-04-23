const vscode = acquireVsCodeApi();
const runButton = document.getElementById('runButton');
const parseDependenciesButton = document.getElementById('parseDependenciesButton');
const commandInput = document.getElementById('commandInput');
const output = document.getElementById('output');
const projectStatus = document.getElementById('projectStatus');
const quickCommandButtons = document.querySelectorAll('.chip[data-command]');

const setBusy = (button, isBusy, busyLabel) => {
  if (!button) {
    return;
  }

  if (!button.dataset.defaultText) {
    button.dataset.defaultText = button.textContent ?? '';
  }

  if (isBusy) {
    button.disabled = true;
    button.textContent = busyLabel;
    return;
  }

  button.textContent = button.dataset.defaultText;
};

const runCommand = () => {
  const commandText = commandInput?.value?.trim() || 'uv --version';
  setBusy(runButton, true, 'Running...');

  vscode.postMessage({
    command: 'runUvCommand',
    text: commandText
  });
};

runButton?.addEventListener('click', () => {
  runCommand();
});

parseDependenciesButton?.addEventListener('click', () => {
  setBusy(parseDependenciesButton, true, 'Parsing...');
  vscode.postMessage({
    command: 'parseDependencies'
  });
});

commandInput?.addEventListener('keydown', event => {
  if (event.key === 'Enter') {
    event.preventDefault();
    runCommand();
  }
});

quickCommandButtons.forEach(button => {
  button.addEventListener('click', () => {
    const command = button.getAttribute('data-command');
    if (!commandInput || !command) {
      return;
    }

    commandInput.value = command;
    commandInput.focus();
  });
});

window.addEventListener('message', event => {
  const message = event.data;

  if (message.command === 'setOutput') {
    output.textContent = message.text;
    setBusy(runButton, false, 'Running...');
    setBusy(parseDependenciesButton, false, 'Parsing...');
  }

  if (message.command === 'setProjectStatus') {
    projectStatus.textContent = message.message;
    const enabled = message.isUvProject === true;
    if (runButton) {
      runButton.disabled = !enabled;
      setBusy(runButton, false, 'Running...');
    }

    if (parseDependenciesButton) {
      parseDependenciesButton.disabled = !enabled;
      setBusy(parseDependenciesButton, false, 'Parsing...');
    }

    if (commandInput) {
      commandInput.disabled = !enabled;
    }

    quickCommandButtons.forEach(button => {
      button.disabled = !enabled;
    });
  }
});
