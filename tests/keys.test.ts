import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { directionToKey, keysToSequence, keyToSequence } from '../src/keys.js';

describe('keyToSequence', () => {
  it('maps common keys', () => {
    assert.equal(keyToSequence('Enter'), '\r');
    assert.equal(keyToSequence('Tab'), '\t');
    assert.equal(keyToSequence('ArrowDown'), '\x1b[B');
    assert.equal(keyToSequence('PageUp'), '\x1b[5~');
    assert.equal(keyToSequence('F10'), '\x1b[21~');
  });

  it('maps ctrl combinations', () => {
    assert.equal(keyToSequence('Ctrl+C'), '\x03');
    assert.equal(keyToSequence('Ctrl+D'), '\x04');
  });

  it('combines multiple keys', () => {
    assert.equal(keysToSequence(['ArrowDown', 'ArrowDown', 'Enter']), '\x1b[B\x1b[B\r');
  });
});

describe('directionToKey', () => {
  it('maps scroll directions to arrow keys', () => {
    assert.equal(directionToKey('up'), 'ArrowUp');
    assert.equal(directionToKey('down'), 'ArrowDown');
    assert.equal(directionToKey('left'), 'ArrowLeft');
    assert.equal(directionToKey('right'), 'ArrowRight');
  });
});
