import { addDecibels, energeticAverage, subtractBackground } from './calculations.mjs';

const values = { add: [70, 70], average: [60, 60, 60] };
const format = (value) => Number.isFinite(value) ? value.toFixed(2) : '—';

function update(type) {
  const usable = values[type].filter(Number.isFinite);
  document.querySelector(`[data-result="${type}"]`).textContent = usable.length ? format(type === 'add' ? addDecibels(usable) : energeticAverage(usable)) : '—';
}

function renderRows(type) {
  const list = document.querySelector(`[data-list="${type}"]`);
  list.replaceChildren();
  values[type].forEach((value, index) => {
    const row = document.createElement('div'); row.className = 'level-row';
    const label = document.createElement('label'); label.className = 'field';
    label.innerHTML = `<span>Level ${index + 1}</span><span class="input-unit"><input type="number" inputmode="decimal" step="any" value="${value ?? ''}" aria-label="Level ${index + 1} in decibels"><span>dB</span></span>`;
    label.querySelector('input').addEventListener('input', (event) => { values[type][index] = event.target.value === '' ? null : Number(event.target.value); update(type); });
    const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'remove-row'; remove.textContent = '×'; remove.setAttribute('aria-label', `Remove level ${index + 1}`); remove.disabled = values[type].length <= 1;
    remove.addEventListener('click', () => { values[type].splice(index, 1); renderRows(type); update(type); });
    row.append(label, remove); list.append(row);
  });
}

function updateSubtraction() {
  const result = document.querySelector('[data-result="subtract"]');
  const error = document.querySelector('[data-error="subtract"]');
  try { result.textContent = format(subtractBackground(Number(document.querySelector('[data-total]').value), Number(document.querySelector('[data-background]').value))); error.textContent = ''; }
  catch (exception) { result.textContent = '—'; error.textContent = exception.message; }
}

document.querySelectorAll('[data-add-row]').forEach((button) => button.addEventListener('click', () => { const type = button.dataset.addRow; values[type].push(null); renderRows(type); update(type); document.querySelector(`[data-list="${type}"] .level-row:last-child input`).focus(); }));
const tabs = [...document.querySelectorAll('[role="tab"]')];
function selectTab(tab) { tabs.forEach((item) => { const selected = item === tab; item.setAttribute('aria-selected', String(selected)); item.tabIndex = selected ? 0 : -1; document.querySelector(`[data-panel="${item.dataset.tab}"]`).hidden = !selected; }); }
tabs.forEach((tab, index) => { tab.addEventListener('click', () => selectTab(tab)); tab.addEventListener('keydown', (event) => { if (!['ArrowLeft','ArrowRight','Home','End'].includes(event.key)) return; event.preventDefault(); const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length; tabs[next].focus(); selectTab(tabs[next]); }); });
document.querySelectorAll('[data-total],[data-background]').forEach((input) => input.addEventListener('input', updateSubtraction));
renderRows('add'); renderRows('average'); update('add'); update('average'); updateSubtraction();
