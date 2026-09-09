const REFERENCE_PRESSURE = 20e-6;
const PERIODIC_TYPES = new Set(['sine','square','triangle','sawtooth']);

export function pressureFromLevel(levelDb){
  if(!Number.isFinite(levelDb))throw new RangeError('Level must be finite.');
  return REFERENCE_PRESSURE*10**(levelDb/20);
}

export function levelFromPressure(pressurePa){
  if(!(pressurePa>0))throw new RangeError('Pressure must be greater than zero.');
  return 20*Math.log10(pressurePa/REFERENCE_PRESSURE);
}

function randomGenerator(seed=509){
  let state=seed>>>0;
  return ()=>{state=(Math.imul(1664525,state)+1013904223)>>>0;return state/4294967296*2-1;};
}

function periodicTable(type,frequency,sampleRate,size=4096){
  const table=new Float64Array(size),maximum=Math.max(1,Math.min(4096,Math.floor(sampleRate/(2*frequency))));
  if(type==='sine'){for(let i=0;i<size;i++)table[i]=Math.sin(2*Math.PI*i/size);return table;}
  for(let harmonic=1;harmonic<=maximum;harmonic++){
    let coefficient=0;
    if(type==='sawtooth')coefficient=2/Math.PI*(harmonic%2?1:-1)/harmonic;
    else if(type==='square'&&harmonic%2)coefficient=4/Math.PI/harmonic;
    else if(type==='triangle'&&harmonic%2)coefficient=8/(Math.PI**2)*(harmonic%4===1?1:-1)/(harmonic**2);
    if(!coefficient)continue;
    for(let i=0;i<size;i++)table[i]+=coefficient*Math.sin(2*Math.PI*harmonic*i/size);
  }
  return table;
}

function periodicSignal(type,length,frequency,sampleRate,phaseDegrees){
  const table=periodicTable(type,frequency,sampleRate),output=new Float64Array(length),offset=((phaseDegrees/360)%1+1)%1;
  for(let i=0;i<length;i++){
    const position=((i*frequency/sampleRate+offset)%1)*table.length,index=Math.floor(position),fraction=position-index;
    output[i]=table[index]*(1-fraction)+table[(index+1)%table.length]*fraction;
  }
  return output;
}

function noiseSignal(type,length,seed){
  const output=new Float64Array(length),random=randomGenerator(seed),white=new Float64Array(length);
  for(let i=0;i<length;i++)white[i]=random();
  if(type==='white')return white;
  if(type==='pink'){
    let b0=0,b1=0,b2=0,b3=0,b4=0,b5=0,b6=0;
    for(let i=0;i<length;i++){const value=white[i];b0=.99886*b0+value*.0555179;b1=.99332*b1+value*.0750759;b2=.969*b2+value*.153852;b3=.8665*b3+value*.3104856;b4=.55*b4+value*.5329522;b5=-.7616*b5-value*.016898;output[i]=b0+b1+b2+b3+b4+b5+b6+value*.5362;b6=value*.115926;}
  }else if(type==='brown'){
    let state=0;for(let i=0;i<length;i++){state=.9995*state+white[i]*.02;output[i]=state;}
  }else if(type==='blue'){
    let previous=0;for(let i=0;i<length;i++){output[i]=white[i]-previous;previous=white[i];}
  }else if(type==='violet'){
    let previous=0,previousDifference=0;for(let i=0;i<length;i++){const difference=white[i]-previous;output[i]=difference-previousDifference;previous=white[i];previousDifference=difference;}
  }else throw new RangeError('Unknown signal type.');
  return output;
}

export function generateSound({type='sine',frequency=1000,duration=2,sampleRate=48000,phaseDegrees=0,fadeMs=10,rmsPressurePa=1,seed=509}={}){
  if(!PERIODIC_TYPES.has(type)&&!['white','pink','brown','blue','violet'].includes(type))throw new RangeError('Unknown signal type.');
  if(!(sampleRate>=8000&&sampleRate<=192000))throw new RangeError('Sample rate must be between 8 and 192 kHz.');
  if(!(duration>=.05&&duration<=30))throw new RangeError('Duration must be between 0.05 and 30 seconds.');
  if(!(rmsPressurePa>0&&Number.isFinite(rmsPressurePa)))throw new RangeError('RMS pressure must be greater than zero.');
  if(PERIODIC_TYPES.has(type)&&!(frequency>0&&frequency<sampleRate/2))throw new RangeError('Frequency must be between 0 Hz and Nyquist.');
  const length=Math.round(duration*sampleRate),signal=PERIODIC_TYPES.has(type)?periodicSignal(type,length,frequency,sampleRate,phaseDegrees):noiseSignal(type,length,seed),fadeSamples=Math.min(Math.round(fadeMs*sampleRate/1000),Math.floor(length/2));
  for(let i=0;i<fadeSamples;i++){const gain=fadeSamples===1?0:.5-.5*Math.cos(Math.PI*i/(fadeSamples-1));signal[i]*=gain;signal[length-1-i]*=gain;}
  let energy=0;for(const value of signal)energy+=value*value;const rawRms=Math.sqrt(energy/length);if(!rawRms)throw new RangeError('The generated signal is silent.');
  const scale=rmsPressurePa/rawRms;let peak=0;for(let i=0;i<length;i++){signal[i]*=scale;peak=Math.max(peak,Math.abs(signal[i]));}
  return {samples:Float32Array.from(signal),sampleRate,rmsPressurePa,peakPressurePa:peak,crestFactorDb:20*Math.log10(peak/rmsPressurePa)};
}

export function encodeFloat32Wav(samples,sampleRate){
  const buffer=new ArrayBuffer(44+samples.length*4),view=new DataView(buffer),text=(offset,value)=>{for(let i=0;i<value.length;i++)view.setUint8(offset+i,value.charCodeAt(i));};
  text(0,'RIFF');view.setUint32(4,36+samples.length*4,true);text(8,'WAVE');text(12,'fmt ');view.setUint32(16,16,true);view.setUint16(20,3,true);view.setUint16(22,1,true);view.setUint32(24,sampleRate,true);view.setUint32(28,sampleRate*4,true);view.setUint16(32,4,true);view.setUint16(34,32,true);text(36,'data');view.setUint32(40,samples.length*4,true);
  for(let i=0;i<samples.length;i++)view.setFloat32(44+i*4,samples[i],true);
  return buffer;
}

function modulationValue(type,phase){
  const wrapped=((phase/(2*Math.PI))%1+1)%1;
  if(type==='sine')return Math.sin(phase);
  if(type==='square')return wrapped<.5?1:-1;
  if(type==='triangle')return 1-4*Math.abs(wrapped-.5);
  if(type==='sawtooth')return 2*wrapped-1;
  throw new RangeError('Unknown modulation waveform.');
}

export function applyAmplitudeModulation(samples,{sampleRate,frequency=70,depthPercent=50,waveform='sine',phaseDegrees=0,fadeMs=10,rmsPressurePa=1}={}){
  if(!(sampleRate>=8000&&sampleRate<=192000))throw new RangeError('Sample rate must be between 8 and 192 kHz.');
  if(!(frequency>0&&frequency<sampleRate/2))throw new RangeError('Modulation frequency must be between 0 Hz and Nyquist.');
  if(!(depthPercent>=0&&depthPercent<=200))throw new RangeError('Modulation depth must be between 0 and 200%.');
  if(!(rmsPressurePa>0&&Number.isFinite(rmsPressurePa)))throw new RangeError('RMS pressure must be greater than zero.');
  const output=new Float64Array(samples.length),depth=depthPercent/100,phaseOffset=phaseDegrees*Math.PI/180;
  let envelopeMin=Infinity,envelopeMax=-Infinity;
  for(let i=0;i<samples.length;i++){const envelope=1+depth*modulationValue(waveform,2*Math.PI*frequency*i/sampleRate+phaseOffset);output[i]=samples[i]*envelope;envelopeMin=Math.min(envelopeMin,envelope);envelopeMax=Math.max(envelopeMax,envelope);}
  const fadeSamples=Math.min(Math.round(fadeMs*sampleRate/1000),Math.floor(output.length/2));
  for(let i=0;i<fadeSamples;i++){const gain=fadeSamples===1?0:.5-.5*Math.cos(Math.PI*i/(fadeSamples-1));output[i]*=gain;output[output.length-1-i]*=gain;}
  let energy=0;for(const value of output)energy+=value*value;const rawRms=Math.sqrt(energy/output.length);if(!rawRms)throw new RangeError('The modulated signal is silent.');
  const scale=rmsPressurePa/rawRms;let peak=0;for(let i=0;i<output.length;i++){output[i]*=scale;peak=Math.max(peak,Math.abs(output[i]));}
  return {samples:Float32Array.from(output),sampleRate,rmsPressurePa,peakPressurePa:peak,crestFactorDb:20*Math.log10(peak/rmsPressurePa),envelopeMin,envelopeMax,overmodulated:envelopeMin<0};
}

export const isPeriodicSignal=(type)=>PERIODIC_TYPES.has(type);
