import { THIRD_OCTAVE_BANDS, propagateBand, aWeightedTotal, geometricDivergence } from './outdoor-propagation.mjs';

const state = {
  source: { x: 10, y: 2 }, receiver: { x: 80, y: 1.5 },
  barriers: [{ id: 1, x: 45, height: 4 }], nextBarrierId: 2,
  environment: { temperatureC: 20, humidityPercent: 70, pressureKPa: 101.325 },
  groundFactor: 1, sourceMode: 'noise', toneFrequency: 1000, toneLevel: 100,
  sourceLevels: [88,89,90,92,94,96,98,99,100,101,102,102,102,102,101,100,99,98,97,95,93,91,88,85]
};

const scene = document.querySelector('.propagation-scene');
const plot = { left: 58, right: 958, top: 20, ground: 280, xMax: 100, yMax: 20 };

function niceAxisMaximum(value, defaultMaximum) {
  if (!Number.isFinite(value) || value <= defaultMaximum) return defaultMaximum;
  const padded = value * 1.08;
  const roughStep = padded / 8;
  const magnitude = 10 ** Math.floor(Math.log10(roughStep));
  const fraction = roughStep / magnitude;
  const niceFraction = fraction <= 1 ? 1 : fraction <= 2 ? 2 : fraction <= 2.5 ? 2.5 : fraction <= 5 ? 5 : 10;
  const step = niceFraction * magnitude;
  return Math.ceil(padded / step) * step;
}

function updateAxisRanges() {
  plot.xMax = niceAxisMaximum(Math.max(state.source.x, state.receiver.x, ...state.barriers.map((barrier) => barrier.x)), 100);
  plot.yMax = niceAxisMaximum(Math.max(state.source.y, state.receiver.y, ...state.barriers.map((barrier) => barrier.height)), 20);
}

const sx = (x) => plot.left + x / plot.xMax * (plot.right - plot.left);
const sy = (height) => plot.ground - height / plot.yMax * (plot.ground - plot.top);
const wx = (x) => Math.max(0, (x - plot.left) / (plot.right - plot.left) * plot.xMax);
const wy = (y) => Math.max(.1, (plot.ground - y) / (plot.ground - plot.top) * plot.yMax);

function axisLabel(value, maximum) {
  if (maximum >= 1000) return `${Number((value / 1000).toFixed(2))} km`;
  return `${Number(value.toFixed(1))} m`;
}

function activeBands() {
  if (state.sourceMode === 'tone') return [{ frequencyHz: state.toneFrequency, sourceLevel: state.toneLevel }];
  return THIRD_OCTAVE_BANDS.map((frequencyHz, index) => ({ frequencyHz, sourceLevel: state.sourceLevels[index] }));
}

function calculate() {
  return activeBands().map(({ frequencyHz, sourceLevel }) => propagateBand({ sourceLevel, frequencyHz, source: state.source, receiver: state.receiver, environment: state.environment, groundFactor: state.groundFactor, barriers: state.barriers }));
}

function pathElement(tag, attributes = {}) {
  const element = document.createElementNS('http://www.w3.org/2000/svg', tag);
  Object.entries(attributes).forEach(([name, value]) => element.setAttribute(name, value));
  return element;
}

function renderScene() {
  updateAxisRanges();
  const source = scene.querySelector('[data-object="source"]');
  const receiver = scene.querySelector('[data-object="receiver"]');
  source.setAttribute('transform', `translate(${sx(state.source.x)} ${sy(state.source.y)})`);
  receiver.setAttribute('transform', `translate(${sx(state.receiver.x)} ${sy(state.receiver.y)})`);
  const paths = scene.querySelector('[data-paths]'); paths.replaceChildren();
  paths.append(pathElement('line', { x1: sx(state.source.x), y1: sy(state.source.y), x2: sx(state.receiver.x), y2: sy(state.receiver.y), class: 'direct-path' }));
  state.barriers.forEach((barrier) => {
    if (!blocks(barrier)) return;
    paths.append(pathElement('polyline', { points: `${sx(state.source.x)},${sy(state.source.y)} ${sx(barrier.x)},${sy(barrier.height)} ${sx(state.receiver.x)},${sy(state.receiver.y)}`, class: 'diffracted-path' }));
  });
  const barrierGroup = scene.querySelector('[data-barriers]'); barrierGroup.replaceChildren();
  state.barriers.forEach((barrier, index) => {
    const group = pathElement('g', { class: 'barrier-object drag-object', 'data-barrier-id': barrier.id, role: 'button', tabindex: '0', 'aria-label': `Noise barrier ${index + 1}, draggable` });
    group.append(pathElement('line', { x1: sx(barrier.x), y1: plot.ground, x2: sx(barrier.x), y2: sy(barrier.height) }));
    group.append(pathElement('circle', { cx: sx(barrier.x), cy: sy(barrier.height), r: 9 }));
    const text = pathElement('text', { x: sx(barrier.x), y: sy(barrier.height) - 16 }); text.textContent = `B${index + 1}`; group.append(text);
    barrierGroup.append(group);
  });
  const grid = scene.querySelector('[data-grid]'); grid.replaceChildren();
  const axis = scene.querySelector('[data-axis]'); axis.replaceChildren();
  for (let index = 0; index <= 10; index += 1) {
    const value = plot.xMax * index / 10;
    grid.append(pathElement('line', { x1: sx(value), y1: plot.top, x2: sx(value), y2: plot.ground }));
    const text = pathElement('text', { x: sx(value), y: 334, 'text-anchor': 'middle' }); text.textContent = axisLabel(value, plot.xMax); axis.append(text);
  }
  for (let index = 0; index <= 5; index += 1) {
    const value = plot.yMax * index / 5;
    grid.append(pathElement('line', { x1: plot.left, y1: sy(value), x2: plot.right, y2: sy(value) }));
    if (index === 0) continue;
    const text = pathElement('text', { x: plot.left - 8, y: sy(value) + 4, 'text-anchor': 'end' }); text.textContent = axisLabel(value, plot.yMax); axis.append(text);
  }
}

function blocks(barrier) {
  if (barrier.x <= Math.min(state.source.x, state.receiver.x) || barrier.x >= Math.max(state.source.x, state.receiver.x)) return false;
  const lineHeight = state.source.y + (state.receiver.y - state.source.y) * (barrier.x - state.source.x) / (state.receiver.x - state.source.x);
  return barrier.height >= lineHeight;
}

function attachDrag(element, type, id) {
  element.addEventListener('pointerdown', (event) => {
    event.preventDefault(); element.setPointerCapture(event.pointerId); element.classList.add('dragging');
    const move = (moveEvent) => {
      const point = scene.createSVGPoint(); point.x = moveEvent.clientX; point.y = moveEvent.clientY;
      const local = point.matrixTransform(scene.getScreenCTM().inverse());
      if (type === 'source' || type === 'receiver') { state[type].x = wx(local.x); state[type].y = wy(local.y); }
      else { const barrier = state.barriers.find((item) => item.id === id); barrier.x = wx(local.x); barrier.height = wy(local.y); }
      syncFields(); render();
    };
    const up = () => { element.classList.remove('dragging'); element.removeEventListener('pointermove', move); element.removeEventListener('pointerup', up); };
    element.addEventListener('pointermove', move); element.addEventListener('pointerup', up);
  });
}

function attachBarrierDragging() {
  scene.addEventListener('pointerdown', (event) => {
    const element = event.target.closest('[data-barrier-id]');
    if (!element) return;
    event.preventDefault();
    const id = Number(element.dataset.barrierId);
    scene.setPointerCapture(event.pointerId);
    element.classList.add('dragging');
    const move = (moveEvent) => {
      const point = scene.createSVGPoint(); point.x = moveEvent.clientX; point.y = moveEvent.clientY;
      const local = point.matrixTransform(scene.getScreenCTM().inverse());
      const barrier = state.barriers.find((item) => item.id === id);
      if (!barrier) return;
      barrier.x = wx(local.x); barrier.height = wy(local.y);
      syncFields(); render();
    };
    const up = () => {
      if (scene.hasPointerCapture(event.pointerId)) scene.releasePointerCapture(event.pointerId);
      scene.removeEventListener('pointermove', move);
      scene.removeEventListener('pointerup', up);
      scene.removeEventListener('pointercancel', up);
    };
    scene.addEventListener('pointermove', move);
    scene.addEventListener('pointerup', up);
    scene.addEventListener('pointercancel', up);
  });
}

function syncFields() {
  document.querySelectorAll('[data-coordinate]').forEach((field) => { const [object, key] = field.dataset.coordinate.split('.'); field.value = state[object][key].toFixed(1); });
  document.querySelectorAll('[data-barrier-x]').forEach((field) => { field.value = state.barriers.find((item) => item.id === Number(field.dataset.barrierX))?.x.toFixed(1) ?? ''; });
  document.querySelectorAll('[data-barrier-height]').forEach((field) => { field.value = state.barriers.find((item) => item.id === Number(field.dataset.barrierHeight))?.height.toFixed(1) ?? ''; });
}

function renderBarrierControls() {
  const container = document.querySelector('[data-barrier-controls]'); container.replaceChildren();
  state.barriers.forEach((barrier, index) => {
    const row = document.createElement('div'); row.className = 'barrier-control-row';
    row.innerHTML = `<strong>Barrier ${index + 1}</strong><label class="field"><span>Position</span><span class="input-unit"><input type="number" min="0" step="0.1" data-barrier-x="${barrier.id}" value="${barrier.x}"><span>m</span></span></label><label class="field"><span>Height</span><span class="input-unit"><input type="number" min="0.1" step="0.1" data-barrier-height="${barrier.id}" value="${barrier.height}"><span>m</span></span></label><button class="remove-barrier" type="button" aria-label="Remove barrier ${index + 1}" data-remove-barrier="${barrier.id}">Remove</button>`;
    row.querySelector('[data-barrier-x]').addEventListener('input', (event) => { barrier.x = Number(event.target.value); render(); });
    row.querySelector('[data-barrier-height]').addEventListener('input', (event) => { barrier.height = Number(event.target.value); render(); });
    row.querySelector('[data-remove-barrier]').addEventListener('click', () => { state.barriers = state.barriers.filter((item) => item.id !== barrier.id); renderBarrierControls(); render(); });
    container.append(row);
  });
  document.querySelector('[data-add-barrier]').disabled = state.barriers.length >= 3;
}

function createBandTable() {
  const body = document.querySelector('[data-band-table]');
  THIRD_OCTAVE_BANDS.forEach((frequency, index) => {
    const row = document.createElement('tr'); row.dataset.frequency = frequency;
    row.innerHTML = `<th>${frequency >= 1000 ? `${frequency / 1000}k` : frequency} Hz</th><td><label class="spectrum-input"><input type="number" step="0.1" value="${state.sourceLevels[index]}" aria-label="Source level at ${frequency} Hz"><span>dB</span></label></td><td data-cell="divergence">—</td><td data-cell="atmosphere">—</td><td data-cell="ground">—</td><td data-cell="barrier">—</td><td data-cell="receiver">—</td>`;
    row.querySelector('input').addEventListener('input', (event) => { state.sourceLevels[index] = Number(event.target.value); render(false); });
    row.addEventListener('mouseenter', () => showDetail(frequency)); row.addEventListener('focusin', () => showDetail(frequency));
    body.append(row);
  });
}

function renderTable(results) {
  THIRD_OCTAVE_BANDS.forEach((frequency) => {
    const row = document.querySelector(`tr[data-frequency="${frequency}"]`);
    const result = results.find((item) => item.frequencyHz === frequency);
    row.hidden = state.sourceMode === 'tone' && frequency !== state.toneFrequency;
    if (!result) return;
    row.querySelector('[data-cell="divergence"]').textContent = result.divergence.toFixed(1);
    row.querySelector('[data-cell="atmosphere"]').textContent = result.atmosphere.toFixed(1);
    row.querySelector('[data-cell="ground"]').textContent = result.ground.toFixed(1);
    row.querySelector('[data-cell="barrier"]').textContent = result.barrier.toFixed(1);
    row.querySelector('[data-cell="receiver"]').textContent = result.receiverLevel.toFixed(1);
  });
}

let lastResults = [];
function showDetail(frequency) {
  const result = lastResults.find((item) => item.frequencyHz === frequency); if (!result) return;
  document.querySelector('[data-band-detail]').textContent = `${frequency} Hz · Lp ${result.receiverLevel.toFixed(1)} dB · Adiv ${result.divergence.toFixed(1)} · Aatm ${result.atmosphere.toFixed(1)} · Agr ${result.ground.toFixed(1)} · Abar ${result.barrier.toFixed(1)} dB${result.fresnelNumber ? ` · N ${result.fresnelNumber.toFixed(2)}` : ''}`;
}

function renderChart(results) {
  const chart = document.querySelector('[data-chart]'); chart.replaceChildren();
  const left = 58, right = 980, top = 24, bottom = 285, minimum = 20, maximum = 120;
  for (let level = 20; level <= 120; level += 20) {
    const y = bottom - (level - minimum) / (maximum - minimum) * (bottom - top);
    chart.append(pathElement('line', { x1: left, y1: y, x2: right, y2: y, class: 'chart-gridline' }));
    const label = pathElement('text', { x: left - 10, y: y + 4, 'text-anchor': 'end', class: 'chart-label' }); label.textContent = level; chart.append(label);
  }
  const width = (right - left) / results.length;
  results.forEach((result, index) => {
    const x = left + index * width + width * .12;
    const sourceY = bottom - (result.sourceLevel - minimum) / (maximum - minimum) * (bottom - top);
    const receiverY = bottom - (result.receiverLevel - minimum) / (maximum - minimum) * (bottom - top);
    chart.append(pathElement('rect', { x, y: Math.max(top, sourceY), width: width * .32, height: Math.max(0, bottom - Math.max(top, sourceY)), class: 'bar-source' }));
    const receiverBar = pathElement('rect', { x: x + width * .38, y: Math.max(top, receiverY), width: width * .32, height: Math.max(0, bottom - Math.max(top, receiverY)), class: 'bar-receiver', tabindex: 0, role: 'button', 'aria-label': `${result.frequencyHz} hertz, receiver ${result.receiverLevel.toFixed(1)} decibels` });
    receiverBar.addEventListener('mouseenter', () => showDetail(result.frequencyHz)); receiverBar.addEventListener('focus', () => showDetail(result.frequencyHz)); chart.append(receiverBar);
    if (results.length <= 12 || index % 3 === 0) { const label = pathElement('text', { x: x + width * .35, y: 310, 'text-anchor': 'middle', class: 'chart-label' }); label.textContent = result.frequencyHz >= 1000 ? `${result.frequencyHz / 1000}k` : result.frequencyHz; chart.append(label); }
  });
  const yTitle = pathElement('text', { x: 14, y: 165, transform: 'rotate(-90 14 165)', 'text-anchor': 'middle', class: 'chart-title' }); yTitle.textContent = 'Level (dB)'; chart.append(yTitle);
  const xTitle = pathElement('text', { x: 520, y: 328, 'text-anchor': 'middle', class: 'chart-title' }); xTitle.textContent = 'Third-octave centre frequency (Hz)'; chart.append(xTitle);
}

function render(includeScene = true) {
  try {
    lastResults = calculate();
    document.querySelector('[data-error]').textContent = '';
    if (includeScene) renderScene();
    renderChart(lastResults); renderTable(lastResults);
    const total = state.sourceMode === 'noise' ? aWeightedTotal(lastResults) : lastResults[0].receiverLevel;
    document.querySelector('[data-total]').textContent = total.toFixed(1);
    document.querySelector('[data-total-label]').textContent = state.sourceMode === 'noise' ? 'A-weighted broadband level' : `${state.toneFrequency} Hz receiver level`;
    document.querySelector('[data-total-unit]').textContent = state.sourceMode === 'noise' ? 'dB(A)' : 'dB';
    document.querySelector('[data-distance]').textContent = `${lastResults[0].distance.toFixed(1)} m`;
    document.querySelector('[data-divergence]').textContent = `${geometricDivergence(lastResults[0].distance).toFixed(1)} dB`;
    document.querySelector('[data-barrier-count]').textContent = String(state.barriers.length);
  } catch (exception) { document.querySelector('[data-error]').textContent = exception.message; }
}

document.querySelectorAll('[data-coordinate]').forEach((field) => { field.removeAttribute('max'); field.addEventListener('input', () => { const [object, key] = field.dataset.coordinate.split('.'); state[object][key] = Number(field.value); render(); }); });
document.querySelectorAll('[data-environment]').forEach((field) => field.addEventListener('input', () => { state.environment[field.dataset.environment] = Number(field.value); render(false); }));
document.querySelector('[data-ground]').addEventListener('input', (event) => { state.groundFactor = Number(event.target.value); render(false); });
document.querySelector('[data-source-mode]').addEventListener('input', (event) => { state.sourceMode = event.target.value; document.querySelectorAll('.tone-control').forEach((control) => control.hidden = state.sourceMode !== 'tone'); render(false); });
THIRD_OCTAVE_BANDS.forEach((frequency) => { const option = document.createElement('option'); option.value = frequency; option.textContent = `${frequency >= 1000 ? frequency / 1000 + ' kHz' : frequency + ' Hz'}`; option.selected = frequency === 1000; document.querySelector('[data-tone-frequency]').append(option); });
document.querySelector('[data-tone-frequency]').addEventListener('input', (event) => { state.toneFrequency = Number(event.target.value); render(false); });
document.querySelector('[data-tone-level]').addEventListener('input', (event) => { state.toneLevel = Number(event.target.value); render(false); });
document.querySelector('[data-add-barrier]').addEventListener('click', () => { if (state.barriers.length >= 3) return; state.barriers.push({ id: state.nextBarrierId++, x: 30 + state.barriers.length * 18, height: 4 }); renderBarrierControls(); render(); });
document.querySelector('[data-reset]').addEventListener('click', () => { state.source = { x: 10, y: 2 }; state.receiver = { x: 80, y: 1.5 }; state.barriers = [{ id: state.nextBarrierId++, x: 45, height: 4 }]; renderBarrierControls(); syncFields(); render(); });
document.querySelector('[data-copy]').addEventListener('click', async (event) => { const header = 'frequency_Hz,Lw_dB,Adiv_dB,Aatm_dB,Agr_dB,Abar_dB,Lp_dB'; const rows = lastResults.map((r) => [r.frequencyHz,r.sourceLevel,r.divergence,r.atmosphere,r.ground,r.barrier,r.receiverLevel].map((v) => Number(v).toFixed(3)).join(',')); await navigator.clipboard.writeText([header,...rows].join('\n')); event.target.textContent = 'Copied'; setTimeout(() => event.target.textContent = 'Copy results as CSV', 1400); });
attachDrag(scene.querySelector('[data-object="source"]'), 'source'); attachDrag(scene.querySelector('[data-object="receiver"]'), 'receiver'); attachBarrierDragging();
createBandTable(); renderBarrierControls(); render();
