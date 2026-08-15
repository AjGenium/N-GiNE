// ============================================================
// ENGINE.JS
// The rendering/interaction engine: camera (pan/zoom), grid, the parts
// list, drag-to-move/snap, the left-panel field builder, the measure and
// angle tools, and the parts drawer. Nothing in here knows about any
// specific shape — it only calls through SHAPE_DEFS[part.type] (defined
// in shapes.js, which must load before this file).
// ============================================================

let unit = 'mm';
let precision = 0;
let gridSizeMm = 10;
const WORLD_PX_PER_MM = 2.2;
const GRID_MAJOR_EVERY = 5;

const cam = { x: -300, y: -260, zoom: 1 };
let OUTLINE_W = 1.6, CENTERLINE_W = 0.8, DIMLINE_W = 0.8;


// ============================================================
// PARTS — placed instances on the blueprint. Each carries its own
// params, extrude state, and world position; the engine below is
// generic across all of them.
// ============================================================
let parts = [];
let selectedPartId = null;
let partIdCounter = 1;
let measureMode = false;
let measurements = []; // {id, x1,y1,x2,y2} in mm — persist until dragged into the panel
let measureDrag = null; // id of the measurement currently being drawn out
let measureIdCounter = 1;
let angleMode = false;
let angleMeasurements = []; // {id, points:[{x,y}x3]} in mm — persist until dragged into the panel
let anglePoints = []; // 0-2 points while an angle entry is being built
let angleIdCounter = 1;
let annotDrag = null; // { kind:'measure'|'angle', id, startClientX, startClientY, startPoints }

function toggleMeasure() {
  measureMode = !measureMode;
  if (measureMode) { angleMode = false; anglePoints = []; document.getElementById('angleBtn').classList.remove('active'); }
  document.getElementById('measureBtn').classList.toggle('active', measureMode);
  document.getElementById('sheet').classList.toggle('measuring', measureMode || angleMode);
  render();
}

function toggleAngle() {
  angleMode = !angleMode;
  if (angleMode) { measureMode = false; document.getElementById('measureBtn').classList.remove('active'); }
  document.getElementById('angleBtn').classList.toggle('active', angleMode);
  document.getElementById('sheet').classList.toggle('measuring', measureMode || angleMode);
  if (!angleMode) anglePoints = [];
  render();
}

function beginAnnotDrag(kind, id, e) {
  e.preventDefault();
  e.stopPropagation();
  const entry = kind === 'measure' ? measurements.find(m => m.id === id) : angleMeasurements.find(a => a.id === id);
  if (!entry) return;
  const startPoints = kind === 'measure'
    ? [{ x: entry.x1, y: entry.y1 }, { x: entry.x2, y: entry.y2 }]
    : entry.points.map(p => ({ ...p }));
  annotDrag = { kind, id, startClientX: e.clientX, startClientY: e.clientY, startPoints };
}

function showConfirm(message, onConfirm) {
  const overlay = document.getElementById('confirmOverlay');
  document.getElementById('confirmMessage').textContent = message;
  overlay.classList.add('open');
  const okBtn = document.getElementById('confirmOkBtn');
  const cancelBtn = document.getElementById('confirmCancelBtn');
  const cleanup = () => {
    overlay.classList.remove('open');
    okBtn.onclick = null;
    cancelBtn.onclick = null;
  };
  okBtn.onclick = () => { cleanup(); onConfirm(); };
  cancelBtn.onclick = cleanup;
}

function clearSketch() {
  showConfirm('Clear the entire sketch? This removes all parts and measurements.', () => {
    parts = [];
    selectedPartId = null;
    measurements = [];
    angleMeasurements = [];
    anglePoints = [];
    rebuildLeftPanel();
    render();
  });
}

function makePart(type, worldXmm, worldYmm) {
  const def = SHAPE_DEFS[type];
  const part = {
    id: 'part' + (partIdCounter++),
    type,
    params: def.defaultParams(),
    extruded: false,
    extrudeParams: def.supportsExtrude ? def.defaultExtrudeParams() : {},
    frontPos: { x: worldXmm, y: worldYmm },
    sidePos: null,
    frontHandle: { x: 0, y: 0 },
    sideHandle: null,
  };
  if (def.hasVariants) part.variant = def.defaultVariant;
  return part;
}

function selectPart(id) {
  selectedPartId = id;
  rebuildLeftPanel();
  render();
}

function getSelectedPart() { return parts.find(p => p.id === selectedPartId) || null; }

function setUnit(u) {
  unit = u;
  document.getElementById('btn-metric').classList.toggle('active', u === 'mm');
  document.getElementById('btn-customary').classList.toggle('active', u === 'in');
  if (u === 'mm' && gridSizeMm !== 1 && gridSizeMm !== 10) gridSizeMm = 10;
  if (u === 'in' && gridSizeMm !== 25.4 && gridSizeMm !== 50.8) gridSizeMm = 25.4;
  buildGridMenuOptions();
  render();
}
function setPrecision(p) {
  precision = p;
  document.querySelectorAll('.precision-row button').forEach(b => b.classList.toggle('active', parseInt(b.dataset.p) === p));
  render();
}
function fmtClean(valMm) {
  if (unit === 'mm') return valMm.toFixed(precision) + 'mm';
  return (valMm / 25.4).toFixed(precision) + '"';
}
function getIncrementMm() {
  const incInUnit = precision === 0 ? 1 : precision === 1 ? 0.1 : precision === 2 ? 0.01 : 0.001;
  return unit === 'in' ? incInUnit * 25.4 : incInUnit;
}
function snapValue(store, key) {
  const s = store[key], inc = getIncrementMm();
  s.value = Math.min(s.max, Math.max(s.min, Math.round(s.value / inc) * inc));
}
function stepValue(store, key, dir) {
  const s = store[key], inc = getIncrementMm();
  s.value = Math.min(s.max, Math.max(s.min, s.value + dir * inc));
  snapValue(store, key);
  render();
}
function roundField(store, key) {
  const s = store[key];
  if (unit === 'mm') s.value = Math.round(s.value);
  else s.value = Math.round(s.value / 25.4) * 25.4;
  s.value = Math.min(s.max, Math.max(s.min, s.value));
  render();
}
function commitTyped(store, key, text) {
  const parsed = parseFloat(text.replace(/[^0-9.\-]/g, ''));
  if (!isNaN(parsed)) {
    const mmVal = unit === 'in' ? parsed * 25.4 : parsed;
    store[key].value = mmVal;
    snapValue(store, key);
  }
  render();
}

const PRECISION_MAX_SPEED = [50, 10, 2, 0.3];
let hold = null;
function beginHold(store, key, dir) {
  endHold();
  stepValue(store, key, dir);
  hold = { store, key, dir, delayTimeoutId: null, tickTimeoutId: null, active: false };
  hold.delayTimeoutId = setTimeout(() => {
    if (!hold) return;
    hold.active = true;
    hold.startTime = performance.now();
    scheduleTick();
  }, 400);
}
function scheduleTick() {
  if (!hold || !hold.active) return;
  const elapsedSec = (performance.now() - hold.startTime) / 1000;
  const rampFactor = 0.15 + 0.85 * Math.min(1, elapsedSec / 1.0);
  const tierSpeed = PRECISION_MAX_SPEED[precision];
  const maxSpeedMm = unit === 'in' ? tierSpeed * 25.4 : tierSpeed;
  const incMm = getIncrementMm();
  const stepsPerSec = Math.max(1, (maxSpeedMm / incMm) * rampFactor);
  const delayMs = 1000 / stepsPerSec;
  hold.tickTimeoutId = setTimeout(() => {
    if (!hold) return;
    stepValue(hold.store, hold.key, hold.dir);
    scheduleTick();
  }, delayMs);
}
function endHold() {
  if (!hold) return;
  clearTimeout(hold.delayTimeoutId);
  clearTimeout(hold.tickTimeoutId);
  hold = null;
}
window.addEventListener('pointerup', endHold);
window.addEventListener('pointerleave', endHold);

function buildFieldsInto(container, store, prefix) {
  container.innerHTML = '';
  for (const key in store) {
    const s = store[key];
    const field = document.createElement('div');
    field.className = 'field';
    field.innerHTML = `
      <div class="field-top"><label>${s.label}</label></div>
      <div class="value-row">
        <div class="value-display" id="${prefix}v-${key}" contenteditable="true" spellcheck="false"></div>
        <div class="stepper">
          <button class="step-btn step-up" title="Increase">▲</button>
          <button class="step-btn step-down" title="Decrease">▼</button>
        </div>
        <button class="round-btn" title="Round to nearest whole ${unit === 'mm' ? 'mm' : 'inch'}">R</button>
      </div>
    `;
    container.appendChild(field);
    field.querySelector('.step-up').addEventListener('pointerdown', (e) => { e.preventDefault(); beginHold(store, key, 1); });
    field.querySelector('.step-down').addEventListener('pointerdown', (e) => { e.preventDefault(); beginHold(store, key, -1); });
    field.querySelector('.round-btn').addEventListener('click', () => roundField(store, key));
    const valEl = field.querySelector('.value-display');
    valEl.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); valEl.blur(); } });
    valEl.addEventListener('blur', () => commitTyped(store, key, valEl.textContent));
  }
}

function switchVariant(partId, variantId) {
  const part = parts.find(p => p.id === partId);
  if (!part) return;
  const def = SHAPE_DEFS[part.type];
  part.variant = variantId;
  part.params = def.paramsForVariant(variantId);
  rebuildLeftPanel();
  render();
}

function rebuildLeftPanel() {
  const part = getSelectedPart();
  const fieldsEl = document.getElementById('fields');
  const emptyEl = document.getElementById('emptyState');
  const extrudeBtn = document.getElementById('extrudeBtn');
  const extrudeFieldsEl = document.getElementById('extrudeFields');
  const warnEl = document.getElementById('warning');
  const variantRowEl = document.getElementById('variantRow');

  if (!part) {
    document.getElementById('panelTitle').textContent = 'N-GINE';
    document.getElementById('panelSub').textContent = 'No part selected';
    fieldsEl.innerHTML = '';
    variantRowEl.innerHTML = '';
    emptyEl.style.display = 'block';
    extrudeBtn.style.display = 'block';
    extrudeBtn.disabled = true;
    extrudeBtn.textContent = 'Extrude →';
    extrudeFieldsEl.innerHTML = '';
    warnEl.style.display = 'none';
    return;
  }

  const def = SHAPE_DEFS[part.type];
  document.getElementById('panelTitle').textContent = def.hasVariants
    ? def.variants.find(v => v.id === part.variant).label
    : def.label;
  document.getElementById('panelSub').textContent = 'Editing selected part';
  emptyEl.style.display = 'none';

  variantRowEl.innerHTML = '';
  if (def.hasVariants) {
    def.variants.forEach(v => {
      const b = document.createElement('button');
      b.textContent = v.label;
      b.className = part.variant === v.id ? 'active' : '';
      b.onclick = () => switchVariant(part.id, v.id);
      variantRowEl.appendChild(b);
    });
  }

  buildFieldsInto(fieldsEl, part.params, '');

  if (!def.supportsExtrude) {
    extrudeBtn.style.display = 'none';
    extrudeFieldsEl.innerHTML = '';
  } else {
    extrudeBtn.style.display = 'block';
    extrudeBtn.disabled = false;
    extrudeBtn.textContent = part.extruded ? 'Extruded (Click to Remove)' : 'Extrude →';
    if (part.extruded) buildFieldsInto(extrudeFieldsEl, part.extrudeParams, 'ex-');
    else extrudeFieldsEl.innerHTML = '';
  }
}

function toggleExtrude() {
  const part = getSelectedPart();
  if (!part) return;
  part.extruded = !part.extruded;
  if (part.extruded) part.sidePos = SHAPE_DEFS[part.type].computeSideSpawnPos(part);
  else part.sidePos = null;
  rebuildLeftPanel();
  render();
}

function buildGridMenuOptions() {
  const opts = unit === 'mm' ? [{ v: 1, label: '1mm' }, { v: 10, label: '10mm' }] : [{ v: 25.4, label: '1 inch' }, { v: 50.8, label: '2 inch' }];
  const container = document.getElementById('gridMenuOptions');
  container.innerHTML = '';
  opts.forEach(o => {
    const b = document.createElement('button');
    b.textContent = o.label;
    b.className = gridSizeMm === o.v ? 'active' : '';
    b.onclick = () => { gridSizeMm = o.v; document.getElementById('gridMenuBtn').textContent = 'Grid: ' + o.label + ' ▾'; toggleGridMenu(true); buildGridMenuOptions(); render(); };
    container.appendChild(b);
  });
}
function toggleGridMenu(forceClose) {
  const el = document.getElementById('gridMenuOptions');
  if (forceClose) { el.style.display = 'none'; return; }
  el.style.display = el.style.display === 'block' ? 'none' : 'block';
}
document.addEventListener('click', (e) => {
  const wrap = document.getElementById('gridMenuWrap');
  if (!wrap.contains(e.target)) document.getElementById('gridMenuOptions').style.display = 'none';
});

function svgEl(tag, attrs) {
  const el = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const k in attrs) el.setAttribute(k, attrs[k]);
  return el;
}
function label(x, y, text, anchor) {
  const t = svgEl('text', { class: 'profile-label', x, y, 'text-anchor': anchor || 'middle' });
  t.textContent = text;
  return t;
}
function dimH(x1, x2, y, text, group, above = true) {
  const ext = 8, extDir = above ? -1 : 1, sw = { 'stroke-width': DIMLINE_W };
  group.appendChild(svgEl('line', { class: 'dim-line', x1, y1: y + extDir * ext, x2: x1, y2: y, ...sw }));
  group.appendChild(svgEl('line', { class: 'dim-line', x1: x2, y1: y + extDir * ext, x2, y2: y, ...sw }));
  group.appendChild(svgEl('line', { class: 'dim-line', x1, y1: y, x2, y2: y, ...sw }));
  const ah = 4;
  group.appendChild(svgEl('path', { class: 'dim-line', d: `M${x1},${y} l${ah},-2 M${x1},${y} l${ah},2`, ...sw }));
  group.appendChild(svgEl('path', { class: 'dim-line', d: `M${x2},${y} l${-ah},-2 M${x2},${y} l${-ah},2`, ...sw }));
  const t = svgEl('text', { class: 'dim-text', x: (x1 + x2) / 2, y: y + (above ? -5 : 13), 'text-anchor': 'middle' });
  t.textContent = text;
  group.appendChild(t);
}
function dimV(y1, y2, x, text, group, right = true) {
  const ext = 8, extDir = right ? 1 : -1, sw = { 'stroke-width': DIMLINE_W };
  group.appendChild(svgEl('line', { class: 'dim-line', x1: x + extDir * ext, y1: y1, x2: x, y2: y1, ...sw }));
  group.appendChild(svgEl('line', { class: 'dim-line', x1: x + extDir * ext, y1: y2, x2: x, y2: y2, ...sw }));
  group.appendChild(svgEl('line', { class: 'dim-line', x1: x, y1: y1, x2: x, y2: y2, ...sw }));
  const ah = 4;
  group.appendChild(svgEl('path', { class: 'dim-line', d: `M${x},${y1} l-2,${ah} M${x},${y1} l2,${ah}`, ...sw }));
  group.appendChild(svgEl('path', { class: 'dim-line', d: `M${x},${y2} l-2,${-ah} M${x},${y2} l2,${-ah}`, ...sw }));
  const t = svgEl('text', { class: 'dim-text', x: x + (right ? 12 : -12), y: (y1 + y2) / 2, 'text-anchor': right ? 'start' : 'end' });
  t.textContent = text;
  group.appendChild(t);
}
function leader(x0, y0, dx, dy, text, group) {
  const x1 = x0 + dx, y1 = y0 + dy;
  group.appendChild(svgEl('line', { class: 'leader-line', x1: x0, y1: y0, x2: x1, y2: y1, 'stroke-width': DIMLINE_W }));
  group.appendChild(svgEl('circle', { cx: x0, cy: y0, r: 2, fill: '#000000', stroke: 'none' }));
  const t = svgEl('text', { class: 'dim-text', x: x1 + (dx >= 0 ? 4 : -4), y: y1 + 4, 'text-anchor': dx >= 0 ? 'start' : 'end' });
  t.textContent = text;
  group.appendChild(t);
}
function addDragHandle(group, worldX, worldY, part, posObj) {
  const r = 9;
  const h = svgEl('circle', { class: 'drag-handle', cx: worldX, cy: worldY, r, fill: 'url(#dragHandleGradient)', stroke: '#00000030', 'stroke-width': 1 });
  h.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    e.stopPropagation();
    selectPart(part.id);
    dragState = { posObj, partId: part.id, startClientX: e.clientX, startClientY: e.clientY, startX: posObj.x, startY: posObj.y };
  });
  group.appendChild(h);
}

// nearest-part search across EVERY placed part's front and side handles — not
// hardcoded to any one shape
function deletePart(id) {
  parts = parts.filter(p => p.id !== id);
  if (selectedPartId === id) selectedPartId = null;
  rebuildLeftPanel();
  render();
}

function isOverControls(e) {
  const rect = document.getElementById('controls').getBoundingClientRect();
  return e.clientX >= rect.left && e.clientX <= rect.right && e.clientY >= rect.top && e.clientY <= rect.bottom;
}

function centerOnPart() {
  if (parts.length === 0) return;
  const svg = document.getElementById('sheet');
  const viewW = svg.clientWidth / cam.zoom, viewH = svg.clientHeight / cam.zoom;
  const camCenterX = cam.x + viewW / 2, camCenterY = cam.y + viewH / 2;
  const targets = [];
  parts.forEach(p => {
    targets.push(p.frontHandle);
    if (p.sideHandle) targets.push(p.sideHandle);
  });
  let nearest = targets[0], best = Infinity;
  targets.forEach(t => { const d = Math.hypot(t.x - camCenterX, t.y - camCenterY); if (d < best) { best = d; nearest = t; } });
  cam.x = nearest.x - viewW / 2;
  cam.y = nearest.y - viewH / 2;
  render();
}

function render() {
  const scale = WORLD_PX_PER_MM;
  OUTLINE_W = 1.6 / cam.zoom;
  CENTERLINE_W = 0.8 / cam.zoom;
  DIMLINE_W = 0.8 / cam.zoom;

  const selPart = getSelectedPart();
  for (const key in (selPart ? selPart.params : {})) {
    const el = document.getElementById('v-' + key);
    if (el && document.activeElement !== el) el.textContent = fmtClean(selPart.params[key].value);
  }
  if (selPart && selPart.extruded) {
    for (const key in selPart.extrudeParams) {
      const el = document.getElementById('ex-v-' + key);
      if (el && document.activeElement !== el) el.textContent = fmtClean(selPart.extrudeParams[key].value);
    }
  }

  const warnEl = document.getElementById('warning');
  if (selPart) {
    const problems = SHAPE_DEFS[selPart.type].validate(selPart.params);
    if (problems.length) { warnEl.style.display = 'block'; warnEl.textContent = problems.join(' '); }
    else warnEl.style.display = 'none';
  } else warnEl.style.display = 'none';

  const svg = document.getElementById('sheet');
  const viewportW = svg.clientWidth || 900, viewportH = svg.clientHeight || 700;
  const viewW = viewportW / cam.zoom, viewH = viewportH / cam.zoom;
  svg.setAttribute('viewBox', `${cam.x} ${cam.y} ${viewW} ${viewH}`);
  svg.innerHTML = '';

  const defs = svgEl('defs', {});
  const grad = svgEl('radialGradient', { id: 'dragHandleGradient', cx: '35%', cy: '35%', r: '70%' });
  grad.appendChild(svgEl('stop', { offset: '0%', 'stop-color': '#ffe14d' }));
  grad.appendChild(svgEl('stop', { offset: '100%', 'stop-color': '#d62828' }));
  defs.appendChild(grad);
  svg.appendChild(defs);

  // grid — fixed to the world, independent of every part's position
  const gridGroup = svgEl('g', {});
  let minorWorld = gridSizeMm * scale;
  while (minorWorld * cam.zoom < 8) minorWorld *= GRID_MAJOR_EVERY;
  const left = cam.x, right = cam.x + viewW, top = cam.y, bottom = cam.y + viewH;
  const startXi = Math.floor(left / minorWorld) - 1, endXi = Math.ceil(right / minorWorld) + 1;
  const startYi = Math.floor(top / minorWorld) - 1, endYi = Math.ceil(bottom / minorWorld) + 1;
  const gsMinor = 1 / cam.zoom, gsMajor = 1.4 / cam.zoom;
  for (let i = startXi; i <= endXi; i++) {
    const x = i * minorWorld, isMajor = i % GRID_MAJOR_EVERY === 0;
    gridGroup.appendChild(svgEl('line', { class: isMajor ? 'grid-major' : 'grid-minor', x1: x, y1: top, x2: x, y2: bottom, 'stroke-width': isMajor ? gsMajor : gsMinor }));
  }
  for (let i = startYi; i <= endYi; i++) {
    const y = i * minorWorld, isMajor = i % GRID_MAJOR_EVERY === 0;
    gridGroup.appendChild(svgEl('line', { class: isMajor ? 'grid-major' : 'grid-minor', x1: left, y1: y, x2: right, y2: y, 'stroke-width': isMajor ? gsMajor : gsMinor }));
  }
  svg.appendChild(gridGroup);

  // draw every placed part
  parts.forEach(part => {
    const def = SHAPE_DEFS[part.type];
    const selected = part.id === selectedPartId;
    const fg = svgEl('g', {});
    svg.appendChild(fg);
    const fh = def.renderFront(part, fg, selected);
    part.frontHandle = fh;
    addDragHandle(fg, fh.x, fh.y, part, part.frontPos);

    if (part.extruded && def.supportsExtrude) {
      if (!part.sidePos) part.sidePos = def.computeSideSpawnPos(part);
      const sg = svgEl('g', {});
      svg.appendChild(sg);
      const sh = def.renderSide(part, sg, selected);
      part.sideHandle = sh;
      addDragHandle(sg, sh.x, sh.y, part, part.sidePos);
    } else {
      part.sideHandle = null;
    }
  });

  const scale2 = WORLD_PX_PER_MM;

  measurements.forEach(m => {
    const x1 = m.x1 * scale2, y1 = m.y1 * scale2, x2 = m.x2 * scale2, y2 = m.y2 * scale2;
    const mg = svgEl('g', {});
    svg.appendChild(mg);
    // wide, nearly-invisible hit area so the line itself is the grab target — no dot needed
    const hit = svgEl('line', { x1, y1, x2, y2, stroke: '#d62828', 'stroke-width': 10 / cam.zoom, 'stroke-opacity': 0.001, 'pointer-events': 'stroke' });
    hit.style.cursor = 'grab';
    hit.addEventListener('pointerdown', (e) => beginAnnotDrag('measure', m.id, e));
    mg.appendChild(hit);
    mg.appendChild(svgEl('line', { x1, y1, x2, y2, stroke: '#d62828', 'stroke-width': DIMLINE_W * 1.6, 'stroke-dasharray': (4 / cam.zoom) + ' ' + (2 / cam.zoom), 'pointer-events': 'none' }));
    mg.appendChild(svgEl('circle', { cx: x1, cy: y1, r: 3 / cam.zoom, fill: '#d62828', stroke: 'none', 'pointer-events': 'none' }));
    mg.appendChild(svgEl('circle', { cx: x2, cy: y2, r: 3 / cam.zoom, fill: '#d62828', stroke: 'none', 'pointer-events': 'none' }));
    const distMm = Math.hypot(m.x2 - m.x1, m.y2 - m.y1);
    const midX = (x1 + x2) / 2, midY = (y1 + y2) / 2;
    const t = svgEl('text', { class: 'dim-text', x: midX, y: midY - 10 / cam.zoom, 'text-anchor': 'middle', fill: '#d62828' });
    t.textContent = fmtClean(distMm);
    mg.appendChild(t);
  });

  angleMeasurements.forEach(a => {
    const w = a.points.map(p => ({ x: p.x * scale2, y: p.y * scale2 }));
    const ag = svgEl('g', {});
    svg.appendChild(ag);
    const hit = svgEl('polyline', { points: `${w[0].x},${w[0].y} ${w[1].x},${w[1].y} ${w[2].x},${w[2].y}`, fill: 'none', stroke: '#d62828', 'stroke-width': 10 / cam.zoom, 'stroke-opacity': 0.001, 'pointer-events': 'stroke' });
    hit.style.cursor = 'grab';
    hit.addEventListener('pointerdown', (e) => beginAnnotDrag('angle', a.id, e));
    ag.appendChild(hit);
    w.forEach(pt => ag.appendChild(svgEl('circle', { cx: pt.x, cy: pt.y, r: 3 / cam.zoom, fill: '#d62828', stroke: 'none', 'pointer-events': 'none' })));
    ag.appendChild(svgEl('line', { x1: w[1].x, y1: w[1].y, x2: w[0].x, y2: w[0].y, stroke: '#d62828', 'stroke-width': DIMLINE_W * 1.4, 'pointer-events': 'none' }));
    ag.appendChild(svgEl('line', { x1: w[1].x, y1: w[1].y, x2: w[2].x, y2: w[2].y, stroke: '#d62828', 'stroke-width': DIMLINE_W * 1.4, 'pointer-events': 'none' }));

    const v1 = { x: a.points[0].x - a.points[1].x, y: a.points[0].y - a.points[1].y };
    const v2 = { x: a.points[2].x - a.points[1].x, y: a.points[2].y - a.points[1].y };
    const mag1 = Math.hypot(v1.x, v1.y), mag2 = Math.hypot(v2.x, v2.y);
    let angleDeg = 0;
    if (mag1 > 0 && mag2 > 0) {
      const cos = Math.min(1, Math.max(-1, (v1.x * v2.x + v1.y * v2.y) / (mag1 * mag2)));
      angleDeg = Math.acos(cos) * (180 / Math.PI);
    }
    const t2 = svgEl('text', { class: 'dim-text', x: w[1].x, y: w[1].y - 14 / cam.zoom, 'text-anchor': 'middle', fill: '#d62828' });
    t2.textContent = angleDeg.toFixed(1) + '°';
    ag.appendChild(t2);
  });

  // in-progress angle preview (before the 3rd click finalizes it) — no dots, just the first leg once available
  if (anglePoints.length === 2) {
    const w0 = { x: anglePoints[0].x * scale2, y: anglePoints[0].y * scale2 };
    const w1 = { x: anglePoints[1].x * scale2, y: anglePoints[1].y * scale2 };
    const ag = svgEl('g', {});
    svg.appendChild(ag);
    ag.appendChild(svgEl('circle', { cx: w0.x, cy: w0.y, r: 3 / cam.zoom, fill: '#d62828', stroke: 'none' }));
    ag.appendChild(svgEl('circle', { cx: w1.x, cy: w1.y, r: 3 / cam.zoom, fill: '#d62828', stroke: 'none' }));
    ag.appendChild(svgEl('line', { x1: w1.x, y1: w1.y, x2: w0.x, y2: w0.y, stroke: '#d62828', 'stroke-width': DIMLINE_W * 1.4, 'stroke-dasharray': (4 / cam.zoom) + ' ' + (2 / cam.zoom) }));
  }
}

// ---- pan / drag-to-move-part / pinch-to-zoom (touch) ----
const svgEl0 = document.getElementById('sheet');
let panState = null;
let dragState = null;
const activePointers = new Map(); // pointerId -> {x,y}, tracked for pinch-zoom
let pinchState = null;

svgEl0.addEventListener('pointerdown', (e) => {
  activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

  if (activePointers.size === 2) {
    // second finger just landed — drop any single-finger action and start a pinch
    panState = null; dragState = null; measureDrag = null; annotDrag = null;
    svgEl0.classList.remove('panning');
    const pts = Array.from(activePointers.values());
    const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
    const midX = (pts[0].x + pts[1].x) / 2, midY = (pts[0].y + pts[1].y) / 2;
    const rect = svgEl0.getBoundingClientRect();
    pinchState = {
      startDist: dist,
      startZoom: cam.zoom,
      worldX: cam.x + (midX - rect.left) / cam.zoom,
      worldY: cam.y + (midY - rect.top) / cam.zoom,
    };
    return;
  }
  if (activePointers.size > 2) return; // ignore a 3rd+ finger

  if (e.button !== 0) return;
  if (angleMode) {
    const rect = svgEl0.getBoundingClientRect();
    const offsetX = e.clientX - rect.left, offsetY = e.clientY - rect.top;
    const worldX = cam.x + offsetX / cam.zoom, worldY = cam.y + offsetY / cam.zoom;
    const mmX = Math.round((worldX / WORLD_PX_PER_MM) / gridSizeMm) * gridSizeMm;
    const mmY = Math.round((worldY / WORLD_PX_PER_MM) / gridSizeMm) * gridSizeMm;
    anglePoints.push({ x: mmX, y: mmY });
    if (anglePoints.length === 3) {
      angleMeasurements.push({ id: 'a' + (angleIdCounter++), points: anglePoints.map(p => ({ ...p })) });
      anglePoints = [];
    }
    render();
    return;
  }
  if (measureMode) {
    const rect = svgEl0.getBoundingClientRect();
    const offsetX = e.clientX - rect.left, offsetY = e.clientY - rect.top;
    const worldX = cam.x + offsetX / cam.zoom, worldY = cam.y + offsetY / cam.zoom;
    const mmX = Math.round((worldX / WORLD_PX_PER_MM) / gridSizeMm) * gridSizeMm;
    const mmY = Math.round((worldY / WORLD_PX_PER_MM) / gridSizeMm) * gridSizeMm;
    const id = 'm' + (measureIdCounter++);
    measurements.push({ id, x1: mmX, y1: mmY, x2: mmX, y2: mmY });
    measureDrag = id;
    render();
    return;
  }
  panState = { startClientX: e.clientX, startClientY: e.clientY, startCamX: cam.x, startCamY: cam.y };
  svgEl0.classList.add('panning');
});
window.addEventListener('pointermove', (e) => {
  if (activePointers.has(e.pointerId)) activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

  if (pinchState && activePointers.size === 2) {
    const pts = Array.from(activePointers.values());
    const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
    cam.zoom = Math.min(30, Math.max(0.05, pinchState.startZoom * (dist / pinchState.startDist)));
    const midX = (pts[0].x + pts[1].x) / 2, midY = (pts[0].y + pts[1].y) / 2;
    const rect = svgEl0.getBoundingClientRect();
    cam.x = pinchState.worldX - (midX - rect.left) / cam.zoom;
    cam.y = pinchState.worldY - (midY - rect.top) / cam.zoom;
    render();
    return;
  }

  if (annotDrag) {
    const scale = WORLD_PX_PER_MM;
    const dxMm = (e.clientX - annotDrag.startClientX) / cam.zoom / scale;
    const dyMm = (e.clientY - annotDrag.startClientY) / cam.zoom / scale;
    if (annotDrag.kind === 'measure') {
      const entry = measurements.find(m => m.id === annotDrag.id);
      if (entry) {
        entry.x1 = annotDrag.startPoints[0].x + dxMm; entry.y1 = annotDrag.startPoints[0].y + dyMm;
        entry.x2 = annotDrag.startPoints[1].x + dxMm; entry.y2 = annotDrag.startPoints[1].y + dyMm;
      }
    } else {
      const entry = angleMeasurements.find(a => a.id === annotDrag.id);
      if (entry) entry.points = annotDrag.startPoints.map(p => ({ x: p.x + dxMm, y: p.y + dyMm }));
    }
    document.getElementById('controls').classList.toggle('drop-delete', isOverControls(e));
    render();
    return;
  }
  if (measureDrag) {
    const rect = svgEl0.getBoundingClientRect();
    const offsetX = e.clientX - rect.left, offsetY = e.clientY - rect.top;
    const worldX = cam.x + offsetX / cam.zoom, worldY = cam.y + offsetY / cam.zoom;
    const entry = measurements.find(m => m.id === measureDrag);
    if (entry) {
      entry.x2 = Math.round((worldX / WORLD_PX_PER_MM) / gridSizeMm) * gridSizeMm;
      entry.y2 = Math.round((worldY / WORLD_PX_PER_MM) / gridSizeMm) * gridSizeMm;
    }
    render();
    return;
  }
  if (dragState) {
    const scale = WORLD_PX_PER_MM;
    const dxScreen = e.clientX - dragState.startClientX, dyScreen = e.clientY - dragState.startClientY;
    dragState.posObj.x = dragState.startX + (dxScreen / cam.zoom) / scale;
    dragState.posObj.y = dragState.startY + (dyScreen / cam.zoom) / scale;
    document.getElementById('controls').classList.toggle('drop-delete', isOverControls(e));
    render();
    return;
  }
  if (panState) {
    const dxScreen = e.clientX - panState.startClientX, dyScreen = e.clientY - panState.startClientY;
    cam.x = panState.startCamX - dxScreen / cam.zoom;
    cam.y = panState.startCamY - dyScreen / cam.zoom;
    render();
  }
});
function handlePointerUp(e) {
  activePointers.delete(e.pointerId);
  if (pinchState) {
    if (activePointers.size < 2) pinchState = null;
    return;
  }
  if (annotDrag) {
    document.getElementById('controls').classList.remove('drop-delete');
    if (isOverControls(e)) {
      if (annotDrag.kind === 'measure') measurements = measurements.filter(m => m.id !== annotDrag.id);
      else angleMeasurements = angleMeasurements.filter(a => a.id !== annotDrag.id);
    } else {
      if (annotDrag.kind === 'measure') {
        const entry = measurements.find(m => m.id === annotDrag.id);
        if (entry) {
          entry.x1 = Math.round(entry.x1 / gridSizeMm) * gridSizeMm; entry.y1 = Math.round(entry.y1 / gridSizeMm) * gridSizeMm;
          entry.x2 = Math.round(entry.x2 / gridSizeMm) * gridSizeMm; entry.y2 = Math.round(entry.y2 / gridSizeMm) * gridSizeMm;
        }
      } else {
        const entry = angleMeasurements.find(a => a.id === annotDrag.id);
        if (entry) entry.points = entry.points.map(p => ({ x: Math.round(p.x / gridSizeMm) * gridSizeMm, y: Math.round(p.y / gridSizeMm) * gridSizeMm }));
      }
    }
    annotDrag = null;
    render();
    return;
  }
  if (measureDrag) { measureDrag = null; return; }
  if (dragState) {
    document.getElementById('controls').classList.remove('drop-delete');
    if (isOverControls(e)) {
      deletePart(dragState.partId);
    } else {
      const p = dragState.posObj;
      p.x = Math.round(p.x / gridSizeMm) * gridSizeMm;
      p.y = Math.round(p.y / gridSizeMm) * gridSizeMm;
      render();
    }
    dragState = null;
  }
  panState = null;
  svgEl0.classList.remove('panning');
}
window.addEventListener('pointerup', handlePointerUp);
window.addEventListener('pointercancel', handlePointerUp);

// ---- zoom, centered on cursor ----
svgEl0.addEventListener('wheel', (e) => {
  e.preventDefault();
  const rect = svgEl0.getBoundingClientRect();
  const offsetX = e.clientX - rect.left, offsetY = e.clientY - rect.top;
  const worldX = cam.x + offsetX / cam.zoom, worldY = cam.y + offsetY / cam.zoom;
  cam.zoom *= e.deltaY < 0 ? 1.12 : 0.89;
  cam.zoom = Math.min(30, Math.max(0.05, cam.zoom));
  cam.x = worldX - offsetX / cam.zoom;
  cam.y = worldY - offsetY / cam.zoom;
  render();
}, { passive: false });
window.addEventListener('resize', render);

// ---- parts drawer (SFS-style pull-out) ----
function toggleControlsMobile() {
  document.getElementById('controls').classList.toggle('open');
  document.getElementById('controlsOverlay').classList.toggle('open');
}

function toggleDrawer() { document.getElementById('partsDrawerWrap').classList.toggle('open'); }
function buildDrawer() {
  const inner = document.getElementById('partsDrawerInner');
  inner.innerHTML = '';
  const categories = {};
  for (const type in SHAPE_DEFS) {
    const def = SHAPE_DEFS[type];
    const cat = def.category || 'Other';
    if (!categories[cat]) categories[cat] = [];
    categories[cat].push(type);
  }
  for (const cat in categories) {
    const header = document.createElement('div');
    header.className = 'drawer-category';
    header.textContent = cat;
    inner.appendChild(header);
    categories[cat].forEach(type => {
      const def = SHAPE_DEFS[type];
      const item = document.createElement('div');
      item.className = 'drawer-item';
      item.innerHTML = `<div class="item-label">${def.label}</div>${def.thumbnail}`;
      item.addEventListener('pointerdown', (e) => { e.preventDefault(); beginSpawn(type, e); });
      inner.appendChild(item);
    });
  }
}

let spawning = null;
function beginSpawn(type, e) {
  spawning = { type };
  const ghost = document.getElementById('spawnGhost');
  ghost.textContent = SHAPE_DEFS[type].label;
  ghost.style.display = 'block';
  ghost.style.left = (e.clientX + 14) + 'px';
  ghost.style.top = (e.clientY + 14) + 'px';
}
window.addEventListener('pointermove', (e) => {
  if (!spawning) return;
  const ghost = document.getElementById('spawnGhost');
  ghost.style.left = (e.clientX + 14) + 'px';
  ghost.style.top = (e.clientY + 14) + 'px';
});
window.addEventListener('pointerup', (e) => {
  if (!spawning) return;
  const ghost = document.getElementById('spawnGhost');
  ghost.style.display = 'none';
  const rect = svgEl0.getBoundingClientRect();
  const overCanvas = e.clientX >= rect.left && e.clientX <= rect.right && e.clientY >= rect.top && e.clientY <= rect.bottom;
  if (overCanvas) {
    const offsetX = e.clientX - rect.left, offsetY = e.clientY - rect.top;
    const worldX = cam.x + offsetX / cam.zoom, worldY = cam.y + offsetY / cam.zoom;
    let mmX = worldX / WORLD_PX_PER_MM, mmY = worldY / WORLD_PX_PER_MM;
    mmX = Math.round(mmX / gridSizeMm) * gridSizeMm;
    mmY = Math.round(mmY / gridSizeMm) * gridSizeMm;
    const part = makePart(spawning.type, mmX, mmY);
    parts.push(part);
    selectPart(part.id);
  }
  spawning = null;
});

buildGridMenuOptions();
buildDrawer();
render();