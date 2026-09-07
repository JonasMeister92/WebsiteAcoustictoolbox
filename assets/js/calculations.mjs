function validLevels(levels) {
  if (!Array.isArray(levels) || levels.length === 0 || levels.some((level) => !Number.isFinite(level))) {
    throw new TypeError('Provide one or more finite sound levels.');
  }
}

export function addDecibels(levels) {
  validLevels(levels);
  const maximum = Math.max(...levels);
  const relativeSum = levels.reduce((sum, level) => sum + 10 ** ((level - maximum) / 10), 0);
  return maximum + 10 * Math.log10(relativeSum);
}

export function energeticAverage(levels) {
  validLevels(levels);
  return addDecibels(levels) - 10 * Math.log10(levels.length);
}

export function subtractBackground(total, background) {
  if (!Number.isFinite(total) || !Number.isFinite(background)) {
    throw new TypeError('Both levels must be finite numbers.');
  }
  if (background >= total) {
    throw new RangeError('Background level must be lower than the measured total level.');
  }
  return total + 10 * Math.log10(1 - 10 ** ((background - total) / 10));
}

export const REFERENCE_PRESSURE = 20e-6;
export const REFERENCE_POWER = 1e-12;

function requireFinite(value, name) {
  if (!Number.isFinite(value)) throw new TypeError(`${name} must be a finite number.`);
}

function requirePositive(value, name) {
  requireFinite(value, name);
  if (value <= 0) throw new RangeError(`${name} must be greater than zero.`);
}

export function pressureToSpl(pressurePa) {
  requirePositive(pressurePa, 'Sound pressure');
  return 20 * Math.log10(pressurePa / REFERENCE_PRESSURE);
}

export function splToPressure(levelDb) {
  requireFinite(levelDb, 'Sound pressure level');
  return REFERENCE_PRESSURE * 10 ** (levelDb / 20);
}

export function powerToLevel(powerW) {
  requirePositive(powerW, 'Sound power');
  return 10 * Math.log10(powerW / REFERENCE_POWER);
}

export function levelToPower(levelDb) {
  requireFinite(levelDb, 'Sound power level');
  return REFERENCE_POWER * 10 ** (levelDb / 10);
}

export function propagationTerm(distanceM, directivityFactor = 1) {
  requirePositive(distanceM, 'Distance');
  requirePositive(directivityFactor, 'Directivity factor');
  return 10 * Math.log10((4 * Math.PI * distanceM ** 2) / directivityFactor);
}

export function pressureLevelToPowerLevel(pressureLevelDb, distanceM, directivityFactor = 1, attenuationDb = 0) {
  requireFinite(pressureLevelDb, 'Sound pressure level');
  requireFinite(attenuationDb, 'Additional attenuation');
  return pressureLevelDb + propagationTerm(distanceM, directivityFactor) + attenuationDb;
}

export function powerLevelToPressureLevel(powerLevelDb, distanceM, directivityFactor = 1, attenuationDb = 0) {
  requireFinite(powerLevelDb, 'Sound power level');
  requireFinite(attenuationDb, 'Additional attenuation');
  return powerLevelDb - propagationTerm(distanceM, directivityFactor) - attenuationDb;
}

export function distanceAttenuation(referenceDistanceM, targetDistanceM, spreadingExponent = 2) {
  requirePositive(referenceDistanceM, 'Reference distance');
  requirePositive(targetDistanceM, 'Target distance');
  requirePositive(spreadingExponent, 'Spreading exponent');
  return 10 * spreadingExponent * Math.log10(targetDistanceM / referenceDistanceM);
}

export function levelAtDistance(referenceLevelDb, referenceDistanceM, targetDistanceM, spreadingExponent = 2) {
  requireFinite(referenceLevelDb, 'Reference level');
  return referenceLevelDb - distanceAttenuation(referenceDistanceM, targetDistanceM, spreadingExponent);
}

export function dopplerFrequency(sourceFrequencyHz, soundSpeedMps, receiverVelocityMps = 0, sourceVelocityMps = 0) {
  requirePositive(sourceFrequencyHz, 'Source frequency');
  requirePositive(soundSpeedMps, 'Speed of sound');
  requireFinite(receiverVelocityMps, 'Receiver velocity');
  requireFinite(sourceVelocityMps, 'Source velocity');
  if (Math.abs(receiverVelocityMps) >= soundSpeedMps) throw new RangeError('Receiver speed must remain below the speed of sound.');
  if (Math.abs(sourceVelocityMps) >= soundSpeedMps) throw new RangeError('Source speed must remain below the speed of sound.');
  return sourceFrequencyHz * (soundSpeedMps + receiverVelocityMps) / (soundSpeedMps - sourceVelocityMps);
}
