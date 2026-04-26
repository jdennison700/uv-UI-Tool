const graphDataEl = document.getElementById('graphData');
const statsEl = document.getElementById('stats');
const subtitleEl = document.getElementById('graphSubtitle');
const searchInput = document.getElementById('searchInput');
const degreeLimitInput = document.getElementById('degreeLimitInput');
const resetViewButton = document.getElementById('resetViewButton');
const fitViewButton = document.getElementById('fitViewButton');
const inspectorContent = document.getElementById('inspectorContent');
const canvas = document.getElementById('graphCanvas');

const state = {
  graph: null,
  selectedNodeId: null,
  hoverNodeId: null,
  panX: 0,
  panY: 0,
  scale: 1,
  isPanning: false,
  pointerDown: false,
  pointerStartX: 0,
  pointerStartY: 0,
  panStartX: 0,
  panStartY: 0,
  pixelRatio: Math.max(1, window.devicePixelRatio || 1),
  width: 0,
  height: 0,
  maxEdgesPerNode: 30,
  searchTerm: ''
};

let palette = {
  edge: 'rgba(217, 71, 31, 0.18)',
  edgeStrong: 'rgba(217, 71, 31, 0.68)',
  nodePrimary: '#f06a3e',
  nodeSecondary: '#f59e0b',
  nodeRelated: '#d9471f',
  nodeSelected: '#b45309',
  label: '#1e293b'
};

const refreshPalette = () => {
  const source = document.body || document.documentElement;
  const cssValue = name => getComputedStyle(source).getPropertyValue(name).trim();
  palette = {
    edge: cssValue('--edge') || 'rgba(217, 71, 31, 0.18)',
    edgeStrong: cssValue('--edge-strong') || 'rgba(217, 71, 31, 0.68)',
    nodePrimary: cssValue('--node-primary') || '#f06a3e',
    nodeSecondary: cssValue('--node-secondary') || '#f59e0b',
    nodeRelated: cssValue('--node-related') || '#d9471f',
    nodeSelected: cssValue('--node-selected') || '#b45309',
    label: cssValue('--text') || '#1e293b'
  };
};

const applyTheme = theme => {
  const resolvedTheme = theme === 'matte-black' ? 'matte-black' : 'sunset';
  document.body?.setAttribute('data-theme', resolvedTheme);
  refreshPalette();
  draw();
};

const readData = () => {
  if (!graphDataEl?.textContent) {
    return { payload: { packageCount: 0, edgeCount: 0, withoutDependenciesCount: 0, packages: [] } };
  }

  try {
    return JSON.parse(graphDataEl.textContent);
  } catch {
    return { payload: { packageCount: 0, edgeCount: 0, withoutDependenciesCount: 0, packages: [] } };
  }
};

const makeStat = (label, value) => {
  const box = document.createElement('div');
  box.className = 'stat';

  const statLabel = document.createElement('span');
  statLabel.className = 'stat-label';
  statLabel.textContent = label;

  const statValue = document.createElement('strong');
  statValue.className = 'stat-value';
  statValue.textContent = String(value);

  box.append(statLabel, statValue);
  return box;
};

const buildGraph = payload => {
  const nodeById = new Map();
  const edges = [];

  payload.packages.forEach(pkg => {
    const id = pkg.name;
    if (!nodeById.has(id)) {
      nodeById.set(id, {
        id,
        version: pkg.version || null,
        dependencies: new Set(),
        dependents: new Set(),
        x: 0,
        y: 0,
        vx: 0,
        vy: 0,
        radius: 4.2,
        isPrimaryPackage: true,
        visible: true
      });
    }
  });

  payload.packages.forEach(pkg => {
    const source = nodeById.get(pkg.name);
    if (!source) {
      return;
    }

    pkg.dependencies.forEach(depName => {
      if (!nodeById.has(depName)) {
        nodeById.set(depName, {
          id: depName,
          version: null,
          dependencies: new Set(),
          dependents: new Set(),
          x: 0,
          y: 0,
          vx: 0,
          vy: 0,
          radius: 4.2,
          isPrimaryPackage: false,
          visible: true
        });
      }

      const target = nodeById.get(depName);
      source.dependencies.add(depName);
      target.dependents.add(pkg.name);
      edges.push({ source: pkg.name, target: depName, visible: true });
    });
  });

  const nodes = Array.from(nodeById.values());
  const nodeCount = Math.max(1, nodes.length);
  const radiusSeed = Math.max(120, Math.sqrt(nodeCount) * 25);

  nodes.forEach((node, index) => {
    const angle = (Math.PI * 2 * index) / nodeCount;
    node.x = Math.cos(angle) * radiusSeed + (Math.random() - 0.5) * 14;
    node.y = Math.sin(angle) * radiusSeed + (Math.random() - 0.5) * 14;
    const degree = node.dependencies.size + node.dependents.size;
    node.radius = 3.8 + Math.min(10, Math.sqrt(Math.max(1, degree)) * 1.8);
  });

  return { nodes, edges, nodeById };
};

const runLayout = graph => {
  const nodes = graph.nodes;
  const edges = graph.edges;
  const iterations = 220;
  const repulsion = 1350;
  const springStrength = 0.02;
  const springLength = 85;
  const centering = 0.006;

  for (let step = 0; step < iterations; step += 1) {
    for (let i = 0; i < nodes.length; i += 1) {
      const a = nodes[i];
      for (let j = i + 1; j < nodes.length; j += 1) {
        const b = nodes[j];
        const dx = a.x - b.x;
        const dy = a.y - b.y;
        const distSq = Math.max(8, dx * dx + dy * dy);
        const force = repulsion / distSq;
        const fx = (dx / Math.sqrt(distSq)) * force;
        const fy = (dy / Math.sqrt(distSq)) * force;
        a.vx += fx;
        a.vy += fy;
        b.vx -= fx;
        b.vy -= fy;
      }
    }

    edges.forEach(edge => {
      const source = graph.nodeById.get(edge.source);
      const target = graph.nodeById.get(edge.target);
      if (!source || !target) {
        return;
      }

      const dx = target.x - source.x;
      const dy = target.y - source.y;
      const distance = Math.max(1, Math.sqrt(dx * dx + dy * dy));
      const delta = distance - springLength;
      const force = springStrength * delta;
      const fx = (dx / distance) * force;
      const fy = (dy / distance) * force;
      source.vx += fx;
      source.vy += fy;
      target.vx -= fx;
      target.vy -= fy;
    });

    nodes.forEach(node => {
      node.vx += -node.x * centering;
      node.vy += -node.y * centering;
      node.vx *= 0.84;
      node.vy *= 0.84;
      node.x += node.vx;
      node.y += node.vy;
    });
  }
};

const worldToScreen = (x, y) => {
  const sx = state.width / 2 + (x + state.panX) * state.scale;
  const sy = state.height / 2 + (y + state.panY) * state.scale;
  return { x: sx, y: sy };
};

const screenToWorld = (x, y) => {
  const wx = (x - state.width / 2) / state.scale - state.panX;
  const wy = (y - state.height / 2) / state.scale - state.panY;
  return { x: wx, y: wy };
};

const edgeVisible = edge => {
  const source = state.graph.nodeById.get(edge.source);
  const target = state.graph.nodeById.get(edge.target);
  return Boolean(source?.visible && target?.visible && edge.visible);
};

const draw = () => {
  if (!canvas || !state.graph) {
    return;
  }

  const ctx = canvas.getContext('2d');
  if (!ctx) {
    return;
  }

  ctx.clearRect(0, 0, state.width, state.height);

  ctx.save();
  ctx.globalAlpha = 1;
  ctx.lineWidth = 1;

  state.graph.edges.forEach(edge => {
    if (!edgeVisible(edge)) {
      return;
    }

    const source = state.graph.nodeById.get(edge.source);
    const target = state.graph.nodeById.get(edge.target);
    if (!source || !target) {
      return;
    }

    const from = worldToScreen(source.x, source.y);
    const to = worldToScreen(target.x, target.y);
    const highlight = state.selectedNodeId && (edge.source === state.selectedNodeId || edge.target === state.selectedNodeId);

    ctx.strokeStyle = highlight ? palette.edgeStrong : palette.edge;
    ctx.beginPath();
    ctx.moveTo(from.x, from.y);
    ctx.lineTo(to.x, to.y);
    ctx.stroke();
  });

  const sortedNodes = [...state.graph.nodes].sort((a, b) => a.radius - b.radius);
  sortedNodes.forEach(node => {
    if (!node.visible) {
      return;
    }

    const position = worldToScreen(node.x, node.y);
    const isSelected = state.selectedNodeId === node.id;
    const isHovered = state.hoverNodeId === node.id;
    const isRelated = state.selectedNodeId && !isSelected
      ? state.graph.nodeById.get(state.selectedNodeId)?.dependencies.has(node.id)
        || state.graph.nodeById.get(state.selectedNodeId)?.dependents.has(node.id)
      : false;

    ctx.beginPath();
    ctx.arc(position.x, position.y, Math.max(3, node.radius * state.scale * 0.24), 0, Math.PI * 2);
    ctx.fillStyle = isSelected
      ? palette.nodeSelected
      : isRelated
        ? palette.nodeRelated
        : node.isPrimaryPackage
          ? palette.nodePrimary
          : palette.nodeSecondary;
    ctx.fill();

    if (isSelected || isHovered) {
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.85)';
      ctx.lineWidth = 1.4;
      ctx.stroke();
    }

    if (isSelected || (state.scale > 1.35 && node.radius >= 5) || isHovered) {
      ctx.font = '12px Segoe UI';
      ctx.fillStyle = palette.label;
      ctx.fillText(node.id, position.x + 6, position.y - 6);
    }
  });

  ctx.restore();
};

const fitGraph = () => {
  if (!state.graph || state.graph.nodes.length === 0) {
    return;
  }

  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;

  state.graph.nodes.forEach(node => {
    if (!node.visible) {
      return;
    }

    minX = Math.min(minX, node.x);
    minY = Math.min(minY, node.y);
    maxX = Math.max(maxX, node.x);
    maxY = Math.max(maxY, node.y);
  });

  if (!Number.isFinite(minX)) {
    return;
  }

  const graphWidth = Math.max(120, maxX - minX);
  const graphHeight = Math.max(120, maxY - minY);
  const padding = 80;

  const scaleX = (state.width - padding) / graphWidth;
  const scaleY = (state.height - padding) / graphHeight;

  state.scale = Math.max(0.35, Math.min(2.6, Math.min(scaleX, scaleY)));
  const centerX = (minX + maxX) / 2;
  const centerY = (minY + maxY) / 2;
  state.panX = -centerX;
  state.panY = -centerY;
};

const resizeCanvas = () => {
  if (!canvas) {
    return;
  }

  const rect = canvas.getBoundingClientRect();
  state.width = Math.max(10, Math.floor(rect.width));
  state.height = Math.max(10, Math.floor(rect.height));

  canvas.width = Math.floor(state.width * state.pixelRatio);
  canvas.height = Math.floor(state.height * state.pixelRatio);

  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.setTransform(state.pixelRatio, 0, 0, state.pixelRatio, 0, 0);
  }

  draw();
};

const getNodeAtScreenPoint = (screenX, screenY) => {
  if (!state.graph) {
    return null;
  }

  let best = null;
  let bestDistance = Number.POSITIVE_INFINITY;

  state.graph.nodes.forEach(node => {
    if (!node.visible) {
      return;
    }

    const position = worldToScreen(node.x, node.y);
    const radius = Math.max(6, node.radius * state.scale * 0.24 + 4);
    const dx = position.x - screenX;
    const dy = position.y - screenY;
    const distance = Math.sqrt(dx * dx + dy * dy);

    if (distance <= radius && distance < bestDistance) {
      best = node;
      bestDistance = distance;
    }
  });

  return best;
};

const updateInspector = () => {
  if (!state.graph || !inspectorContent) {
    return;
  }

  if (!state.selectedNodeId) {
    inspectorContent.textContent = 'No package selected.';
    return;
  }

  const node = state.graph.nodeById.get(state.selectedNodeId);
  if (!node) {
    inspectorContent.textContent = 'No package selected.';
    return;
  }

  const dependencies = Array.from(node.dependencies).sort();
  const dependents = Array.from(node.dependents).sort();

  inspectorContent.innerHTML = '';

  const title = document.createElement('h3');
  title.textContent = node.version ? `${node.id}==${node.version}` : node.id;

  const meta = document.createElement('p');
  meta.className = 'meta';
  meta.textContent = `${dependencies.length} direct dependencies, ${dependents.length} direct dependents`;

  inspectorContent.append(title, meta);

  const depsTitle = document.createElement('p');
  depsTitle.className = 'section-title';
  depsTitle.textContent = 'Dependencies';
  inspectorContent.append(depsTitle);

  if (dependencies.length === 0) {
    const emptyDeps = document.createElement('p');
    emptyDeps.className = 'empty-note';
    emptyDeps.textContent = 'No direct dependencies.';
    inspectorContent.append(emptyDeps);
  } else {
    const depsList = document.createElement('ul');
    depsList.className = 'pkg-list';
    dependencies.forEach(dep => {
      const item = document.createElement('li');
      item.textContent = dep;
      depsList.append(item);
    });
    inspectorContent.append(depsList);
  }

  const dependentsTitle = document.createElement('p');
  dependentsTitle.className = 'section-title';
  dependentsTitle.textContent = 'Dependents';
  inspectorContent.append(dependentsTitle);

  if (dependents.length === 0) {
    const emptyDependents = document.createElement('p');
    emptyDependents.className = 'empty-note';
    emptyDependents.textContent = 'No package directly depends on this node.';
    inspectorContent.append(emptyDependents);
  } else {
    const dependentsList = document.createElement('ul');
    dependentsList.className = 'pkg-list';
    dependents.forEach(dep => {
      const item = document.createElement('li');
      item.textContent = dep;
      dependentsList.append(item);
    });
    inspectorContent.append(dependentsList);
  }
};

const applyFilters = () => {
  if (!state.graph) {
    return;
  }

  const term = state.searchTerm.toLowerCase();
  const maxEdges = state.maxEdgesPerNode;

  state.graph.nodes.forEach(node => {
    const degree = node.dependencies.size + node.dependents.size;
    const matchesSearch = term.length === 0 || node.id.toLowerCase().includes(term);
    const withinDegree = degree <= maxEdges;
    node.visible = matchesSearch && withinDegree;
  });

  state.graph.edges.forEach(edge => {
    const source = state.graph.nodeById.get(edge.source);
    const target = state.graph.nodeById.get(edge.target);
    edge.visible = Boolean(source?.visible && target?.visible);
  });

  if (state.selectedNodeId && !state.graph.nodeById.get(state.selectedNodeId)?.visible) {
    state.selectedNodeId = null;
  }

  updateInspector();
  fitGraph();
  draw();
};

const updateStats = payload => {
  if (!statsEl) {
    return;
  }

  statsEl.innerHTML = '';
  statsEl.append(
    makeStat('Packages', payload.packageCount),
    makeStat('Edges', payload.edgeCount),
    makeStat('No deps', payload.withoutDependenciesCount)
  );
};

const wireEvents = () => {
  if (!canvas) {
    return;
  }

  canvas.addEventListener('pointerdown', event => {
    state.pointerDown = true;
    state.isPanning = false;
    state.pointerStartX = event.offsetX;
    state.pointerStartY = event.offsetY;
    state.panStartX = state.panX;
    state.panStartY = state.panY;
    canvas.setPointerCapture(event.pointerId);
  });

  canvas.addEventListener('pointermove', event => {
    if (state.pointerDown) {
      const dx = (event.offsetX - state.pointerStartX) / state.scale;
      const dy = (event.offsetY - state.pointerStartY) / state.scale;

      if (Math.abs(dx) + Math.abs(dy) > 1.4) {
        state.isPanning = true;
      }

      if (state.isPanning) {
        state.panX = state.panStartX + dx;
        state.panY = state.panStartY + dy;
        draw();
      }
      return;
    }

    const hoveredNode = getNodeAtScreenPoint(event.offsetX, event.offsetY);
    state.hoverNodeId = hoveredNode?.id || null;
    canvas.style.cursor = hoveredNode ? 'pointer' : 'grab';
    draw();
  });

  canvas.addEventListener('pointerup', event => {
    canvas.releasePointerCapture(event.pointerId);
    const wasPanning = state.isPanning;
    state.pointerDown = false;
    state.isPanning = false;

    if (wasPanning) {
      return;
    }

    const node = getNodeAtScreenPoint(event.offsetX, event.offsetY);
    state.selectedNodeId = node?.id || null;
    updateInspector();
    draw();
  });

  canvas.addEventListener('wheel', event => {
    event.preventDefault();

    const zoomDelta = event.deltaY < 0 ? 1.1 : 0.9;
    const nextScale = Math.max(0.25, Math.min(3.2, state.scale * zoomDelta));
    const pointerBefore = screenToWorld(event.offsetX, event.offsetY);

    state.scale = nextScale;

    const pointerAfter = screenToWorld(event.offsetX, event.offsetY);
    state.panX += pointerAfter.x - pointerBefore.x;
    state.panY += pointerAfter.y - pointerBefore.y;
    draw();
  }, { passive: false });

  searchInput?.addEventListener('input', event => {
    state.searchTerm = (event.target?.value || '').trim();
    applyFilters();
  });

  degreeLimitInput?.addEventListener('change', event => {
    const value = Number.parseInt(event.target?.value || '30', 10);
    state.maxEdgesPerNode = Number.isFinite(value) ? Math.max(1, Math.min(200, value)) : 30;
    event.target.value = String(state.maxEdgesPerNode);
    applyFilters();
  });

  resetViewButton?.addEventListener('click', () => {
    state.searchTerm = '';
    state.maxEdgesPerNode = 30;
    if (searchInput) {
      searchInput.value = '';
    }

    if (degreeLimitInput) {
      degreeLimitInput.value = '30';
    }

    state.graph.nodes.forEach(node => {
      node.visible = true;
    });

    state.graph.edges.forEach(edge => {
      edge.visible = true;
    });

    state.selectedNodeId = null;
    state.hoverNodeId = null;
    updateInspector();
    fitGraph();
    draw();
  });

  fitViewButton?.addEventListener('click', () => {
    fitGraph();
    draw();
  });

  window.addEventListener('resize', () => {
    resizeCanvas();
    fitGraph();
    draw();
  });
};

const init = () => {
  const { payload, projectRoot, theme } = readData();
  applyTheme(theme);

  subtitleEl.textContent = projectRoot
    ? `Source: ${projectRoot}`
    : 'Source: uv.lock in current workspace';

  updateStats(payload);
  const graph = buildGraph(payload);
  state.graph = graph;

  runLayout(graph);
  resizeCanvas();
  fitGraph();
  updateInspector();
  draw();
  wireEvents();
};

window.addEventListener('message', event => {
  const message = event.data;
  if (message.command === 'setTheme') {
    applyTheme(message.theme);
  }
});

init();
