import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSample, parseNotes } from '../demo/input.js';
test('reject malformed or empty note data before WASM invocation', () => {
  for (const input of ['{}', '[]', '[null]', '[{"time":-1,"kind":"tap"}]', '[{"time":1,"kind":0}]']) {
    assert.throws(() => parseNotes(input));
  }
});
test('sample has silent lead-in and known delayed onsets', () => {
  const { pcm, sampleRate, notes } = createSample();
  assert.equal(parseNotes(JSON.stringify(notes)).length, 8);
  assert.equal(pcm.length, sampleRate * 6);
  assert(pcm.subarray(0, Math.round((notes[0].time + 0.123) * sampleRate)).every(x => x === 0));
  assert(pcm.some(x => Math.abs(x) > 0.1));
});
