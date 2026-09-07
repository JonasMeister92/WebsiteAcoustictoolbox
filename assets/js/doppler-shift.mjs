import { dopplerFrequency } from './calculations.mjs';

const fields = {
  sourceFrequency: document.querySelector('[data-source-frequency]'),
  soundSpeed: document.querySelector('[data-sound-speed]'),
  sourceSpeed: document.querySelector('[data-source-speed]'),
  receiverSpeed: document.querySelector('[data-receiver-speed]'),
  closestDistance: document.querySelector('[data-closest-distance]'),
  travelSpeed: document.querySelector('[data-travel-speed]'),
  duration: document.querySelector('[data-duration]'),
  waveform: document.querySelector('[data-waveform]')
};
const passbyButton = document.querySelector('[data-passby]');
let audioContext;
let activeAudio;

const value = (field) => Number(field.value);
const svgElement = (tag, attributes = {}) => {
  const element = document.createElementNS('http://www.w3.org/2000/svg', tag);
  Object.entries(attributes).forEach(([key, item]) => element.setAttribute(key, item));
  return element;
};
const formatFrequency = (frequency) => `${frequency.toFixed(frequency >= 1000 ? 1 : 2)} Hz`;

function inputs() {
  return {
    sourceFrequency: value(fields.sourceFrequency), soundSpeed: value(fields.soundSpeed),
    sourceSpeed: value(fields.sourceSpeed), receiverSpeed: value(fields.receiverSpeed),
    closestDistance: value(fields.closestDistance), travelSpeed: value(fields.travelSpeed), duration: value(fields.duration)
  };
}

function validatePassby(settings) {
  if (!(settings.closestDistance > 0)) throw new RangeError('Closest distance must be greater than zero.');
  if (!(settings.travelSpeed > 0 && settings.travelSpeed < settings.soundSpeed)) throw new RangeError('Travel speed must be positive and below the speed of sound.');
  if (!(settings.duration >= 2 && settings.duration <= 20)) throw new RangeError('Duration must be between 2 and 20 seconds.');
}

function passbySamples(settings, count = 241) {
  validatePassby(settings);
  return Array.from({ length: count }, (_, index) => {
    const time = settings.duration * index / (count - 1);
    const alongTrack = settings.travelSpeed * (time - settings.duration / 2);
    const distance = Math.hypot(alongTrack, settings.closestDistance);
    const radialVelocity = -settings.travelSpeed * alongTrack / distance;
    return { time, distance, frequency: dopplerFrequency(settings.sourceFrequency, settings.soundSpeed, 0, radialVelocity) };
  });
}

function drawChart(settings) {
  const chart = document.querySelector('[data-doppler-chart]');
  chart.replaceChildren();
  const samples = passbySamples(settings), left = 75, right = 970, top = 25, bottom = 310;
  const allFrequencies = samples.map((sample) => sample.frequency).concat(settings.sourceFrequency);
  let minimum = Math.min(...allFrequencies), maximum = Math.max(...allFrequencies);
  const padding = Math.max(5, (maximum - minimum) * .16); minimum -= padding; maximum += padding;
  const x = (time) => left + time / settings.duration * (right - left);
  const y = (frequency) => bottom - (frequency - minimum) / (maximum - minimum) * (bottom - top);
  for (let index = 0; index <= 5; index += 1) {
    const frequency = minimum + (maximum - minimum) * index / 5, yPosition = y(frequency);
    chart.append(svgElement('line', { x1: left, y1: yPosition, x2: right, y2: yPosition, class: 'chart-gridline' }));
    const label = svgElement('text', { x: left - 10, y: yPosition + 4, 'text-anchor': 'end', class: 'chart-label' }); label.textContent = frequency.toFixed(0); chart.append(label);
  }
  for (let index = 0; index <= 8; index += 1) {
    const time = settings.duration * index / 8, xPosition = x(time);
    chart.append(svgElement('line', { x1: xPosition, y1: top, x2: xPosition, y2: bottom, class: index === 4 ? 'closest-gridline' : 'chart-gridline' }));
    const label = svgElement('text', { x: xPosition, y: bottom + 25, 'text-anchor': 'middle', class: 'chart-label' }); label.textContent = (time - settings.duration / 2).toFixed(1); chart.append(label);
  }
  const sourceLine = svgElement('line', { x1: left, y1: y(settings.sourceFrequency), x2: right, y2: y(settings.sourceFrequency), class: 'source-frequency-line' }); chart.append(sourceLine);
  const path = svgElement('path', { d: samples.map((sample, index) => `${index ? 'L' : 'M'}${x(sample.time)},${y(sample.frequency)}`).join(' '), class: 'observed-frequency-line' }); chart.append(path);
  const yTitle = svgElement('text', { x: 15, y: (top + bottom) / 2, transform: `rotate(-90 15 ${(top + bottom) / 2})`, 'text-anchor': 'middle', class: 'chart-title' }); yTitle.textContent = 'Frequency at receiver (Hz)'; chart.append(yTitle);
  const xTitle = svgElement('text', { x: (left + right) / 2, y: 360, 'text-anchor': 'middle', class: 'chart-title' }); xTitle.textContent = 'Time relative to closest point (s)'; chart.append(xTitle);
  const closest = svgElement('text', { x: x(settings.duration / 2) + 7, y: top + 14, class: 'chart-label closest-label' }); closest.textContent = 'closest point'; chart.append(closest);
}

function update() {
  try {
    const settings = inputs();
    const observed = dopplerFrequency(settings.sourceFrequency, settings.soundSpeed, settings.receiverSpeed, settings.sourceSpeed);
    const ratio = observed / settings.sourceFrequency, shift = observed - settings.sourceFrequency;
    document.querySelector('[data-observed-frequency]').textContent = formatFrequency(observed);
    document.querySelector('[data-shift-hz]').textContent = `${shift >= 0 ? '+' : ''}${shift.toFixed(2)} Hz (${(100 * (ratio - 1)).toFixed(2)} %)`;
    document.querySelector('[data-frequency-ratio]').textContent = ratio.toFixed(5);
    document.querySelector('[data-cents]').textContent = `${(1200 * Math.log2(ratio)).toFixed(1)} cents`;
    document.querySelector('[data-wavelength]').textContent = `${(settings.soundSpeed / settings.sourceFrequency).toFixed(3)} m`;
    drawChart(settings);
    document.querySelector('[data-doppler-error]').textContent = '';
  } catch (error) { document.querySelector('[data-doppler-error]').textContent = error.message; }
}

async function context() {
  audioContext ||= new AudioContext();
  if (audioContext.state === 'suspended') await audioContext.resume();
  return audioContext;
}

function stopAudio() {
  if (activeAudio) { try { activeAudio.source.stop(); } catch {} activeAudio = null; }
  passbyButton.textContent = '▶ Play pass-by';
}

function noiseSource(audio) {
  const length = audio.sampleRate * 2, buffer = audio.createBuffer(1, length, audio.sampleRate), channel = buffer.getChannelData(0);
  let fastLowpass = 0, slowLowpass = 0;
  for (let index = 0; index < length; index += 1) {
    const white = Math.random() * 2 - 1;
    fastLowpass = .82 * fastLowpass + .18 * white;
    slowLowpass = .995 * slowLowpass + .005 * white;
    channel[index] = 1.7 * (fastLowpass - slowLowpass);
  }
  const source = audio.createBufferSource(); source.buffer = buffer; source.loop = true; return source;
}

async function playTone(kind) {
  stopAudio();
  const settings = inputs();
  const frequency = kind === 'source' ? settings.sourceFrequency : dopplerFrequency(settings.sourceFrequency, settings.soundSpeed, settings.receiverSpeed, settings.sourceSpeed);
  const audio = await context(), isNoise = fields.waveform.value === 'noise', source = isNoise ? noiseSource(audio) : audio.createOscillator(), gain = audio.createGain(), now = audio.currentTime;
  if (isNoise) source.playbackRate.value = frequency / settings.sourceFrequency; else { source.type = fields.waveform.value; source.frequency.value = frequency; }
  gain.gain.setValueAtTime(0, now); gain.gain.linearRampToValueAtTime(.12, now + .03); gain.gain.setValueAtTime(.12, now + .75); gain.gain.linearRampToValueAtTime(0, now + .9);
  source.connect(gain).connect(audio.destination); source.start(now); source.stop(now + .92);
}

async function playPassby() {
  if (activeAudio) { stopAudio(); return; }
  try {
    const settings = inputs(), samples = passbySamples(settings, 481), audio = await context(), isNoise = fields.waveform.value === 'noise';
    const source = isNoise ? noiseSource(audio) : audio.createOscillator(), gain = audio.createGain(), now = audio.currentTime + .04;
    if (isNoise) source.playbackRate.setValueCurveAtTime(Float32Array.from(samples, (sample) => sample.frequency / settings.sourceFrequency), now, settings.duration);
    else { source.type = fields.waveform.value; source.frequency.setValueCurveAtTime(Float32Array.from(samples, (sample) => sample.frequency), now, settings.duration); }
    const gains = Float32Array.from(samples, (sample, index) => {
      const distanceGain = Math.min(1, settings.closestDistance / sample.distance);
      const fade = Math.min(1, index / 12, (samples.length - 1 - index) / 12);
      return .16 * distanceGain * Math.max(0, fade);
    });
    gain.gain.setValueCurveAtTime(gains, now, settings.duration);
    source.connect(gain).connect(audio.destination); source.start(now); source.stop(now + settings.duration);
    activeAudio = { source }; passbyButton.textContent = '■ Stop pass-by';
    source.addEventListener('ended', () => { if (activeAudio?.source === source) { activeAudio = null; passbyButton.textContent = '▶ Play pass-by'; } });
  } catch (error) { document.querySelector('[data-doppler-error]').textContent = error.message; }
}

document.querySelectorAll('input,select').forEach((input) => input.addEventListener('input', update));
document.querySelectorAll('[data-tone]').forEach((button) => button.addEventListener('click', () => playTone(button.dataset.tone)));
passbyButton.addEventListener('click', playPassby);
window.addEventListener('pagehide', stopAudio);
update();
