import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createMouseState, encodeMouseWheel, updateMouseStateFromOutput } from '../src/mouse.js';

describe('encodeMouseWheel', () => {
  it('encodes SGR wheel events', () => {
    const event = encodeMouseWheel({ direction: 'down', amount: 2, row: 4, col: 9, rows: 24, cols: 80, protocol: 'sgr' });

    assert.equal(event.data, '\x1b[<65;9;4M\x1b[<65;9;4M');
    assert.equal(event.protocol, 'sgr');
    assert.equal(event.row, 4);
    assert.equal(event.col, 9);
  });

  it('encodes legacy normal wheel events', () => {
    const event = encodeMouseWheel({ direction: 'up', row: 1, col: 1, rows: 24, cols: 80, protocol: 'normal' });

    assert.equal(event.data, '\x1b[M`!!');
    assert.equal(event.protocol, 'normal');
  });

  it('defaults to the terminal center', () => {
    const event = encodeMouseWheel({ direction: 'up', rows: 25, cols: 81, protocol: 'sgr' });

    assert.equal(event.data, '\x1b[<64;41;13M');
  });

  it('auto mode falls back to SGR', () => {
    const event = encodeMouseWheel({ direction: 'down', row: 2, col: 3, rows: 24, cols: 80, state: createMouseState() });

    assert.equal(event.data, '\x1b[<65;3;2M');
    assert.equal(event.protocol, 'sgr');
  });
});

describe('updateMouseStateFromOutput', () => {
  it('tracks SGR mouse mode split across chunks', () => {
    const state = createMouseState();

    updateMouseStateFromOutput(state, '\x1b[?100');
    updateMouseStateFromOutput(state, '0;1006h');

    assert.equal(state.trackingModes.has(1000), true);
    assert.equal(state.protocol, 'sgr');

    const event = encodeMouseWheel({ direction: 'down', rows: 24, cols: 80, state });
    assert.equal(event.protocol, 'sgr');
    assert.equal(event.trackingEnabled, true);
  });
});
