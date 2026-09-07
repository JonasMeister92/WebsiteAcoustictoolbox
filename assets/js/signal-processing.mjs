export const requirePositive = (value, name) => { if (!Number.isFinite(value) || value <= 0) throw new RangeError(`${name} must be greater than zero.`); };
export function frequencyToPeriod(frequencyHz) { requirePositive(frequencyHz, 'Frequency'); return 1 / frequencyHz; }
export function periodToFrequency(periodSeconds) { requirePositive(periodSeconds, 'Period'); return 1 / periodSeconds; }
export function fftResolution(sampleRateHz, sampleCount) { requirePositive(sampleRateHz, 'Sample rate'); requirePositive(sampleCount, 'Sample count'); return sampleRateHz / sampleCount; }
export function aliasFrequency(frequencyHz, sampleRateHz) { requirePositive(frequencyHz, 'Signal frequency'); requirePositive(sampleRateHz, 'Sample rate'); const wrapped=((frequencyHz+sampleRateHz/2)%sampleRateHz+sampleRateHz)%sampleRateHz-sampleRateHz/2; return Math.abs(wrapped); }
export function nextPowerOfTwo(value) { requirePositive(value, 'Value'); return 2 ** Math.ceil(Math.log2(value)); }
export function windowCoefficient(type, index, length) { if(length<=1)return 1; const phase=2*Math.PI*index/(length-1); if(type==='hann')return .5-.5*Math.cos(phase); if(type==='hamming')return .54-.46*Math.cos(phase); if(type==='blackman')return .42-.5*Math.cos(phase)+.08*Math.cos(2*phase); if(type==='flattop')return .21557895-.41663158*Math.cos(phase)+.277263158*Math.cos(2*phase)-.083578947*Math.cos(3*phase)+.006947368*Math.cos(4*phase); return 1; }
export function realSpectrum(samples, sampleRateHz, windowType='hann') {
  const size=samples.length; requirePositive(sampleRateHz,'Sample rate'); if(size<2||(size&(size-1)))throw new RangeError('FFT length must be a power of two.');
  const real=new Float64Array(size),imag=new Float64Array(size); let gain=0;
  for(let i=0;i<size;i++){const w=windowCoefficient(windowType,i,size);real[i]=samples[i]*w;gain+=w;}
  for(let i=1,j=0;i<size;i++){let bit=size>>1;for(;j&bit;bit>>=1)j^=bit;j^=bit;if(i<j){[real[i],real[j]]=[real[j],real[i]];}}
  for(let length=2;length<=size;length<<=1){const angle=-2*Math.PI/length,wr0=Math.cos(angle),wi0=Math.sin(angle);for(let start=0;start<size;start+=length){let wr=1,wi=0;for(let j=0;j<length/2;j++){const even=start+j,odd=even+length/2,tr=wr*real[odd]-wi*imag[odd],ti=wr*imag[odd]+wi*real[odd];real[odd]=real[even]-tr;imag[odd]=imag[even]-ti;real[even]+=tr;imag[even]+=ti;const next=wr*wr0-wi*wi0;wi=wr*wi0+wi*wr0;wr=next;}}}
  return Array.from({length:size/2+1},(_,bin)=>({frequency:bin*sampleRateHz/size,amplitude:(bin===0||bin===size/2?1:2)*Math.hypot(real[bin],imag[bin])/gain}));
}
