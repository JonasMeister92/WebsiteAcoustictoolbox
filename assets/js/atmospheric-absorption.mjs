import { THIRD_OCTAVE_BANDS, atmosphericAbsorptionCoefficient } from './outdoor-propagation.mjs';

const OCTAVE_BANDS = [63,125,250,500,1000,2000,4000,8000];
const DISTANCE_FREQUENCIES = [125,500,1000,4000,8000];
const COLORS = ['#096b69','#607b86','#8c6d46','#725c87','#9b4f48'];
const state = { selectedFrequency: 1000, compare: false };

const resolution = document.querySelector('[data-resolution]');
const singleFrequency = document.querySelector('[data-single-frequency]');
const evaluationDistance = document.querySelector('[data-distance]');
const startingLevel = document.querySelector('[data-start-level]');

function environment(prefix) { return Object.fromEntries([...document.querySelectorAll(`[data-${prefix}]`)].map((field) => [field.dataset[prefix], Number(field.value)])); }
function bands() { return resolution.value === 'single' ? [Number(singleFrequency.value)] : resolution.value === 'octave' ? OCTAVE_BANDS : THIRD_OCTAVE_BANDS; }
function alpha(frequency, climate = environment('a')) { return atmosphericAbsorptionCoefficient(frequency, climate.temperatureC, climate.humidityPercent, climate.pressureKPa); }
function svgElement(tag, attributes = {}) { const element = document.createElementNS('http://www.w3.org/2000/svg', tag); Object.entries(attributes).forEach(([key,value]) => element.setAttribute(key,value)); return element; }
function frequencyLabel(frequency) { return frequency >= 1000 ? `${Number((frequency / 1000).toPrecision(3))} kHz` : `${Number(frequency.toPrecision(4))} Hz`; }
function distanceLabel(distance) { return distance >= 1000 ? `${Number((distance / 1000).toPrecision(3))} km` : `${Number(distance.toPrecision(4))} m`; }
function niceMaximum(value) { if (value <= 0) return 1; const magnitude = 10 ** Math.floor(Math.log10(value)); const fraction = value / magnitude; return (fraction <= 1 ? 1 : fraction <= 2 ? 2 : fraction <= 5 ? 5 : 10) * magnitude; }

function axes(chart, { left, right, top, bottom, yMax, yTicks = 5, xTicks, xScale, xFormat, yTitle, xTitle }) {
  for (let index = 0; index <= yTicks; index += 1) { const value = yMax * index / yTicks, y = bottom - index / yTicks * (bottom - top); chart.append(svgElement('line',{x1:left,y1:y,x2:right,y2:y,class:'chart-gridline'})); const label=svgElement('text',{x:left-10,y:y+4,'text-anchor':'end',class:'chart-label'}); label.textContent=Number(value.toPrecision(3)); chart.append(label); }
  xTicks.forEach((value) => { const x=xScale(value); chart.append(svgElement('line',{x1:x,y1:top,x2:x,y2:bottom,class:'chart-gridline'})); const label=svgElement('text',{x,y:bottom+25,'text-anchor':'middle',class:'chart-label'}); label.textContent=xFormat(value); chart.append(label); });
  const yLabel=svgElement('text',{x:15,y:(top+bottom)/2,transform:`rotate(-90 15 ${(top+bottom)/2})`,'text-anchor':'middle',class:'chart-title'}); yLabel.textContent=yTitle; chart.append(yLabel);
  const xLabel=svgElement('text',{x:(left+right)/2,y:360,'text-anchor':'middle',class:'chart-title'}); xLabel.textContent=xTitle; chart.append(xLabel);
}

function drawFrequencyChart(activeBands) {
  const chart=document.querySelector('[data-frequency-chart]'); chart.replaceChildren();
  const left=76,right=970,top=25,bottom=310, logMin=Math.log10(Math.min(...activeBands)),logMax=Math.log10(Math.max(...activeBands));
  const climates=[{values:activeBands.map((f)=>alpha(f)),className:'climate-a-line',pointClass:'climate-a-point'}];
  if(state.compare) { const climateB=environment('b'); climates.push({values:activeBands.map((f)=>alpha(f,climateB)),className:'climate-b-line',pointClass:'climate-b-point'}); }
  const maximum=niceMaximum(Math.max(...climates.flatMap((item)=>item.values))*1000*1.1);
  const x=(f)=>logMax===logMin?(left+right)/2:left+(Math.log10(f)-logMin)/(logMax-logMin)*(right-left), y=(value)=>bottom-value*1000/maximum*(bottom-top);
  const ticks=activeBands.length===1?[activeBands[0]]:activeBands.filter((_,index)=>index===0||index===activeBands.length-1||index%Math.ceil(activeBands.length/7)===0);
  axes(chart,{left,right,top,bottom,yMax:maximum,xTicks:ticks,xScale:x,xFormat:(f)=>f>=1000?`${f/1000}k`:f,yTitle:'Absorption coefficient α (dB/km)',xTitle:'Frequency (Hz)'});
  climates.forEach((climate,climateIndex)=>{ if(activeBands.length>1) chart.append(svgElement('path',{d:activeBands.map((f,index)=>`${index?'L':'M'}${x(f)},${y(climate.values[index])}`).join(' '),class:climate.className})); activeBands.forEach((f,index)=>{const point=svgElement('circle',{cx:x(f),cy:y(climate.values[index]),r:climateIndex?4:5,class:climate.pointClass,tabindex:0,role:'button','aria-label':`${frequencyLabel(f)}, ${Number((climate.values[index]*1000).toPrecision(4))} decibels per kilometre`}); point.addEventListener('click',()=>{state.selectedFrequency=f;updateSummary();}); point.addEventListener('focus',()=>{state.selectedFrequency=f;updateSummary();}); chart.append(point);});});
}

function drawDistanceChart() {
  const chart=document.querySelector('[data-distance-chart]'); chart.replaceChildren();
  const reporting=[...document.querySelectorAll('[data-report-distance]')].map((input)=>Number(input.value));
  const maxDistance=Math.max(1000,Number(evaluationDistance.value),...reporting), minDistance=1, left=76,right=970,top=25,bottom=310,logMin=0,logMax=Math.log10(maxDistance);
  const coefficients=DISTANCE_FREQUENCIES.map((f)=>alpha(f)), maximum=niceMaximum(Math.max(...coefficients)*maxDistance*1.1);
  const x=(distance)=>left+(Math.log10(distance)-logMin)/(logMax-logMin||1)*(right-left),y=(value)=>bottom-value/maximum*(bottom-top);
  const xTicks=Array.from({length:7},(_,index)=>10**(index/6*logMax));
  axes(chart,{left,right,top,bottom,yMax:maximum,xTicks,xScale:x,xFormat:distanceLabel,yTitle:'Atmospheric attenuation (dB)',xTitle:'Distance'});
  const distances=Array.from({length:100},(_,index)=>10**(index/99*logMax));
  DISTANCE_FREQUENCIES.forEach((frequency,index)=>{const path=svgElement('path',{d:distances.map((distance,i)=>`${i?'L':'M'}${x(distance)},${y(coefficients[index]*distance)}`).join(' '),class:'distance-frequency-line',style:`stroke:${COLORS[index]}`}); chart.append(path);});
  const legend=document.querySelector('[data-distance-legend]'); legend.replaceChildren(); DISTANCE_FREQUENCIES.forEach((frequency,index)=>{const item=document.createElement('span'); item.innerHTML=`<i style="background:${COLORS[index]}"></i>${frequencyLabel(frequency)}`; legend.append(item);});
}

function updateSummary() {
  const coefficient=alpha(state.selectedFrequency), distance=Number(evaluationDistance.value), attenuation=coefficient*distance, hasStartingLevel=startingLevel.value.trim()!=='';
  document.querySelector('[data-selected-frequency]').textContent=frequencyLabel(state.selectedFrequency);
  document.querySelector('[data-selected-alpha]').textContent=`${Number((coefficient*1000).toPrecision(5))} dB/km`;
  document.querySelector('[data-selected-attenuation]').textContent=`${Number(attenuation.toPrecision(5))} dB`;
  document.querySelector('[data-remaining-level]').textContent=hasStartingLevel?`${(Number(startingLevel.value)-attenuation).toFixed(2)} dB`:'—';
}

function renderTable(activeBands) {
  const distances=[...document.querySelectorAll('[data-report-distance]')].map((input)=>Number(input.value));
  distances.forEach((distance,index)=>document.querySelector(`[data-distance-head="${index}"]`).textContent=distanceLabel(distance));
  const body=document.querySelector('[data-atmosphere-table]'); body.replaceChildren();
  activeBands.forEach((frequency)=>{const coefficient=alpha(frequency),row=document.createElement('tr'); row.innerHTML=`<th>${frequencyLabel(frequency)}</th><td>${Number((coefficient*1000).toPrecision(5))} dB/km</td>${distances.map((distance)=>`<td>${Number((coefficient*distance).toPrecision(5))} dB</td>`).join('')}`; body.append(row);});
}

let latestBands=[];
function update() {
  try { latestBands=bands(); if(!latestBands.every((f)=>Number.isFinite(f)&&f>0)) throw new RangeError('Frequency must be greater than zero.'); const distances=[Number(evaluationDistance.value),...[...document.querySelectorAll('[data-report-distance]')].map((input)=>Number(input.value))]; if(!distances.every((distance)=>Number.isFinite(distance)&&distance>0)) throw new RangeError('Distances must be greater than zero.'); state.selectedFrequency=latestBands.includes(state.selectedFrequency)?state.selectedFrequency:latestBands[0]; drawFrequencyChart(latestBands); drawDistanceChart(); renderTable(latestBands); updateSummary(); document.querySelector('[data-error]').textContent=''; }
  catch(error){document.querySelector('[data-error]').textContent=error.message;}
}

resolution.addEventListener('input',()=>{document.querySelector('.single-frequency').hidden=resolution.value!=='single';update();});
document.querySelector('[data-compare]').addEventListener('input',(event)=>{state.compare=event.target.checked;document.querySelector('[data-climate-b]').hidden=!state.compare;document.querySelector('[data-legend-b]').hidden=!state.compare;update();});
document.querySelectorAll('input,select').forEach((input)=>{if(input!==resolution&&input!==document.querySelector('[data-compare]'))input.addEventListener('input',update);});
document.querySelector('[data-copy-atmosphere]').addEventListener('click',async(event)=>{const distances=[...document.querySelectorAll('[data-report-distance]')].map((input)=>Number(input.value));const header=['frequency_Hz','alpha_dB_per_km',...distances.map((d)=>`attenuation_${d}m_dB`)];const rows=latestBands.map((f)=>[f,alpha(f)*1000,...distances.map((d)=>alpha(f)*d)].join(','));await navigator.clipboard.writeText([header.join(','),...rows].join('\n'));event.target.textContent='Copied';setTimeout(()=>event.target.textContent='Copy results as CSV',1400);});
update();
