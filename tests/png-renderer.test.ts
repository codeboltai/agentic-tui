import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { renderTextGridToPng } from '../src/png-renderer.js';

describe('renderTextGridToPng', () => {
  it('renders a PNG buffer', () => {
    const png = renderTextGridToPng('hello\nworld');
    assert.ok(png.length > 8);
    assert.equal(png.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
  });
});
