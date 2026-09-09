import {encodeFloat32Wav,generateSound,isPeriodicSignal,levelFromPressure,pressureFromLevel} from './sound-generator-core.mjs?v=2';

const q=selector=>document.querySelector(selector),controls={type:q('[data-signal-type]'),frequency:q('[data-frequency]'),duration:q('[data-duration]'),sampleRate:q('[data-sample-rate]'),phase:q('[data-phase]'),fade:q('[data-fade]'),mode:q('[data-level-mode]'),value:q('[data-level-value]')};
let result,audioContext,source;
const svg=(tag,attributes={})=>{const element=document.createElementNS('http://www.w3.org/2000/svg',tag);Object.entries(attributes).forEach(([key,value])=>element.setAttribute(key,value));return element;};

function physicalPressure(){return controls.mode.value==='spl'?pressureFromLevel(Number(controls.value.value)):Number(controls.value.value);}
function formatPressure(value){return value>=.01?`${Number(value.toPrecision(5))} Pa`:`${Number((value*1000).toPrecision(5))} mPa`;}
function updateModeLabel(){const spl=controls.mode.value==='spl';q('[data-level-label]').textContent=spl?'Sound pressure level':'RMS pressure';q('[data-level-unit]').textContent=spl?'dB SPL':'Pa';controls.value.min=spl?'-20':'0.000001';controls.value.max=spl?'180':'1000000';controls.value.step=spl?'.1':'any';}
function updateAvailability(){const periodic=isPeriodicSignal(controls.type.value);controls.frequency.disabled=!periodic;controls.phase.disabled=!periodic;q('[data-frequency-field]').classList.toggle('disabled-field',!periodic);q('[data-phase-field]').classList.toggle('disabled-field',!periodic);}

function drawWaveform(){
  const chart=q('[data-waveform-chart]');chart.replaceChildren();if(!result?.samples.length)return;
  const left=66,right=970,top=24,bottom=278,periodic=isPeriodicSignal(controls.type.value),wanted=periodic?Math.ceil(3*result.sampleRate/Number(controls.frequency.value)):Math.ceil(.02*result.sampleRate),count=Math.max(2,Math.min(wanted,result.samples.length)),fadeSamples=Math.round(Number(controls.fade.value)*result.sampleRate/1000),start=Math.min(fadeSamples,Math.max(0,result.samples.length-count)),values=result.samples.subarray(start,start+count);let peak=Number.EPSILON;for(const value of values)peak=Math.max(peak,Math.abs(value));const x=index=>left+index/(values.length-1)*(right-left),y=value=>(top+bottom)/2-value/peak*(bottom-top)*.44;
  for(let i=0;i<=4;i++){const yp=top+i*(bottom-top)/4;chart.append(svg('line',{x1:left,y1:yp,x2:right,y2:yp,class:'chart-gridline'}));const label=svg('text',{x:left-8,y:yp+4,'text-anchor':'end',class:'chart-label'});label.textContent=(1-i/2).toFixed(1);chart.append(label);}
  for(let i=0;i<=5;i++){const xp=left+i*(right-left)/5;chart.append(svg('line',{x1:xp,y1:top,x2:xp,y2:bottom,class:'chart-gridline'}));const label=svg('text',{x:xp,y:bottom+23,'text-anchor':'middle',class:'chart-label'});label.textContent=(1000*i*(values.length-1)/5/result.sampleRate).toFixed(periodic?2:1);chart.append(label);}
  const step=Math.max(1,Math.ceil(values.length/1800)),points=[];for(let i=0;i<values.length;i+=step)points.push(`${points.length?'L':'M'}${x(i)},${y(values[i])}`);chart.append(svg('path',{d:points.join(' '),class:'generator-waveform-line'}));
  const yl=svg('text',{x:15,y:151,transform:'rotate(-90 15 151)','text-anchor':'middle',class:'chart-title'});yl.textContent='Normalized amplitude';chart.append(yl);const xl=svg('text',{x:520,y:332,'text-anchor':'middle',class:'chart-title'});xl.textContent='Time (ms)';chart.append(xl);q('[data-waveform-caption]').textContent=periodic?'Three periods, displayed after fade-in.':'A 20 ms excerpt, displayed after fade-in.';
}

function drawNoiseSpectra(){
  const chart=q('[data-noise-chart]');chart.replaceChildren();const left=70,right=970,top=24,bottom=300,minFrequency=20,maxFrequency=20000,minDb=-40,maxDb=40,x=frequency=>left+Math.log10(frequency/minFrequency)/Math.log10(maxFrequency/minFrequency)*(right-left),y=db=>bottom-(db-minDb)/(maxDb-minDb)*(bottom-top),colors=[['white',0],['pink',-1],['brown',-2],['blue',1],['violet',2]];
  for(let db=-40;db<=40;db+=20){const yp=y(db);chart.append(svg('line',{x1:left,y1:yp,x2:right,y2:yp,class:'chart-gridline'}));const label=svg('text',{x:left-8,y:yp+4,'text-anchor':'end',class:'chart-label'});label.textContent=db;chart.append(label);}
  [20,50,100,200,500,1000,2000,5000,10000,20000].forEach(frequency=>{const xp=x(frequency);chart.append(svg('line',{x1:xp,y1:top,x2:xp,y2:bottom,class:'chart-gridline'}));const label=svg('text',{x:xp,y:bottom+22,'text-anchor':'middle',class:'chart-label'});label.textContent=frequency>=1000?`${frequency/1000}k`:frequency;chart.append(label);});
  colors.forEach(([name,alpha])=>{const points=Array.from({length:181},(_,index)=>{const frequency=minFrequency*(maxFrequency/minFrequency)**(index/180),db=10*alpha*Math.log10(frequency/1000);return `${index?'L':'M'}${x(frequency)},${y(db)}`;});chart.append(svg('path',{d:points.join(' '),class:`noise-spectrum-line noise-${name}${controls.type.value===name?' active':''}`}));});
}

function render(){
  try{
    result=generateSound({type:controls.type.value,frequency:Number(controls.frequency.value),duration:Number(controls.duration.value),sampleRate:Number(controls.sampleRate.value),phaseDegrees:Number(controls.phase.value),fadeMs:Number(controls.fade.value),rmsPressurePa:physicalPressure()});
    q('[data-result-level]').textContent=`${levelFromPressure(result.rmsPressurePa).toFixed(2)} dB SPL`;q('[data-result-rms]').textContent=formatPressure(result.rmsPressurePa);q('[data-result-peak]').textContent=formatPressure(result.peakPressurePa);q('[data-result-crest]').textContent=`${result.crestFactorDb.toFixed(2)} dB`;
    q('[data-result-size]').textContent=`${result.samples.length.toLocaleString()} / ${((44+result.samples.byteLength)/1e6).toFixed(2)} MB`;
    drawWaveform();drawNoiseSpectra();q('[data-generator-error]').textContent='';
  }catch(error){result=null;q('[data-generator-error]').textContent=error.message;}
}

function stop(){if(source){try{source.stop();}catch{}source=null;}q('[data-preview]').textContent='▶ Preview';}
async function preview(){if(!result)return;stop();audioContext||=new AudioContext();await audioContext.resume();const buffer=audioContext.createBuffer(1,result.samples.length,result.sampleRate),output=buffer.getChannelData(0),normalization=.18/Math.max(result.peakPressurePa,Number.EPSILON);for(let i=0;i<output.length;i++)output[i]=result.samples[i]*normalization;source=audioContext.createBufferSource();source.buffer=buffer;source.connect(audioContext.destination);source.addEventListener('ended',stop,{once:true});source.start();q('[data-preview]').textContent='■ Stop';}
function download(){if(!result)return;const buffer=encodeFloat32Wav(result.samples,result.sampleRate),blob=new Blob([buffer],{type:'audio/wav'}),url=URL.createObjectURL(blob),link=document.createElement('a'),type=controls.type.value,frequency=isPeriodicSignal(type)?`-${Number(controls.frequency.value)}Hz`:'';link.href=url;link.download=`${type}${frequency}-${levelFromPressure(result.rmsPressurePa).toFixed(1)}dBSPL-32f.wav`;document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),0);}

controls.mode.addEventListener('change',event=>{const previous=event.target.dataset.previous||'spl',value=Number(controls.value.value);controls.value.value=previous==='spl'?Number(pressureFromLevel(value).toPrecision(6)):Number(levelFromPressure(value).toFixed(2));event.target.dataset.previous=event.target.value;updateModeLabel();render();});
controls.type.addEventListener('change',()=>{updateAvailability();render();});
[controls.frequency,controls.duration,controls.sampleRate,controls.phase,controls.fade,controls.value].forEach(control=>control.addEventListener('input',render));
q('[data-preview]').addEventListener('click',()=>source?stop():preview());q('[data-download]').addEventListener('click',download);window.addEventListener('pagehide',stop);
controls.mode.dataset.previous=controls.mode.value;updateModeLabel();updateAvailability();render();
