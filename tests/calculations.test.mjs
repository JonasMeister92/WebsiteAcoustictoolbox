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
