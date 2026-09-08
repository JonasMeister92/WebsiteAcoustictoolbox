let audioContext;
let activeSources=[];

function stopAudio(){
  activeSources.forEach(source=>{try{source.stop();}catch{}});
  activeSources=[];
  document.querySelectorAll('[data-example]').forEach(button=>button.classList.remove('playing'));
}

function noiseBuffer(context,duration=2,seed=509){
  const referenceRate=48000,buffer=context.createBuffer(1,referenceRate*duration,referenceRate),data=buffer.getChannelData(0);
  let state=seed>>>0;
  for(let i=0;i<data.length;i++){state=(Math.imul(1664525,state)+1013904223)>>>0;data[i]=state/4294967296*2-1;}
  return buffer;
}

async function playExample(type,button){
  stopAudio();audioContext||=new AudioContext();await audioContext.resume();
  const now=audioContext.currentTime,duration=2.4,master=audioContext.createGain();
  master.gain.setValueAtTime(0,now);master.gain.linearRampToValueAtTime(.12,now+.04);master.gain.setValueAtTime(.12,now+duration-.08);master.gain.linearRampToValueAtTime(0,now+duration);master.connect(audioContext.destination);button.classList.add('playing');
  if(type.startsWith('roughness')){
    const isNoise=type==='roughness-noise-matched',modulationDepth=isNoise?0.6412:(type.endsWith('high')?0.8:0.05),source=isNoise?audioContext.createBufferSource():audioContext.createOscillator(),amplitude=audioContext.createGain(),normalizer=audioContext.createGain(),mod=audioContext.createOscillator(),depth=audioContext.createGain();
    if(isNoise)source.buffer=noiseBuffer(audioContext,3);else source.frequency.value=1000;
    amplitude.gain.value=1;mod.frequency.value=70;depth.gain.value=modulationDepth;normalizer.gain.value=1/(Math.sqrt(isNoise?1/3:1/2)*Math.sqrt(1+modulationDepth**2/2));mod.connect(depth).connect(amplitude.gain);source.connect(amplitude).connect(normalizer).connect(master);
    [source,mod].forEach(node=>{node.start(now);node.stop(now+duration);activeSources.push(node);});
  }else if(type.startsWith('sharpness')){
    const source=audioContext.createBufferSource(),filter=audioContext.createBiquadFilter();source.buffer=noiseBuffer(audioContext,3);filter.type=type.endsWith('high')?'highpass':'lowpass';filter.frequency.value=type.endsWith('high')?3200:900;filter.Q.value=.5;source.connect(filter).connect(master);source.start(now);source.stop(now+duration);activeSources.push(source);
  }else{
    const noise=audioContext.createBufferSource(),noiseGain=audioContext.createGain(),high=type.endsWith('high');noise.buffer=noiseBuffer(audioContext,3);noiseGain.gain.value=high?.48:.7;noise.connect(noiseGain).connect(master);noise.start(now);noise.stop(now+duration);activeSources.push(noise);
    if(high){const tone=audioContext.createOscillator(),toneGain=audioContext.createGain();tone.frequency.value=1000;toneGain.gain.value=.52;tone.connect(toneGain).connect(master);tone.start(now);tone.stop(now+duration);activeSources.push(tone);}
  }
  setTimeout(()=>{if(button.classList.contains('playing'))stopAudio();},duration*1000+100);
}

document.querySelectorAll('[data-example]').forEach(button=>button.addEventListener('click',()=>playExample(button.dataset.example,button)));
window.addEventListener('pagehide',stopAudio);
