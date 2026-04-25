const vscode = acquireVsCodeApi();
const runButton = document.getElementById('runButton');
const parseDependenciesButton = document.getElementById('parseDependenciesButton');
const commandInput = document.getElementById('commandInput');
const output = document.getElementById('output');
const projectStatus = document.getElementById('projectStatus');
const quickCommandButtons = document.querySelectorAll('.chip[data-command]');

const setPlainOutput = text => {
  if (!output) {
    return;
  }

  output.classList.remove('output-dependencies');
  output.classList.add('output-plain');
  output.textContent = text;
};

const appendPlainOutput = text => {
  if (!output) {
    return;
  }

  output.classList.remove('output-dependencies');
  output.classList.add('output-plain');
  output.textContent += text;
  output.scrollTop = output.scrollHeight;
};

const createSummaryStat = (label, value) => {
  const stat = document.createElement('div');
  stat.className = 'deps-stat';

  const labelElement = document.createElement('span');
  labelElement.className = 'deps-stat-label';
  labelElement.textContent = label;

  const valueElement = document.createElement('strong');
  valueElement.className = 'deps-stat-value';
  valueElement.textContent = String(value);

  stat.append(labelElement, valueElement);
  return stat;
};

const setDependenciesOutput = message => {
  if (!output) {
    return;
  }

  const packageCount = Number.isFinite(message.packageCount) ? message.packageCount : 0;
  const edgeCount = Number.isFinite(message.edgeCount) ? message.edgeCount : 0;
  const withoutDependenciesCount = Number.isFinite(message.withoutDependenciesCount)
    ? message.withoutDependenciesCount
    : 0;
  const packages = Array.isArray(message.packages) ? message.packages : [];

  output.classList.remove('output-plain');
  output.classList.add('output-dependencies');
  output.innerHTML = '';

  const summary = document.createElement('div');
  summary.className = 'deps-summary';
  summary.append(
    createSummaryStat('Packages', packageCount),
    createSummaryStat('Direct edges', edgeCount),
    createSummaryStat('No direct deps', withoutDependenciesCount)
  );

  const controls = document.createElement('div');
  controls.className = 'deps-controls';

  const expandAllButton = document.createElement('button');
  expandAllButton.type = 'button';
  expandAllButton.className = 'deps-control';
  expandAllButton.textContent = 'Expand all';

  const collapseAllButton = document.createElement('button');
  collapseAllButton.type = 'button';
  collapseAllButton.className = 'deps-control';
  collapseAllButton.textContent = 'Collapse all';

  controls.append(expandAllButton, collapseAllButton);

  const list = document.createElement('div');
  list.className = 'deps-list';

  packages.forEach((pkg, index) => {
    const details = document.createElement('details');
    details.className = 'deps-item';
    details.open = index < 1;

    const summaryRow = document.createElement('summary');
    summaryRow.className = 'deps-item-summary';

    const title = document.createElement('span');
    title.className = 'deps-item-title';
    title.textContent = pkg.version ? `${pkg.name}==${pkg.version}` : pkg.name;

    const badge = document.createElement('span');
    badge.className = 'deps-item-badge';
    const dependencyCount = Array.isArray(pkg.dependencies) ? pkg.dependencies.length : 0;
    badge.textContent = dependencyCount === 1 ? '1 dependency' : `${dependencyCount} dependencies`;

    summaryRow.append(title, badge);
    details.append(summaryRow);

    const content = document.createElement('div');
    content.className = 'deps-item-content';

    if (dependencyCount === 0) {
      const emptyText = document.createElement('p');
      emptyText.className = 'deps-empty';
      emptyText.textContent = 'No direct dependencies.';
      content.append(emptyText);
    } else {
      const dependencyList = document.createElement('ul');
      dependencyList.className = 'deps-sublist';

      pkg.dependencies.forEach(dependencyName => {
        const dependencyItem = document.createElement('li');
        dependencyItem.textContent = dependencyName;
        dependencyList.append(dependencyItem);
      });

      content.append(dependencyList);
    }

    details.append(content);
    list.append(details);
  });

  expandAllButton.addEventListener('click', () => {
    list.querySelectorAll('details').forEach(item => {
      item.open = true;
    });
  });

  collapseAllButton.addEventListener('click', () => {
    list.querySelectorAll('details').forEach(item => {
      item.open = false;
    });
  });

  output.append(summary, controls, list);
};

const setBusy = (button, isBusy, busyLabel) => {
  if (!button) {
    return;
  }

  if (!button.dataset.defaultText) {
    button.dataset.defaultText = button.textContent ?? '';
  }

  if (isBusy) {
    button.dataset.wasDisabledBeforeBusy = button.disabled ? 'true' : 'false';
    button.disabled = true;
    button.textContent = busyLabel;
    return;
  }

  button.disabled = button.dataset.wasDisabledBeforeBusy === 'true';
  delete button.dataset.wasDisabledBeforeBusy;
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
    setPlainOutput(message.text);
    setBusy(runButton, false, 'Running...');
    setBusy(parseDependenciesButton, false, 'Parsing...');
  }

  if (message.command === 'setDependenciesOutput') {
    setDependenciesOutput(message);
    setBusy(runButton, false, 'Running...');
    setBusy(parseDependenciesButton, false, 'Parsing...');
  }

  if (message.command === 'clearOutput') {
    setPlainOutput('');
  }

  if (message.command === 'appendOutput') {
    appendPlainOutput(message.text ?? '');
  }

  if (message.command === 'commandFinished') {
    setBusy(runButton, false, 'Running...');
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
