let audioContext;
let activeSources=[];

function stopAudio(){
  activeSources.forEach(source=>{try{source.stop();}catch{}});
  activeSources=[];
  document.querySelectorAll('[data-example]').forEach(button=>button.classList.remove('playing'));
}

function noiseBuffer(context,duration=2){
  const buffer=context.createBuffer(1,context.sampleRate*duration,context.sampleRate),data=buffer.getChannelData(0);
  for(let i=0;i<data.length;i++)data[i]=Math.random()*2-1;
  return buffer;
}

async function playExample(type,button){
  stopAudio();audioContext||=new AudioContext();await audioContext.resume();
  const now=audioContext.currentTime,duration=2.4,master=audioContext.createGain();
  master.gain.setValueAtTime(0,now);master.gain.linearRampToValueAtTime(.12,now+.04);master.gain.setValueAtTime(.12,now+duration-.08);master.gain.linearRampToValueAtTime(0,now+duration);master.connect(audioContext.destination);button.classList.add('playing');
  if(type.startsWith('roughness')){
    const carrier=audioContext.createOscillator(),carrierGain=audioContext.createGain(),mod=audioContext.createOscillator(),depth=audioContext.createGain(),high=type.endsWith('high');
    carrier.frequency.value=1000;mod.frequency.value=70;depth.gain.value=high?.78:.05;carrierGain.gain.value=high?.62:.71;mod.connect(depth).connect(carrierGain.gain);carrier.connect(carrierGain).connect(master);
    [carrier,mod].forEach(node=>{node.start(now);node.stop(now+duration);activeSources.push(node);});
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
