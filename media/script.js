const vscode = acquireVsCodeApi();
const runButton = document.getElementById('runButton');
const parseDependenciesButton = document.getElementById('parseDependenciesButton');
const commandInput = document.getElementById('commandInput');
const output = document.getElementById('output');
const projectStatus = document.getElementById('projectStatus');
const commandSelectButtons = document.querySelectorAll('.command-select-btn[data-command]');
const openSettingsButton = document.getElementById('openSettingsButton');
const settingsMenu = document.getElementById('settingsMenu');
const themeSelect = document.getElementById('themeSelect');
const packageSearchInput = document.getElementById('packageSearchInput');
const packageSearchStatus = document.getElementById('packageSearchStatus');
const packageResults = document.getElementById('packageResults');
const dependencyTargetSelect = document.getElementById('dependencyTargetSelect');
const versionModeSelect = document.getElementById('versionModeSelect');
const versionSpecifierInput = document.getElementById('versionSpecifierInput');
const prepareAddPackageButton = document.getElementById('prepareAddPackageButton');
const confirmAddPackageButton = document.getElementById('confirmAddPackageButton');
const addPackagePreview = document.getElementById('addPackagePreview');

let searchDebounceHandle;
let latestSearchRequestId = 0;
const selectedPackageNames = new Set();
let isUvProject = false;
let pendingAddPayload;

const applyTheme = theme => {
  const resolvedTheme = theme === 'matte-black' ? 'matte-black' : 'sunset';
  document.body?.setAttribute('data-theme', resolvedTheme);
  if (themeSelect && themeSelect.value !== resolvedTheme) {
    themeSelect.value = resolvedTheme;
  }
};

const appendTerminalChunk = (text, stream = 'stdout') => {
  if (!output || !text) {
    return;
  }

  const chunk = document.createElement('span');
  chunk.className = `terminal-chunk terminal-${stream}`;
  chunk.textContent = text;
  output.append(chunk);
  output.scrollTop = output.scrollHeight;
};

const setPlainOutput = (text, stream = 'system') => {
  if (!output) {
    return;
  }

  output.classList.remove('output-dependencies');
  output.classList.add('output-plain', 'output-terminal');
  output.innerHTML = '';
  appendTerminalChunk(text, stream);
};

const appendPlainOutput = (text, stream = 'stdout') => {
  if (!output) {
    return;
  }

  output.classList.remove('output-dependencies');
  output.classList.add('output-plain', 'output-terminal');
  appendTerminalChunk(text, stream);
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
  output.classList.remove('output-terminal');
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

  if (!Object.prototype.hasOwnProperty.call(button.dataset, 'wasDisabledBeforeBusy')) {
    button.textContent = button.dataset.defaultText;
    return;
  }

  button.disabled = button.dataset.wasDisabledBeforeBusy === 'true';
  delete button.dataset.wasDisabledBeforeBusy;
  button.textContent = button.dataset.defaultText;
};

const clearPackageConfirmation = () => {
  pendingAddPayload = undefined;
  if (addPackagePreview) {
    addPackagePreview.hidden = true;
    addPackagePreview.textContent = '';
  }
  if (confirmAddPackageButton) {
    confirmAddPackageButton.hidden = true;
    confirmAddPackageButton.disabled = true;
  }
};

const getSelectedPackageNames = () => Array.from(selectedPackageNames);

const getVersionSpecifier = () => {
  const isCustom = versionModeSelect?.value === 'custom';
  if (!isCustom) {
    return '';
  }

  return versionSpecifierInput?.value?.trim() ?? '';
};

const renderPackageResults = results => {
  if (!packageResults) {
    return;
  }

  packageResults.innerHTML = '';

  if (!Array.isArray(results) || results.length === 0) {
    return;
  }

  results.forEach(result => {
    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'package-result';
    row.dataset.packageName = result.name;

    if (selectedPackageNames.has(result.name)) {
      row.classList.add('selected');
    }

    const title = document.createElement('span');
    title.className = 'package-result-name';
    title.textContent = result.version ? `${result.name} (${result.version})` : result.name;

    const summary = document.createElement('span');
    summary.className = 'package-result-summary';
    summary.textContent = result.summary || 'No description provided.';

    row.append(title, summary);
    row.addEventListener('click', () => {
      if (selectedPackageNames.has(result.name)) {
        selectedPackageNames.delete(result.name);
      } else {
        selectedPackageNames.add(result.name);
      }
      clearPackageConfirmation();
      renderPackageResults(results);
      if (packageSearchStatus) {
        const selectedCount = selectedPackageNames.size;
        packageSearchStatus.textContent = selectedCount > 0
          ? `${selectedCount} package${selectedCount === 1 ? '' : 's'} selected.`
          : 'Selection cleared. Keep searching to select packages.';
      }
    });

    packageResults.append(row);
  });
};

const runCommand = () => {
  const commandText = commandInput?.value?.trim() || 'uv --version';
  setBusy(runButton, true, 'Running...');

  vscode.postMessage({
    command: 'runUvCommand',
    text: commandText
  });
};

const queuePackageSearch = () => {
  clearTimeout(searchDebounceHandle);
  clearPackageConfirmation();
  const query = packageSearchInput?.value?.trim() ?? '';

  if (!query) {
    if (packageSearchStatus) {
      packageSearchStatus.textContent = 'Type to search PyPI packages.';
    }
    renderPackageResults([]);
    return;
  }

  searchDebounceHandle = setTimeout(() => {
    latestSearchRequestId += 1;
    const requestId = latestSearchRequestId;
    if (packageSearchStatus) {
      packageSearchStatus.textContent = 'Searching PyPI...';
    }
    vscode.postMessage({
      command: 'searchPyPiPackages',
      query,
      requestId
    });
  }, 250);
};

const prepareAddPackage = () => {
  const packageNames = getSelectedPackageNames();
  const fallbackPackageName = packageSearchInput?.value?.trim();
  const dependencyTarget = dependencyTargetSelect?.value === 'dev' ? 'dev' : 'regular';
  const versionSpecifier = getVersionSpecifier();

  if (packageNames.length === 0 && !fallbackPackageName) {
    if (packageSearchStatus) {
      packageSearchStatus.textContent = 'Select one or more packages before preparing the command.';
    }
    return;
  }

  if (versionModeSelect?.value === 'custom' && !versionSpecifier) {
    if (packageSearchStatus) {
      packageSearchStatus.textContent = 'Enter a version specifier (for example: ==2.32.3 or >=1.2).';
    }
    return;
  }

  setBusy(prepareAddPackageButton, true, 'Preparing...');
  vscode.postMessage({
    command: 'prepareAddPackageCommand',
    packageNames,
    packageName: fallbackPackageName,
    dependencyTarget,
    versionSpecifier
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

commandSelectButtons.forEach(button => {
  button.addEventListener('click', () => {
    const command = button.getAttribute('data-command');
    if (!commandInput || !command) {
      return;
    }

    commandInput.value = command;
    commandInput.focus();
  });
});

packageSearchInput?.addEventListener('input', () => {
  queuePackageSearch();
});

dependencyTargetSelect?.addEventListener('change', () => {
  clearPackageConfirmation();
});

versionModeSelect?.addEventListener('change', () => {
  clearPackageConfirmation();
  const customMode = versionModeSelect.value === 'custom';
  if (versionSpecifierInput) {
    versionSpecifierInput.disabled = !customMode;
    if (!customMode) {
      versionSpecifierInput.value = '';
    } else {
      versionSpecifierInput.focus();
    }
  }
});

versionSpecifierInput?.addEventListener('input', () => {
  clearPackageConfirmation();
});

prepareAddPackageButton?.addEventListener('click', () => {
  prepareAddPackage();
});

confirmAddPackageButton?.addEventListener('click', () => {
  if (!pendingAddPayload) {
    return;
  }

  setBusy(confirmAddPackageButton, true, 'Adding...');
  vscode.postMessage({
    command: 'addPackage',
    ...pendingAddPayload
  });
});

openSettingsButton?.addEventListener('click', event => {
  event.stopPropagation();
  if (!settingsMenu) {
    return;
  }

  settingsMenu.hidden = !settingsMenu.hidden;
});

document.addEventListener('click', event => {
  if (!settingsMenu || settingsMenu.hidden) {
    return;
  }

  if (settingsMenu.contains(event.target) || openSettingsButton?.contains(event.target)) {
    return;
  }

  settingsMenu.hidden = true;
});

themeSelect?.addEventListener('change', () => {
  const selectedTheme = themeSelect.value === 'matte-black' ? 'matte-black' : 'sunset';
  applyTheme(selectedTheme);
  vscode.postMessage({
    command: 'setTheme',
    theme: selectedTheme
  });
});

window.addEventListener('message', event => {
  const message = event.data;

  if (message.command === 'setOutput') {
    setPlainOutput(message.text, 'system');
    setBusy(runButton, false, 'Running...');
    setBusy(parseDependenciesButton, false, 'Parsing...');
  }

  if (message.command === 'setDependenciesOutput') {
    setDependenciesOutput(message);
    setBusy(runButton, false, 'Running...');
    setBusy(parseDependenciesButton, false, 'Parsing...');
  }

  if (message.command === 'clearOutput') {
    setPlainOutput('', 'system');
  }

  if (message.command === 'appendOutput') {
    appendPlainOutput(message.text ?? '', message.stream ?? 'stdout');
  }

  if (message.command === 'commandFinished') {
    setBusy(runButton, false, 'Running...');
    setBusy(parseDependenciesButton, false, 'Parsing...');
  }

  if (message.command === 'parseFinished') {
    setBusy(parseDependenciesButton, false, 'Parsing...');
  }

  if (message.command === 'setPyPiSearchResults') {
    if (message.requestId !== latestSearchRequestId) {
      return;
    }

    if (!isUvProject) {
      return;
    }

    if (message.error) {
      renderPackageResults([]);
      if (packageSearchStatus) {
        packageSearchStatus.textContent = message.error;
      }
      return;
    }

    renderPackageResults(message.results);
    const resultsCount = Array.isArray(message.results) ? message.results.length : 0;
    const selectedCount = selectedPackageNames.size;
    if (packageSearchStatus) {
      if (resultsCount === 0) {
        packageSearchStatus.textContent = selectedCount > 0
          ? `No matches. ${selectedCount} package${selectedCount === 1 ? '' : 's'} selected.`
          : 'No packages found for this query.';
      } else {
        packageSearchStatus.textContent = selectedCount > 0
          ? `Found ${resultsCount} packages. ${selectedCount} selected.`
          : `Found ${resultsCount} package${resultsCount === 1 ? '' : 's'}. Select packages to continue.`;
      }
    }
  }

  if (message.command === 'showAddPackageConfirmation') {
    setBusy(prepareAddPackageButton, false, 'Preparing...');
    if (message.error) {
      clearPackageConfirmation();
      if (packageSearchStatus) {
        packageSearchStatus.textContent = message.error;
      }
      return;
    }

    pendingAddPayload = message.payload;
    if (addPackagePreview) {
      addPackagePreview.hidden = false;
      addPackagePreview.textContent = message.commandText;
    }
    if (confirmAddPackageButton) {
      confirmAddPackageButton.hidden = false;
      confirmAddPackageButton.disabled = false;
    }
    if (packageSearchStatus) {
      packageSearchStatus.textContent = 'Review the command, then confirm to run uv add.';
    }
  }

  if (message.command === 'packageAddFinished') {
    setBusy(confirmAddPackageButton, false, 'Adding...');
    if (!message.success) {
      return;
    }

    clearPackageConfirmation();
    if (packageSearchStatus) {
      packageSearchStatus.textContent = 'Packages added successfully.';
    }
  }

  if (message.command === 'setProjectStatus') {
    projectStatus.textContent = message.message;
    isUvProject = message.isUvProject === true;
    if (runButton) {
      runButton.disabled = !isUvProject;
      setBusy(runButton, false, 'Running...');
    }

    if (parseDependenciesButton) {
      parseDependenciesButton.disabled = !isUvProject;
      setBusy(parseDependenciesButton, false, 'Parsing...');
    }

    if (commandInput) {
      commandInput.disabled = !isUvProject;
    }

    if (packageSearchInput) {
      packageSearchInput.disabled = !isUvProject;
      if (!isUvProject) {
        packageSearchInput.value = '';
      }
    }

    if (dependencyTargetSelect) {
      dependencyTargetSelect.disabled = !isUvProject;
    }

    if (versionModeSelect) {
      versionModeSelect.disabled = !isUvProject;
    }

    if (versionSpecifierInput) {
      versionSpecifierInput.disabled = !isUvProject || versionModeSelect?.value !== 'custom';
      if (!isUvProject) {
        versionSpecifierInput.value = '';
      }
    }

    if (prepareAddPackageButton) {
      prepareAddPackageButton.disabled = !isUvProject;
      setBusy(prepareAddPackageButton, false, 'Preparing...');
    }

    if (!isUvProject) {
      selectedPackageNames.clear();
      renderPackageResults([]);
      clearPackageConfirmation();
      if (packageSearchStatus) {
        packageSearchStatus.textContent = 'Open a uv project to search and add packages.';
      }
    } else if (packageSearchStatus && !packageSearchInput?.value.trim()) {
      packageSearchStatus.textContent = 'Type to search PyPI packages.';
    }

    commandSelectButtons.forEach(button => {
      button.disabled = !isUvProject;
    });
  }

  if (message.command === 'setTheme') {
    applyTheme(message.theme);
  }
});
