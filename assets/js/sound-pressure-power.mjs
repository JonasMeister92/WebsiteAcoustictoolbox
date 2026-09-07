import {
  pressureToSpl, splToPressure, powerToLevel, levelToPower,
  propagationTerm, pressureLevelToPowerLevel, powerLevelToPressureLevel
} from './calculations.mjs';

const modes = {
  pressure: {
    calculate: ({ pressure }) => pressureToSpl(pressure),
    format: (value) => value.toFixed(2),
  },
  spl: {
    calculate: ({ level }) => splToPressure(level),
    format: formatPhysical,
  },
  power: {
    calculate: ({ power }) => powerToLevel(power),
    format: (value) => value.toFixed(2),
  },
  powerLevel: {
    calculate: ({ level }) => levelToPower(level),
    format: formatPhysical,
  },
  lpToLw: {
    calculate: ({ level, distance, directivity, attenuation }) => pressureLevelToPowerLevel(level, distance, directivity, attenuation),
    format: (value) => value.toFixed(2),
  },
  lwToLp: {
    calculate: ({ level, distance, directivity, attenuation }) => powerLevelToPressureLevel(level, distance, directivity, attenuation),
    format: (value) => value.toFixed(2),
  },
};

function formatPhysical(value) {
  if (value === 0) return '0';
  if (Math.abs(value) >= 0.01 && Math.abs(value) < 1e6) return Number(value.toPrecision(6)).toString();
  return value.toExponential(4);
}

function valuesFrom(panel) {
  return Object.fromEntries([...panel.querySelectorAll('[data-value]')].map((field) => [field.dataset.value, Number(field.value)]));
}

function update(panel) {
  const mode = panel.dataset.panel;
  const output = panel.querySelector('[data-result]');
  const error = panel.querySelector('[data-error]');
  try {
    const inputs = valuesFrom(panel);
    output.textContent = modes[mode].format(modes[mode].calculate(inputs));
    error.textContent = '';
    const spreading = panel.querySelector('[data-spreading]');
    if (spreading) spreading.textContent = `${propagationTerm(inputs.distance, inputs.directivity).toFixed(2)} dB`;
  } catch (exception) {
    output.textContent = '—';
    error.textContent = exception.message;
    const spreading = panel.querySelector('[data-spreading]');
    if (spreading) spreading.textContent = '—';
  }
}

const tabs = [...document.querySelectorAll('[role="tab"]')];
function selectTab(tab) {
  tabs.forEach((item) => {
    const selected = item === tab;
    item.setAttribute('aria-selected', String(selected));
    item.tabIndex = selected ? 0 : -1;
    document.querySelector(`[data-panel="${item.dataset.tab}"]`).hidden = !selected;
  });
}

tabs.forEach((tab, index) => {
  tab.addEventListener('click', () => selectTab(tab));
  tab.addEventListener('keydown', (event) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
    tabs[next].focus(); selectTab(tabs[next]);
  });
});

document.querySelectorAll('[data-panel]').forEach((panel) => {
  panel.querySelectorAll('[data-value]').forEach((field) => field.addEventListener('input', () => update(panel)));
  update(panel);
});
