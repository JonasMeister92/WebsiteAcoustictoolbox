import { distanceAttenuation, levelAtDistance } from './calculations.mjs';

const geometry = document.querySelector('[data-geometry]');
const exponentInput = document.querySelector('[data-exponent]');
const referenceLevelInput = document.querySelector('[data-reference-level]');
const referenceDistanceInput = document.querySelector('[data-reference-distance]');
const targetDistanceInput = document.querySelector('[data-target-distance]');
const chart = document.querySelector('[data-distance-chart]');

function exponent() { return geometry.value === 'custom' ? Number(exponentInput.value) : Number(geometry.value); }
function svgElement(tag, attributes = {}) { const element = document.createElementNS('http://www.w3.org/2000/svg', tag); Object.entries(attributes).forEach(([key, value]) => element.setAttribute(key, value)); return element; }
function niceStep(range) { const rough = range / 5; const magnitude = 10 ** Math.floor(Math.log10(rough)); const fraction = rough / magnitude; return (fraction <= 1 ? 1 : fraction <= 2 ? 2 : fraction <= 5 ? 5 : 10) * magnitude; }
function distanceLabel(value) { return value >= 1000 ? `${Number((value / 1000).toPrecision(3))} km` : `${Number(value.toPrecision(3))} m`; }

function drawChart(referenceLevel, referenceDistance, targetDistance, n) {
  chart.replaceChildren();
  const left = 70, right = 970, top = 25, bottom = 300;
  const minimumDistance = Math.max(.001, Math.min(referenceDistance, targetDistance) / 2);
  const maximumDistance = Math.max(referenceDistance, targetDistance) * 2;
  const logMin = Math.log10(minimumDistance), logMax = Math.log10(maximumDistance);
  const samples = Array.from({ length: 121 }, (_, index) => 10 ** (logMin + index / 120 * (logMax - logMin)));
  const levels = samples.map((distance) => levelAtDistance(referenceLevel, referenceDistance, distance, n));
  const levelMin = Math.floor((Math.min(...levels) - 3) / 5) * 5;
  const levelMax = Math.ceil((Math.max(...levels) + 3) / 5) * 5;
  const x = (distance) => left + (Math.log10(distance) - logMin) / (logMax - logMin) * (right - left);
  const y = (level) => bottom - (level - levelMin) / (levelMax - levelMin) * (bottom - top);
  const yStep = niceStep(levelMax - levelMin);
  for (let level = Math.ceil(levelMin / yStep) * yStep; level <= levelMax; level += yStep) { const py = y(level); chart.append(svgElement('line', { x1:left, y1:py, x2:right, y2:py, class:'chart-gridline' })); const label = svgElement('text', { x:left-10, y:py+4, 'text-anchor':'end', class:'chart-label' }); label.textContent = level; chart.append(label); }
  for (let index = 0; index <= 6; index += 1) { const distance = 10 ** (logMin + index / 6 * (logMax - logMin)); const px = x(distance); chart.append(svgElement('line', { x1:px, y1:top, x2:px, y2:bottom, class:'chart-gridline' })); const label = svgElement('text', { x:px, y:325, 'text-anchor':'middle', class:'chart-label' }); label.textContent = distanceLabel(distance); chart.append(label); }
  const path = svgElement('path', { d: samples.map((distance,index) => `${index ? 'L':'M'}${x(distance).toFixed(2)},${y(levels[index]).toFixed(2)}`).join(' '), class:'distance-curve' }); chart.append(path);
  [[referenceDistance, referenceLevel, 'Reference'],[targetDistance, levelAtDistance(referenceLevel,referenceDistance,targetDistance,n), 'Target']].forEach(([distance,level,labelText]) => { chart.append(svgElement('circle',{cx:x(distance),cy:y(level),r:7,class:'distance-marker'})); const label=svgElement('text',{x:x(distance),y:y(level)-14,'text-anchor':'middle',class:'distance-marker-label'}); label.textContent=`${labelText}: ${level.toFixed(1)} dB`; chart.append(label); });
  const yTitle=svgElement('text',{x:17,y:165,transform:'rotate(-90 17 165)','text-anchor':'middle',class:'chart-title'}); yTitle.textContent='Sound pressure level (dB)'; chart.append(yTitle);
  const xTitle=svgElement('text',{x:520,y:352,'text-anchor':'middle',class:'chart-title'}); xTitle.textContent='Distance'; chart.append(xTitle);
}

function update() {
  const referenceLevel = Number(referenceLevelInput.value), referenceDistance = Number(referenceDistanceInput.value), targetDistance = Number(targetDistanceInput.value), n = exponent();
  try {
    const change = distanceAttenuation(referenceDistance, targetDistance, n);
    document.querySelector('[data-target-level]').textContent = levelAtDistance(referenceLevel, referenceDistance, targetDistance, n).toFixed(2);
    document.querySelector('[data-level-change]').textContent = `${change >= 0 ? '−' : '+'}${Math.abs(change).toFixed(2)} dB`;
    document.querySelector('[data-error]').textContent = '';
    drawChart(referenceLevel, referenceDistance, targetDistance, n);
  } catch (error) { document.querySelector('[data-target-level]').textContent = '—'; document.querySelector('[data-level-change]').textContent = '—'; document.querySelector('[data-error]').textContent = error.message; chart.replaceChildren(); }
}

geometry.addEventListener('input', () => { document.querySelector('.custom-exponent').hidden = geometry.value !== 'custom'; update(); });
[exponentInput,referenceLevelInput,referenceDistanceInput,targetDistanceInput].forEach((input) => input.addEventListener('input', update));
update();
