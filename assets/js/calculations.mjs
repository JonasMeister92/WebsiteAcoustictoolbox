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
