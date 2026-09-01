import test from 'node:test';
import assert from 'node:assert/strict';
import { addDecibels, energeticAverage, subtractBackground } from '../assets/js/calculations.mjs';

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
