import test from 'node:test';
import assert from 'node:assert/strict';
import {
  addDecibels, energeticAverage, subtractBackground, pressureToSpl, splToPressure,
  powerToLevel, levelToPower, propagationTerm, pressureLevelToPowerLevel,
  powerLevelToPressureLevel, distanceAttenuation, levelAtDistance, dopplerFrequency
} from '../assets/js/calculations.mjs';
import {
  atmosphericAbsorptionCoefficient, atmosphericAttenuation, geometricDivergence, maekawaBarrierAttenuation,
  propagateBand, energeticSum
} from '../assets/js/outdoor-propagation.mjs';
import { frequencyToPeriod, periodToFrequency, fftResolution, aliasFrequency, nextPowerOfTwo, realSpectrum } from '../assets/js/signal-processing.mjs';
import { applyAmplitudeModulation, encodeFloat32Wav, generateBurstSequence, generateFrequencyModulation, generateMultiTone, generateSound, generateSweep, levelFromPressure, pressureFromLevel } from '../assets/js/sound-generator-core.mjs';

const closeTo = (actual, expected, tolerance = 1e-4) => assert.ok(Math.abs(actual - expected) < tolerance, `${actual} is not close to ${expected}`);

test('adds two equal 70 dB levels', () => closeTo(addDecibels([70, 70]), 73.0103));
test('adds 70 dB and 60 dB', () => closeTo(addDecibels([70, 60]), 70.4139));
test('energetic average of equal levels remains unchanged', () => closeTo(energeticAverage([60, 60, 60]), 60));
test('subtracts 60 dB background from 70 dB total', () => closeTo(subtractBackground(70, 60), 69.5424));
test('rejects invalid background levels', () => {
  assert.throws(() => subtractBackground(60, 60), RangeError);
  assert.throws(() => subtractBackground(60, 61), RangeError);
});
test('remains stable with extreme finite levels', () => closeTo(addDecibels([1000, 1000]), 1003.0103));
test('converts 1 Pa to 93.9794 dB SPL and back', () => {
  closeTo(pressureToSpl(1), 93.9794);
  closeTo(splToPressure(93.9794), 1, 1e-5);
});
test('converts 1 W to 120 dB and back', () => {
  closeTo(powerToLevel(1), 120);
  closeTo(levelToPower(120), 1);
});
test('calculates spherical propagation at 1 m', () => closeTo(propagationTerm(1, 1), 10.9921));
test('converts between pressure and power level reversibly', () => {
  const powerLevel = pressureLevelToPowerLevel(80, 2, 2, 1.5);
  closeTo(powerLevelToPressureLevel(powerLevel, 2, 2, 1.5), 80);
});
test('rejects non-positive physical quantities', () => {
  assert.throws(() => pressureToSpl(0), RangeError);
  assert.throws(() => powerToLevel(-1), RangeError);
  assert.throws(() => propagationTerm(0, 1), RangeError);
  assert.throws(() => propagationTerm(1, 0), RangeError);
});
test('ISO geometrical divergence is 11 dB at 1 m', () => closeTo(geometricDivergence(1), 11));
test('atmospheric absorption grows with frequency at standard conditions', () => {
  assert.ok(atmosphericAbsorptionCoefficient(8000, 20, 70) > atmosphericAbsorptionCoefficient(1000, 20, 70));
});
test('ISO atmospheric coefficient matches the 1 kHz reference calculation', () => {
  closeTo(atmosphericAbsorptionCoefficient(1000, 20, 70, 101.325), 0.00463558, 1e-8);
});
test('atmospheric attenuation scales linearly with distance', () => {
  const environment = { temperatureC: 20, humidityPercent: 70, pressureKPa: 101.325 };
  closeTo(atmosphericAttenuation(1000, 1000, environment), 4.63558, 1e-5);
});
test('Maekawa screen attenuates only when it interrupts line of sight', () => {
  const source = { x: 0, y: 2 }, receiver = { x: 20, y: 2 };
  assert.ok(maekawaBarrierAttenuation(1000, source, receiver, { x: 10, height: 4 }).attenuation > 5);
  assert.equal(maekawaBarrierAttenuation(1000, source, receiver, { x: 10, height: 1 }).attenuation, 0);
});
test('propagation components reconcile with receiver level', () => {
  const result = propagateBand({ sourceLevel: 100, frequencyHz: 1000, source: { x: 0, y: 2 }, receiver: { x: 10, y: 2 }, environment: { temperatureC: 20, humidityPercent: 70, pressureKPa: 101.325 } });
  closeTo(result.receiverLevel, 100 - result.divergence - result.atmosphere - result.ground - result.barrier);
});
test('energetic sum of equal levels adds 3.0103 dB', () => closeTo(energeticSum([60, 60]), 63.0103));
test('point source loses approximately 6.02 dB per distance doubling', () => closeTo(distanceAttenuation(1, 2, 2), 6.0206));
test('line source loses approximately 3.01 dB per distance doubling', () => closeTo(distanceAttenuation(1, 2, 1), 3.0103));
test('calculates the level at a target distance', () => closeTo(levelAtDistance(80, 1, 10, 2), 60));
test('permits a target closer than the reference position', () => closeTo(levelAtDistance(80, 10, 1, 2), 100));
test('calculates Doppler shift for an approaching source', () => closeTo(dopplerFrequency(440, 343.2, 0, 25), 474.5695));
test('calculates Doppler shift for an approaching receiver', () => closeTo(dopplerFrequency(440, 343.2, 25, 0), 472.0513));
test('Doppler shift is unchanged without relative motion', () => closeTo(dopplerFrequency(1000, 343.2), 1000));
test('rejects sonic and supersonic Doppler inputs', () => assert.throws(() => dopplerFrequency(440, 343.2, 0, 343.2), RangeError));
test('converts frequency and period reversibly', () => closeTo(periodToFrequency(frequencyToPeriod(1000)), 1000));
test('calculates FFT resolution', () => closeTo(fftResolution(48000, 4800), 10));
test('folds frequencies around Nyquist', () => closeTo(aliasFrequency(10000, 16000), 6000));
test('finds next FFT power of two', () => assert.equal(nextPowerOfTwo(4800), 8192));
test('FFT locates an exact-bin sinusoid', () => { const sampleRate=1024,size=1024,samples=Float64Array.from({length:size},(_,i)=>Math.sin(2*Math.PI*64*i/sampleRate)); const spectrum=realSpectrum(samples,sampleRate,'rectangular'); const peak=spectrum.reduce((a,b)=>b.amplitude>a.amplitude?b:a); closeTo(peak.frequency,64); closeTo(peak.amplitude,1,1e-8); });
test('sound level and RMS pressure convert reversibly', () => closeTo(levelFromPressure(pressureFromLevel(94)),94));
test('sound generator applies the requested RMS pressure and click-free fade', () => { const signal=generateSound({type:'sine',frequency:1000,duration:.1,sampleRate:48000,rmsPressurePa:1,fadeMs:5}); const rms=Math.sqrt(signal.samples.reduce((sum,value)=>sum+value*value,0)/signal.samples.length); closeTo(rms,1,1e-6);assert.equal(Math.abs(signal.samples[0]),0);assert.equal(Math.abs(signal.samples.at(-1)),0); });
test('noise generation is repeatable', () => { const options={type:'pink',duration:.05,sampleRate:8000,rmsPressurePa:.1}; assert.deepEqual(generateSound(options).samples,generateSound(options).samples); });
test('32-bit float WAV has the expected format and size', () => { const samples=new Float32Array([-.5,0,.5]),wav=encodeFloat32Wav(samples,48000),view=new DataView(wav); assert.equal(wav.byteLength,56);assert.equal(view.getUint16(20,true),3);assert.equal(view.getUint16(34,true),32);assert.equal(view.getFloat32(52,true),.5); });
test('amplitude modulation preserves requested RMS and reports its envelope', () => { const carrier=generateSound({type:'sine',frequency:1000,duration:.1,sampleRate:48000,rmsPressurePa:1,fadeMs:0});const modulated=applyAmplitudeModulation(carrier.samples,{sampleRate:48000,frequency:100,depthPercent:80,rmsPressurePa:.5,fadeMs:0});const rms=Math.sqrt(modulated.samples.reduce((sum,value)=>sum+value*value,0)/modulated.samples.length);closeTo(rms,.5,1e-6);closeTo(modulated.envelopeMin,.2,1e-6);closeTo(modulated.envelopeMax,1.8,1e-6);assert.equal(modulated.overmodulated,false); });
test('amplitude modulation identifies overmodulation', () => { const carrier=new Float32Array(800).fill(1);const modulated=applyAmplitudeModulation(carrier,{sampleRate:8000,frequency:10,depthPercent:150,rmsPressurePa:1,fadeMs:0});assert.equal(modulated.overmodulated,true);assert.ok(modulated.envelopeMin<0); });
test('frequency modulation reports range and preserves RMS', () => { const x=generateFrequencyModulation({carrierFrequency:1000,modulationFrequency:10,deviationHz:100,duration:.1,sampleRate:48000,fadeMs:0,rmsPressurePa:.25});closeTo(x.minFrequency,900);closeTo(x.maxFrequency,1100);closeTo(x.modulationIndex,10);closeTo(Math.sqrt(x.samples.reduce((s,v)=>s+v*v,0)/x.samples.length),.25,1e-6); });
test('sweep generator supports linear and logarithmic trajectories', () => { for(const law of ['linear','logarithmic']){const x=generateSweep({startFrequency:100,endFrequency:1000,law,duration:.1,sampleRate:48000,fadeMs:0,rmsPressurePa:.2});assert.equal(x.law,law);closeTo(Math.sqrt(x.samples.reduce((s,v)=>s+v*v,0)/x.samples.length),.2,1e-6);} });
test('multi-tone generator combines enabled tones', () => { const x=generateMultiTone({tones:[{frequency:500,levelDb:0},{frequency:1000,levelDb:-6,enabled:false},{frequency:1500,levelDb:-12}],duration:.1,sampleRate:48000,fadeMs:0,rmsPressurePa:.3});assert.equal(x.toneCount,2);closeTo(Math.sqrt(x.samples.reduce((s,v)=>s+v*v,0)/x.samples.length),.3,1e-6); });
test('burst generator creates silent off intervals', () => { const x=generateBurstSequence({onSeconds:.02,offSeconds:.02,repetitions:3,rampMs:1,sampleRate:8000,rmsPressurePa:.1});assert.equal(x.samples.length,960);closeTo(x.dutyCycle,.5);assert.equal(x.samples[200],0); });
