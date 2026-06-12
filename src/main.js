import './style.css';

/* ============================================================
   WEBDRAW — клиентский редактор рисования
   ============================================================ */

// ---------- ГЛОБАЛЬНОЕ СОСТОЯНИЕ ----------
const state = {
  canvasW: 800,
  canvasH: 600,
  bgColor: '#ffffff',
  layers: [],          // index 0 = верхний слой ... последний = background
  activeLayerId: null,
  nextLayerId: 1,
  tool: 'brush',
  brushSize: 2,
  brushColor: '#000000',
  fillColor: '#ff0000',
  fillMode: 'filled',  // filled | outline
  shapeType: 'rect',
  recentColors: [],
  activeColorTarget: 'brush', // brush | fill
  stamp: 'star',
  customStampImg: null,
};

const PALETTES = [
  ['#1a0000','#330000','#660000','#990000','#cc0000','#ff0000','#ff3333','#ff6666','#ffffff','#000000','#ff4d6d','#8a0418'],
  ['#000000','#0d0d0d','#1a1a1a','#262626','#333333','#404040','#4d4d4d','#666666','#808080','#999999','#cccccc','#ffffff'],
  ['#ff003c','#ff6ec7','#39ff14','#00f0ff','#ffe600','#ff9100','#bd00ff','#00ff85','#ff0090','#0aff99','#ff2e2e','#ffffff'],
];

// ---------- DOM ----------
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

const mainCanvas = $('#main-canvas');
const overlayCanvas = $('#overlay-canvas');
const mctx = mainCanvas.getContext('2d');
const octx = overlayCanvas.getContext('2d');
const wrapper = $('#canvas-wrapper');

const HANDLE = 10; // px, минимальный размер вершины
const CANVAS_RESIZE_HANDLE = 16;

// ---------- ИСТОРИЯ (UNDO/REDO до 3 шагов) ----------
let history = [];
let historyIndex = -1;
const MAX_HISTORY = 4; // текущий + 3 отмены

function layerToJSON(layer) {
  const base = { id: layer.id, type: layer.type, x: layer.x, y: layer.y, w: layer.w, h: layer.h, name: layer.name };
  if (layer.type === 'shape') {
    base.shape = JSON.parse(JSON.stringify(layer.shape));
  } else {
    base.dataURL = layer.canvas.toDataURL();
  }
  return base;
}

function layerFromJSON(json) {
  return new Promise((resolve) => {
    if (json.type === 'shape') {
      resolve({ ...json, shape: JSON.parse(JSON.stringify(json.shape)) });
      return;
    }
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(json.w));
    canvas.height = Math.max(1, Math.round(json.h));
    const ctx = canvas.getContext('2d');
    const img = new Image();
    img.onload = () => {
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      resolve({ ...json, canvas, ctx });
    };
    img.src = json.dataURL;
  });
}

async function snapshot() {
  return {
    canvasW: state.canvasW,
    canvasH: state.canvasH,
    bgColor: state.bgColor,
    activeLayerId: state.activeLayerId,
    layers: state.layers.map(layerToJSON),
  };
}

async function pushHistory() {
  const snap = await snapshot();
  history = history.slice(0, historyIndex + 1);
  history.push(snap);
  if (history.length > MAX_HISTORY) history.shift();
  historyIndex = history.length - 1;
  updateUndoRedoButtons();
}

async function restoreSnapshot(snap) {
  state.canvasW = snap.canvasW;
  state.canvasH = snap.canvasH;
  state.bgColor = snap.bgColor;
  state.activeLayerId = snap.activeLayerId;
  const layers = [];
  for (const j of snap.layers) layers.push(await layerFromJSON(j));
  state.layers = layers;
  resizeCanvasElements();
  render();
  renderLayersPanel();
}

async function undo() {
  if (historyIndex <= 0) return;
  historyIndex--;
  await restoreSnapshot(history[historyIndex]);
  updateUndoRedoButtons();
}

async function redo() {
  if (historyIndex >= history.length - 1) return;
  historyIndex++;
  await restoreSnapshot(history[historyIndex]);
  updateUndoRedoButtons();
}

function updateUndoRedoButtons() {
  $('#undo-btn').disabled = historyIndex <= 0;
  $('#redo-btn').disabled = historyIndex >= history.length - 1;
  $('#undo-btn').style.opacity = $('#undo-btn').disabled ? 0.35 : 1;
  $('#redo-btn').style.opacity = $('#redo-btn').disabled ? 0.35 : 1;
}

// ---------- СОЗДАНИЕ СЛОЁВ ----------
function makeDrawingCanvas(w, h, fill) {
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(w));
  canvas.height = Math.max(1, Math.round(h));
  const ctx = canvas.getContext('2d');
  if (fill) {
    ctx.fillStyle = fill;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }
  return { canvas, ctx };
}

function createBackgroundLayer() {
  const { canvas, ctx } = makeDrawingCanvas(state.canvasW, state.canvasH, state.bgColor);
  return {
    id: 'background', type: 'background', name: 'Фон',
    x: 0, y: 0, w: state.canvasW, h: state.canvasH,
    canvas, ctx,
  };
}

function createDrawingLayer() {
  const { canvas, ctx } = makeDrawingCanvas(state.canvasW, state.canvasH, null);
  const id = 'layer' + (state.nextLayerId++);
  return {
    id, type: 'drawing', name: 'Слой рисования ' + id.replace('layer', ''),
    x: 0, y: 0, w: state.canvasW, h: state.canvasH,
    canvas, ctx,
  };
}

function createShapeLayer(x, y, w, h, shapeData) {
  const id = 'layer' + (state.nextLayerId++);
  return {
    id, type: 'shape', name: 'Фигура ' + id.replace('layer', ''),
    x, y, w, h, shape: shapeData,
  };
}

function getLayer(id) { return state.layers.find(l => l.id === id); }
function getActiveLayer() { return getLayer(state.activeLayerId); }
function getActiveIndex() { return state.layers.findIndex(l => l.id === state.activeLayerId); }

// ============================================================
//                       РЕНДЕРИНГ
// ============================================================
function resizeCanvasElements() {
  mainCanvas.width = state.canvasW;
  mainCanvas.height = state.canvasH;
  overlayCanvas.width = state.canvasW;
  overlayCanvas.height = state.canvasH;
  wrapper.style.width = state.canvasW + 'px';
  wrapper.style.height = state.canvasH + 'px';
}

function drawShapeOnContext(ctx, shape, w, h) {
  ctx.save();
  ctx.lineWidth = shape.lineWidth || 2;
  ctx.strokeStyle = shape.strokeColor;
  ctx.fillStyle = shape.fillColor;
  ctx.beginPath();

  if (shape.kind === 'rect') {
    ctx.rect(0.5 * ctx.lineWidth, 0.5 * ctx.lineWidth, Math.max(0, w - ctx.lineWidth), Math.max(0, h - ctx.lineWidth));
  } else if (shape.kind === 'oval') {
    ctx.ellipse(w / 2, h / 2, Math.max(0.01, w / 2 - ctx.lineWidth / 2), Math.max(0.01, h / 2 - ctx.lineWidth / 2), 0, 0, Math.PI * 2);
  } else if (shape.kind === 'polygon' || shape.kind === 'star') {
    const pts = shape.points; // нормализованные [-1,1]
    pts.forEach((p, i) => {
      const px = w / 2 + p[0] * (w / 2 - ctx.lineWidth / 2);
      const py = h / 2 + p[1] * (h / 2 - ctx.lineWidth / 2);
      if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    });
    ctx.closePath();
  }

  if (shape.filled) ctx.fill();
  if (!shape.filled) ctx.stroke();
  ctx.restore();
}

function render() {
  mctx.clearRect(0, 0, state.canvasW, state.canvasH);
  // рисуем от фона (последний элемент) к верхнему (первый элемент)
  for (let i = state.layers.length - 1; i >= 0; i--) {
    const layer = state.layers[i];
    if (layer.type === 'shape') {
      mctx.save();
      mctx.translate(layer.x, layer.y);
      drawShapeOnContext(mctx, layer.shape, layer.w, layer.h);
      mctx.restore();
    } else {
      mctx.drawImage(layer.canvas, layer.x, layer.y, layer.w, layer.h);
    }
  }
  renderOverlay();
}

function renderOverlay() {
  octx.clearRect(0, 0, state.canvasW, state.canvasH);
  const layer = getActiveLayer();
  if (layer && layer.type !== 'background') {
    octx.strokeStyle = '#e0102b';
    octx.lineWidth = 1;
    octx.strokeRect(layer.x + 0.5, layer.y + 0.5, layer.w, layer.h);

    const corners = [
      [layer.x, layer.y], [layer.x + layer.w, layer.y],
      [layer.x, layer.y + layer.h], [layer.x + layer.w, layer.y + layer.h],
    ];
    octx.fillStyle = '#e0102b';
    octx.strokeStyle = '#ffffff';
    corners.forEach(([cx, cy]) => {
      octx.fillRect(cx - HANDLE / 2, cy - HANDLE / 2, HANDLE, HANDLE);
      octx.strokeRect(cx - HANDLE / 2, cy - HANDLE / 2, HANDLE, HANDLE);
    });
  }

  // маркер изменения размера холста
  octx.fillStyle = '#e0102b';
  octx.fillRect(state.canvasW - CANVAS_RESIZE_HANDLE, state.canvasH - CANVAS_RESIZE_HANDLE, CANVAS_RESIZE_HANDLE, CANVAS_RESIZE_HANDLE);
  octx.strokeStyle = '#fff';
  octx.strokeRect(state.canvasW - CANVAS_RESIZE_HANDLE, state.canvasH - CANVAS_RESIZE_HANDLE, CANVAS_RESIZE_HANDLE, CANVAS_RESIZE_HANDLE);
}

// ============================================================
//                       ПАНЕЛЬ СЛОЁВ
// ============================================================
function renderLayersPanel() {
  const list = $('#layers-list');
  list.innerHTML = '';
  state.layers.forEach((layer) => {
    const item = document.createElement('div');
    item.className = 'layer-item' + (layer.id === state.activeLayerId ? ' active' : '') + (layer.type === 'background' ? ' background-layer' : '');

    const thumb = document.createElement('div');
    thumb.className = 'thumb';
    if (layer.type !== 'shape') {
      thumb.style.backgroundImage = `url(${layer.canvas.toDataURL()})`;
    } else {
      thumb.style.background = layer.shape.filled ? layer.shape.fillColor : 'transparent';
      thumb.style.border = `2px solid ${layer.shape.strokeColor}`;
    }

    const name = document.createElement('div');
    name.className = 'name';
    name.textContent = layer.type === 'background' ? '🏳 ' + layer.name : layer.name;

    const controls = document.createElement('div');
    controls.className = 'layer-controls';

    if (layer.type !== 'background') {
      const upBtn = document.createElement('button');
      upBtn.textContent = '▲';
      upBtn.title = 'Поднять слой';
      upBtn.onclick = (e) => { e.stopPropagation(); moveLayer(layer.id, -1); };

      const downBtn = document.createElement('button');
      downBtn.textContent = '▼';
      downBtn.title = 'Опустить слой';
      downBtn.onclick = (e) => { e.stopPropagation(); moveLayer(layer.id, 1); };

      const delBtn = document.createElement('button');
      delBtn.textContent = '✕';
      delBtn.title = 'Удалить слой';
      delBtn.onclick = (e) => { e.stopPropagation(); deleteLayer(layer.id); };

      controls.append(upBtn, downBtn, delBtn);
    }

    item.append(thumb, name, controls);
    item.onclick = () => { state.activeLayerId = layer.id; render(); renderLayersPanel(); };
    list.appendChild(item);
  });
}

function moveLayer(id, dir) {
  const idx = state.layers.findIndex(l => l.id === id);
  const targetIdx = idx + dir;
  if (targetIdx < 0 || targetIdx >= state.layers.length) return;
  if (state.layers[targetIdx].type === 'background') return;
  if (state.layers[idx].type === 'background') return;
  [state.layers[idx], state.layers[targetIdx]] = [state.layers[targetIdx], state.layers[idx]];
  render(); renderLayersPanel(); pushHistory();
}

function deleteLayer(id) {
  const layer = getLayer(id);
  if (!layer || layer.type === 'background') return;
  state.layers = state.layers.filter(l => l.id !== id);
  if (state.activeLayerId === id) {
    state.activeLayerId = state.layers[0] ? state.layers[0].id : 'background';
  }
  render(); renderLayersPanel(); pushHistory();
}

// ============================================================
//                       ЦВЕТА
// ============================================================
function setColor(target, color) {
  if (target === 'brush') {
    state.brushColor = color;
    $('#current-brush-swatch').style.background = color;
    $('#brush-color-input').value = color;
  } else {
    state.fillColor = color;
    $('#current-fill-swatch').style.background = color;
    $('#fill-color-input').value = color;
  }
  addRecentColor(color);
}

function addRecentColor(color) {
  state.recentColors = [color, ...state.recentColors.filter(c => c !== color)].slice(0, 12);
  renderRecentColors();
}

function renderPalette(index) {
  const grid = $('#palette-grid');
  grid.innerHTML = '';
  PALETTES[index].forEach((color) => {
    const sw = document.createElement('div');
    sw.className = 'swatch';
    sw.style.background = color;
    sw.title = color;
    sw.onclick = () => setColor(state.activeColorTarget, color);
    grid.appendChild(sw);
  });
}

function renderRecentColors() {
  const grid = $('#recent-grid');
  grid.innerHTML = '';
  state.recentColors.forEach((color) => {
    const sw = document.createElement('div');
    sw.className = 'swatch';
    sw.style.background = color;
    sw.title = color;
    sw.onclick = () => setColor(state.activeColorTarget, color);
    grid.appendChild(sw);
  });
}

// ============================================================
//                       ФИГУРЫ — ГЕОМЕТРИЯ
// ============================================================
function regularPolygonPoints(sides) {
  const pts = [];
  for (let i = 0; i < sides; i++) {
    const angle = -Math.PI / 2 + (2 * Math.PI * i) / sides;
    pts.push([Math.cos(angle), Math.sin(angle)]);
  }
  return pts;
}

function starPoints(points, r1, r2) {
  const pts = [];
  const n = points * 2;
  for (let i = 0; i < n; i++) {
    const angle = -Math.PI / 2 + (Math.PI * i) / points;
    const r = i % 2 === 0 ? r1 : r2;
    pts.push([Math.cos(angle) * r, Math.sin(angle) * r]);
  }
  return pts;
}

function buildShapeData(kind) {
  const lineWidth = state.brushSize === 2 ? 2 : state.brushSize;
  const data = {
    kind,
    filled: state.fillMode === 'filled',
    fillColor: state.fillColor,
    strokeColor: state.brushColor,
    lineWidth,
  };
  if (kind === 'polygon') {
    const sides = Math.max(3, parseInt($('#polygon-sides').value, 10) || 3);
    data.points = regularPolygonPoints(sides);
  } else if (kind === 'star') {
    const points = Math.max(3, parseInt($('#star-points').value, 10) || 3);
    const r1 = parseInt($('#star-r1').value, 10) / 100;
    const r2 = parseInt($('#star-r2').value, 10) / 100;
    data.points = starPoints(points, r1 || 1, r2 || 0.4);
  }
  return data;
}

// ============================================================
//                       ИНСТРУМЕНТЫ — ОБРАБОТКА ХОЛСТА
// ============================================================
let pointer = { down: false, mode: null, startX: 0, startY: 0, lastX: 0, lastY: 0 };
let resizeData = null; // для изменения размера/перемещения слоя
let canvasResizing = false;

function getCanvasCoords(e) {
  const rect = mainCanvas.getBoundingClientRect();
  return {
    x: (e.clientX - rect.left) * (state.canvasW / rect.width),
    y: (e.clientY - rect.top) * (state.canvasH / rect.height),
  };
}

function isDrawable(layer) {
  return layer && (layer.type === 'drawing' || layer.type === 'background');
}

function findCornerHit(layer, x, y) {
  if (!layer || layer.type === 'background') return null;
  const corners = {
    tl: [layer.x, layer.y],
    tr: [layer.x + layer.w, layer.y],
    bl: [layer.x, layer.y + layer.h],
    br: [layer.x + layer.w, layer.y + layer.h],
  };
  for (const [name, [cx, cy]] of Object.entries(corners)) {
    if (Math.abs(x - cx) <= HANDLE && Math.abs(y - cy) <= HANDLE) return name;
  }
  return null;
}

function isOnCanvasResizeHandle(x, y) {
  return x >= state.canvasW - CANVAS_RESIZE_HANDLE && y >= state.canvasH - CANVAS_RESIZE_HANDLE
    && x <= state.canvasW && y <= state.canvasH;
}

// ---- КИСТЬ ----
function brushStart(layer, x, y) {
  layer.ctx.lineCap = 'round';
  layer.ctx.lineJoin = 'round';
  layer.ctx.strokeStyle = state.brushColor;
  layer.ctx.lineWidth = state.brushSize;
  layer.ctx.beginPath();
  layer.ctx.moveTo(x - layer.x, y - layer.y);
}

function brushMove(layer, x, y, shift) {
  let lx = x - layer.x, ly = y - layer.y;
  if (shift) {
    const dx = Math.abs(x - pointer.lastX);
    const dy = Math.abs(y - pointer.lastY);
    if (dx > dy) ly = pointer.lastY - layer.y; else lx = pointer.lastX - layer.x;
  }
  layer.ctx.lineTo(lx, ly);
  layer.ctx.stroke();
}

function drawCircleAtSafe(layer, x, y) {
  const lx = x - layer.x, ly = y - layer.y;
  layer.ctx.beginPath();
  layer.ctx.arc(lx, ly, state.brushSize / 2, 0, Math.PI * 2);
  layer.ctx.fillStyle = state.brushColor;
  layer.ctx.fill();
}

// ---- ЗАЛИВКА ----
function hexToRgb(hex) {
  const m = hex.replace('#', '');
  return {
    r: parseInt(m.substring(0, 2), 16),
    g: parseInt(m.substring(2, 4), 16),
    b: parseInt(m.substring(4, 6), 16),
  };
}

function floodFill(layer, x, y) {
  const lx = Math.round(x - layer.x), ly = Math.round(y - layer.y);
  const w = layer.canvas.width, h = layer.canvas.height;
  if (lx < 0 || ly < 0 || lx >= w || ly >= h) return;
  const imgData = layer.ctx.getImageData(0, 0, w, h);
  const data = imgData.data;
  const idx = (ly * w + lx) * 4;
  const target = [data[idx], data[idx + 1], data[idx + 2], data[idx + 3]];

  const fc = hexToRgb(state.fillColor);
  const fillColor = [fc.r, fc.g, fc.b, 255];

  if (target[0] === fillColor[0] && target[1] === fillColor[1] && target[2] === fillColor[2] && target[3] === fillColor[3]) return;

  const stack = [[lx, ly]];
  const visited = new Uint8Array(w * h);

  function matches(px, py) {
    const i = (py * w + px) * 4;
    return data[i] === target[0] && data[i + 1] === target[1] && data[i + 2] === target[2] && data[i + 3] === target[3];
  }

  while (stack.length) {
    const [px, py] = stack.pop();
    if (px < 0 || py < 0 || px >= w || py >= h) continue;
    const vIdx = py * w + px;
    if (visited[vIdx]) continue;
    if (!matches(px, py)) continue;
    visited[vIdx] = 1;
    const i = vIdx * 4;
    data[i] = fillColor[0]; data[i + 1] = fillColor[1]; data[i + 2] = fillColor[2]; data[i + 3] = fillColor[3];
    stack.push([px + 1, py], [px - 1, py], [px, py + 1], [px, py - 1]);
  }
  layer.ctx.putImageData(imgData, 0, 0);
}

// ---- ШТАМП ----
const STAMP_EMOJI = { star: '★', heart: '♥', skull: '☠', bolt: '⚡' };
function stampAt(layer, x, y) {
  const lx = x - layer.x, ly = y - layer.y;
  const size = 24 + state.brushSize * 8;
  if (state.stamp === 'custom' && state.customStampImg) {
    layer.ctx.drawImage(state.customStampImg, lx - size / 2, ly - size / 2, size, size);
  } else {
    layer.ctx.font = `${size}px sans-serif`;
    layer.ctx.fillStyle = state.brushColor;
    layer.ctx.textAlign = 'center';
    layer.ctx.textBaseline = 'middle';
    layer.ctx.fillText(STAMP_EMOJI[state.stamp] || '★', lx, ly);
  }
}

function drawStampPreview(x, y) {
  const size = 24 + state.brushSize * 8;
  octx.save();
  octx.globalAlpha = 0.5;
  if (state.stamp === 'custom' && state.customStampImg) {
    octx.drawImage(state.customStampImg, x - size / 2, y - size / 2, size, size);
  } else {
    octx.font = `${size}px sans-serif`;
    octx.fillStyle = state.brushColor;
    octx.textAlign = 'center';
    octx.textBaseline = 'middle';
    octx.fillText(STAMP_EMOJI[state.stamp] || '★', x, y);
  }
  octx.restore();
}

// ============================================================
//                       СОБЫТИЯ МЫШИ
// ============================================================
mainCanvas.addEventListener('mousedown', (e) => {
  const { x, y } = getCanvasCoords(e);
  pointer = { down: true, mode: null, startX: x, startY: y, lastX: x, lastY: y };

  // 1. маркер изменения размера холста
  if (isOnCanvasResizeHandle(x, y)) {
    canvasResizing = true;
    pointer.mode = 'canvas-resize';
    return;
  }

  const activeLayer = getActiveLayer();

  // 2. вершины активного слоя (изменение размера)
  const corner = findCornerHit(activeLayer, x, y);
  if (corner) {
    pointer.mode = 'layer-resize';
    resizeData = {
      corner,
      orig: { x: activeLayer.x, y: activeLayer.y, w: activeLayer.w, h: activeLayer.h },
    };
    return;
  }

  // 3. CTRL+drag — перемещение слоя
  if (e.ctrlKey && activeLayer && activeLayer.type !== 'background') {
    pointer.mode = 'layer-move';
    resizeData = { orig: { x: activeLayer.x, y: activeLayer.y } };
    return;
  }

  // 4. инструменты
  if (state.tool === 'brush') {
    if (!isDrawable(activeLayer)) return;
    pointer.mode = 'brush';
    brushStart(activeLayer, x, y);
    drawCircleAtSafe(activeLayer, x, y);
    render();
  } else if (state.tool === 'shape') {
    pointer.mode = 'shape';
  } else if (state.tool === 'bucket') {
    if (!isDrawable(activeLayer)) return;
    floodFill(activeLayer, x, y);
    render(); renderLayersPanel();
    pushHistory();
    pointer.down = false;
  } else if (state.tool === 'stamp') {
    if (!isDrawable(activeLayer)) return;
    pointer.mode = 'stamp';
    stampAt(activeLayer, x, y);
    render();
  } else if (state.tool === 'move') {
    if (activeLayer && activeLayer.type !== 'background') {
      pointer.mode = 'layer-move';
      resizeData = { orig: { x: activeLayer.x, y: activeLayer.y } };
    }
  }
});

window.addEventListener('mousemove', (e) => {
  const { x, y } = getCanvasCoords(e);
  const activeLayer = getActiveLayer();

  // индикатор штампа при наведении без зажатой кнопки
  if (!pointer.down && state.tool === 'stamp') {
    render();
    if (isDrawable(activeLayer)) drawStampPreview(x, y);
  }

  if (!pointer.down) return;

  if (pointer.mode === 'canvas-resize') {
    const newW = clamp(Math.round(x), 50, 4000);
    const newH = clamp(Math.round(y), 50, 4000);
    resizeCanvasTo(newW, newH);
    render(); renderLayersPanel();
  } else if (pointer.mode === 'layer-resize') {
    resizeActiveLayer(x, y, e.shiftKey);
    render();
  } else if (pointer.mode === 'layer-move') {
    moveActiveLayer(x - pointer.startX, y - pointer.startY);
    render();
  } else if (pointer.mode === 'brush') {
    if (isDrawable(activeLayer)) {
      brushMove(activeLayer, x, y, e.shiftKey);
      render();
    }
  } else if (pointer.mode === 'shape') {
    drawShapePreview(pointer.startX, pointer.startY, x, y, e.shiftKey);
  } else if (pointer.mode === 'stamp') {
    if (isDrawable(activeLayer)) {
      stampAt(activeLayer, x, y);
      render();
    }
  }

  pointer.lastX = x; pointer.lastY = y;
});

window.addEventListener('mouseup', (e) => {
  if (!pointer.down) return;
  const { x, y } = getCanvasCoords(e);

  if (pointer.mode === 'shape') {
    finalizeShape(pointer.startX, pointer.startY, x, y, e.shiftKey);
  }

  if (['canvas-resize', 'layer-resize', 'layer-move', 'brush', 'stamp', 'shape'].includes(pointer.mode)) {
    render(); renderLayersPanel();
    pushHistory();
  }

  pointer.down = false;
  pointer.mode = null;
  canvasResizing = false;
  resizeData = null;
});

function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }

// ---- ПЕРЕМЕЩЕНИЕ СЛОЯ ----
function moveActiveLayer(dx, dy) {
  const layer = getActiveLayer();
  if (!layer || layer.type === 'background') return;
  let nx = resizeData.orig.x + dx;
  let ny = resizeData.orig.y + dy;
  nx = clamp(nx, 0, state.canvasW - layer.w);
  ny = clamp(ny, 0, state.canvasH - layer.h);
  layer.x = nx; layer.y = ny;
}

// ---- ИЗМЕНЕНИЕ РАЗМЕРА СЛОЯ ----
function resizeActiveLayer(x, y, shift) {
  const layer = getActiveLayer();
  if (!layer) return;
  const { corner, orig } = resizeData;
  let { x: ox, y: oy, w: ow, h: oh } = orig;
  x = clamp(x, 0, state.canvasW);
  y = clamp(y, 0, state.canvasH);

  let nx = ox, ny = oy, nw = ow, nh = oh;

  if (corner === 'tl') { nw = ox + ow - x; nh = oy + oh - y; nx = x; ny = y; }
  if (corner === 'tr') { nw = x - ox; nh = oy + oh - y; nx = ox; ny = y; }
  if (corner === 'bl') { nw = ox + ow - x; nh = y - oy; nx = x; ny = oy; }
  if (corner === 'br') { nw = x - ox; nh = y - oy; nx = ox; ny = oy; }

  if (shift) {
    const ratio = ow / oh || 1;
    if (Math.abs(nw - ow) > Math.abs(nh - oh)) {
      nh = nw / ratio;
    } else {
      nw = nh * ratio;
    }
    if (corner === 'tl') { nx = ox + ow - nw; ny = oy + oh - nh; }
    if (corner === 'tr') { ny = oy + oh - nh; }
    if (corner === 'bl') { nx = ox + ow - nw; }
  }

  nw = Math.max(5, nw);
  nh = Math.max(5, nh);

  if (nx < 0) { nw += nx; nx = 0; }
  if (ny < 0) { nh += ny; ny = 0; }
  if (nx + nw > state.canvasW) nw = state.canvasW - nx;
  if (ny + nh > state.canvasH) nh = state.canvasH - ny;
  nw = Math.max(5, nw); nh = Math.max(5, nh);

  if (layer.type !== 'shape') {
    const { canvas: newCanvas, ctx: newCtx } = makeDrawingCanvas(nw, nh, null);
    newCtx.drawImage(layer.canvas, 0, 0, layer.canvas.width, layer.canvas.height, 0, 0, newCanvas.width, newCanvas.height);
    layer.canvas = newCanvas;
    layer.ctx = newCtx;
  }

  layer.x = nx; layer.y = ny; layer.w = nw; layer.h = nh;
}

// ---- ИЗМЕНЕНИЕ РАЗМЕРА ХОЛСТА ----
function resizeCanvasTo(newW, newH) {
  const bg = state.layers.find(l => l.type === 'background');
  const { canvas: newCanvas, ctx: newCtx } = makeDrawingCanvas(newW, newH, state.bgColor);
  newCtx.drawImage(bg.canvas, 0, 0, bg.canvas.width, bg.canvas.height, 0, 0, newW, newH);
  bg.canvas = newCanvas; bg.ctx = newCtx; bg.w = newW; bg.h = newH;

  state.canvasW = newW; state.canvasH = newH;
  resizeCanvasElements();

  state.layers.forEach((l) => {
    if (l.type === 'background') return;
    l.x = clamp(l.x, 0, Math.max(0, newW - l.w));
    l.y = clamp(l.y, 0, Math.max(0, newH - l.h));
  });
}

// ---- ПРЕДПРОСМОТР ФИГУРЫ ----
function shapeBoxFromDrag(x0, y0, x1, y1, shift) {
  let x = Math.min(x0, x1), y = Math.min(y0, y1);
  let w = Math.abs(x1 - x0), h = Math.abs(y1 - y0);
  if (shift) {
    const s = Math.max(w, h);
    w = s; h = s;
    x = x1 >= x0 ? x0 : x0 - s;
    y = y1 >= y0 ? y0 : y0 - s;
  }
  return { x, y, w, h };
}

function drawShapePreview(x0, y0, x1, y1, shift) {
  render();
  const { x, y, w, h } = shapeBoxFromDrag(x0, y0, x1, y1, shift);
  const shapeData = buildShapeData(state.shapeType);
  octx.save();
  octx.globalAlpha = 0.7;
  octx.translate(x, y);
  drawShapeOnContext(octx, shapeData, w, h);
  octx.restore();
}

function finalizeShape(x0, y0, x1, y1, shift) {
  let { x, y, w, h } = shapeBoxFromDrag(x0, y0, x1, y1, shift);
  if (w < 4 || h < 4) { render(); return; }
  x = clamp(x, 0, state.canvasW - w);
  y = clamp(y, 0, state.canvasH - h);

  const shapeData = buildShapeData(state.shapeType);
  const newLayer = createShapeLayer(x, y, w, h, shapeData);
  const insertAt = Math.max(0, getActiveIndex());
  state.layers.splice(insertAt, 0, newLayer);
  state.activeLayerId = newLayer.id;
}

// ============================================================
//                       UI — ИНСТРУМЕНТЫ
// ============================================================
$$('.tool-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    $$('.tool-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    state.tool = btn.dataset.tool;
    $('#brush-options').classList.toggle('hidden', state.tool !== 'brush');
    $('#shape-options').classList.toggle('hidden', state.tool !== 'shape');
    $('#stamp-options').classList.toggle('hidden', state.tool !== 'stamp');
    render();
  });
});

$$('.size-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    $$('.size-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    state.brushSize = parseInt(btn.dataset.size, 10);
  });
});

$$('.fillmode-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    $$('.fillmode-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    state.fillMode = btn.dataset.fillmode;
  });
});

$('#shape-type').addEventListener('change', (e) => {
  state.shapeType = e.target.value;
  $('#polygon-options').classList.toggle('hidden', state.shapeType !== 'polygon');
  $('#star-options').classList.toggle('hidden', state.shapeType !== 'star');
});

$$('.stamp-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    if (btn.dataset.stamp === 'custom' && !state.customStampImg) {
      $('#custom-stamp-input').click();
      return;
    }
    $$('.stamp-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    state.stamp = btn.dataset.stamp;
  });
});

$('#custom-stamp-input').addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (ev) => {
    const img = new Image();
    img.onload = () => {
      state.customStampImg = img;
      $('#custom-stamp-preview').src = ev.target.result;
      $('#custom-stamp-preview').classList.remove('hidden');
      $$('.stamp-btn').forEach(b => b.classList.remove('active'));
      $('#stamp-custom-btn').classList.add('active');
      state.stamp = 'custom';
    };
    img.src = ev.target.result;
  };
  reader.readAsDataURL(file);
});

// ---- ЦВЕТА ----
$$('.color-tab').forEach((tab) => {
  tab.addEventListener('click', () => {
    $$('.color-tab').forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    state.activeColorTarget = tab.dataset.target;
    $('#fill-color-block').classList.toggle('hidden', state.activeColorTarget !== 'fill');
  });
});

$('#brush-color-input').addEventListener('input', (e) => setColor('brush', e.target.value));
$('#fill-color-input').addEventListener('input', (e) => setColor('fill', e.target.value));

$$('.palette-tab').forEach((tab) => {
  tab.addEventListener('click', () => {
    $$('.palette-tab').forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    renderPalette(parseInt(tab.dataset.palette, 10));
  });
});

// ---- НОВЫЙ СЛОЙ ----
$('#new-layer-btn').addEventListener('click', () => {
  const layer = createDrawingLayer();
  const insertAt = Math.max(0, getActiveIndex());
  state.layers.splice(insertAt, 0, layer);
  state.activeLayerId = layer.id;
  render(); renderLayersPanel();
  pushHistory();
});

// ---- UNDO/REDO ----
$('#undo-btn').addEventListener('click', undo);
$('#redo-btn').addEventListener('click', redo);
window.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); }
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') { e.preventDefault(); redo(); }
});

// ============================================================
//                       СОХРАНЕНИЕ / ЗАГРУЗКА
// ============================================================
function pad2(n) { return n.toString().padStart(2, '0'); }
function timestampName(ext) {
  const d = new Date();
  return `${d.getFullYear()}${pad2(d.getMonth() + 1)}${pad2(d.getDate())}_${pad2(d.getHours())}${pad2(d.getMinutes())}${pad2(d.getSeconds())}.${ext}`;
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

$('#save-jpeg-btn').addEventListener('click', () => {
  render();
  const tmp = document.createElement('canvas');
  tmp.width = state.canvasW; tmp.height = state.canvasH;
  const tctx = tmp.getContext('2d');
  tctx.fillStyle = '#ffffff';
  tctx.fillRect(0, 0, tmp.width, tmp.height);
  tctx.drawImage(mainCanvas, 0, 0);
  tmp.toBlob((blob) => downloadBlob(blob, timestampName('jpg')), 'image/jpeg', 0.92);
});

$('#save-project-btn').addEventListener('click', async () => {
  const data = await snapshot();
  data.recentColors = state.recentColors;
  data.brushColor = state.brushColor;
  data.fillColor = state.fillColor;
  data.history = history;
  data.historyIndex = historyIndex;
  const json = JSON.stringify(data, null, 2);
  downloadBlob(new Blob([json], { type: 'text/plain' }), timestampName('sdp'));
});

$('#load-project-input').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const text = await file.text();
  let data;
  try { data = JSON.parse(text); } catch { alert('Некорректный файл проекта'); return; }

  await restoreSnapshot(data);
  if (data.recentColors) { state.recentColors = data.recentColors; renderRecentColors(); }
  if (data.brushColor) setColor('brush', data.brushColor);
  if (data.fillColor) setColor('fill', data.fillColor);
  if (data.history) { history = data.history; historyIndex = data.historyIndex ?? (history.length - 1); }
  else { history = [data]; historyIndex = 0; }
  updateUndoRedoButtons();
  e.target.value = '';
});

// ============================================================
//                       СТАРТОВЫЙ ДИАЛОГ
// ============================================================
$('#setup-confirm').addEventListener('click', async () => {
  state.canvasW = clamp(parseInt($('#setup-width').value, 10) || 800, 50, 4000);
  state.canvasH = clamp(parseInt($('#setup-height').value, 10) || 600, 50, 4000);
  state.bgColor = $('#setup-bgcolor').value || '#ffffff';

  resizeCanvasElements();
  const bg = createBackgroundLayer();
  state.layers = [bg];
  state.activeLayerId = 'background';

  $('#setup-overlay').classList.add('hidden');
  $('#app').classList.remove('hidden');

  renderPalette(0);
  renderRecentColors();
  setColor('brush', state.brushColor);
  setColor('fill', state.fillColor);
  render();
  renderLayersPanel();
  await pushHistory();
});

mainCanvas.addEventListener('contextmenu', (e) => e.preventDefault());
