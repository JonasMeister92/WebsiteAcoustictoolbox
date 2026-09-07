export const THIRD_OCTAVE_BANDS = [50,63,80,100,125,160,200,250,315,400,500,630,800,1000,1250,1600,2000,2500,3150,4000,5000,6300,8000,10000];

export const A_WEIGHTING = [-30.2,-26.2,-22.5,-19.1,-16.1,-13.4,-10.9,-8.6,-6.6,-4.8,-3.2,-1.9,-.8,0,.6,1,1.2,1.3,1.2,1,.5,-.1,-1.1,-2.5];

function positive(value, label) {
  if (!Number.isFinite(value) || value <= 0) throw new RangeError(`${label} must be greater than zero.`);
}

export function distanceBetween(source, receiver) {
  return Math.hypot(receiver.x - source.x, receiver.y - source.y);
}

export function geometricDivergence(distanceM) {
  positive(distanceM, 'Distance');
  return 20 * Math.log10(distanceM) + 11;
}

// ISO 9613-1:1993 atmospheric absorption coefficient for pure tones.
export function atmosphericAbsorptionCoefficient(frequencyHz, temperatureC = 20, humidityPercent = 70, pressureKPa = 101.325) {
  positive(frequencyHz, 'Frequency'); positive(pressureKPa, 'Pressure');
  if (!Number.isFinite(temperatureC) || temperatureC < -20 || temperatureC > 50) throw new RangeError('Temperature must be between -20 and 50 °C.');
  if (!Number.isFinite(humidityPercent) || humidityPercent < 10 || humidityPercent > 100) throw new RangeError('Humidity must be between 10 and 100 %.');
  const temperature = temperatureC + 273.15;
  const referenceTemperature = 293.15;
  const pressureRatio = pressureKPa / 101.325;
  const saturationExponent = -6.8346 * (273.16 / temperature) ** 1.261 + 4.6151;
  const molarConcentration = (humidityPercent / 100) * 10 ** saturationExponent / pressureRatio;
  const oxygenRelaxation = pressureRatio * (24 + 4.04e4 * molarConcentration * (0.02 + molarConcentration) / (0.391 + molarConcentration));
  const nitrogenRelaxation = pressureRatio * (temperature / referenceTemperature) ** -0.5 * (9 + 280 * molarConcentration * Math.exp(-4.17 * ((temperature / referenceTemperature) ** (-1 / 3) - 1)));
  const classical = 1.84e-11 / pressureRatio * Math.sqrt(temperature / referenceTemperature);
  const molecular = (temperature / referenceTemperature) ** -2.5 * (
    0.01275 * Math.exp(-2239.1 / temperature) / (oxygenRelaxation + frequencyHz ** 2 / oxygenRelaxation) +
    0.1068 * Math.exp(-3352 / temperature) / (nitrogenRelaxation + frequencyHz ** 2 / nitrogenRelaxation)
  );
  return 8.686 * frequencyHz ** 2 * (classical + molecular);
}

export function atmosphericAttenuation(frequencyHz, distanceM, environment = {}) {
  positive(distanceM, 'Distance');
  return atmosphericAbsorptionCoefficient(frequencyHz, environment.temperatureC, environment.humidityPercent, environment.pressureKPa) * distanceM;
}

// Deliberately bounded engineering approximation for a homogeneous ground strip.
// It exposes G=0 (hard) to G=1 (porous) but is not a substitute for the full
// source/middle/receiver-region procedure in ISO 9613-2:2024.
export function simplifiedGroundAttenuation(frequencyHz, distanceM, sourceHeightM, receiverHeightM, groundFactor = 0) {
  positive(frequencyHz, 'Frequency'); positive(distanceM, 'Distance'); positive(sourceHeightM, 'Source height'); positive(receiverHeightM, 'Receiver height');
  if (!Number.isFinite(groundFactor) || groundFactor < 0 || groundFactor > 1) throw new RangeError('Ground factor must be between 0 and 1.');
  if (groundFactor === 0) return 0;
  const grazing = Math.min(1, distanceM / (8 * (sourceHeightM + receiverHeightM)));
  const frequencyShape = Math.exp(-((Math.log2(frequencyHz / 500)) ** 2) / 5);
  return Math.max(0, Math.min(4.8, groundFactor * grazing * (1.5 + 3.3 * frequencyShape)));
}

function orientation(a, b, c) { return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x); }

export function barrierBlocksLineOfSight(source, receiver, barrier) {
  const low = { x: barrier.x, y: 0 };
  const high = { x: barrier.x, y: barrier.height };
  return orientation(source, receiver, low) * orientation(source, receiver, high) <= 0 && barrier.x > Math.min(source.x, receiver.x) && barrier.x < Math.max(source.x, receiver.x);
}

export function maekawaBarrierAttenuation(frequencyHz, source, receiver, barrier, soundSpeed = 343) {
  positive(frequencyHz, 'Frequency'); positive(soundSpeed, 'Sound speed');
  if (!barrierBlocksLineOfSight(source, receiver, barrier)) return { attenuation: 0, pathDifference: 0, fresnelNumber: 0 };
  const top = { x: barrier.x, y: barrier.height };
  const direct = distanceBetween(source, receiver);
  const diffracted = distanceBetween(source, top) + distanceBetween(top, receiver);
  const pathDifference = Math.max(0, diffracted - direct);
  const fresnelNumber = 2 * pathDifference * frequencyHz / soundSpeed;
  return { attenuation: Math.min(25, 10 * Math.log10(3 + 20 * fresnelNumber)), pathDifference, fresnelNumber };
}

export function strongestBarrierAttenuation(frequencyHz, source, receiver, barriers = []) {
  return barriers.reduce((best, barrier) => {
    const current = maekawaBarrierAttenuation(frequencyHz, source, receiver, barrier);
    return current.attenuation > best.attenuation ? current : best;
  }, { attenuation: 0, pathDifference: 0, fresnelNumber: 0 });
}

export function propagateBand({ sourceLevel, frequencyHz, source, receiver, environment, groundFactor = 0, barriers = [] }) {
  const distance = distanceBetween(source, receiver);
  positive(distance, 'Distance');
  const divergence = geometricDivergence(distance);
  const atmosphere = atmosphericAttenuation(frequencyHz, distance, environment);
  const ground = simplifiedGroundAttenuation(frequencyHz, Math.abs(receiver.x - source.x), source.y, receiver.y, groundFactor);
  const barrier = strongestBarrierAttenuation(frequencyHz, source, receiver, barriers);
  return { frequencyHz, sourceLevel, distance, divergence, atmosphere, ground, barrier: barrier.attenuation, receiverLevel: sourceLevel - divergence - atmosphere - ground - barrier.attenuation, fresnelNumber: barrier.fresnelNumber };
}

export function energeticSum(levels) {
  const finite = levels.filter(Number.isFinite);
  if (!finite.length) return -Infinity;
  const maximum = Math.max(...finite);
  return maximum + 10 * Math.log10(finite.reduce((sum, level) => sum + 10 ** ((level - maximum) / 10), 0));
}

export function aWeightedTotal(bandResults) {
  return energeticSum(bandResults.map((band) => band.receiverLevel + A_WEIGHTING[THIRD_OCTAVE_BANDS.indexOf(band.frequencyHz)]));
}
