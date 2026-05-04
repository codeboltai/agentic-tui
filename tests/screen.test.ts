import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import xterm from '@xterm/headless';
import { awaitWrite, cursorInfo, readRegion, readScreen, searchScreen } from '../src/screen.js';

const { Terminal } = xterm as typeof import('@xterm/headless');

describe('screen helpers', () => {
  it('renders visible screen text', async () => {
    const terminal = new Terminal({ cols: 20, rows: 5, allowProposedApi: true });
    await awaitWrite(terminal, 'hello\r\nworld');
    assert.match(readScreen(terminal, { includeEmpty: false, trimWhitespace: true }), /hello/);
    terminal.dispose();
  });

  it('extracts a rectangular region', async () => {
    const terminal = new Terminal({ cols: 20, rows: 5, allowProposedApi: true });
    await awaitWrite(terminal, 'ABCDEFGHIJ\r\nKLMNOPQRST\r\n');
    assert.equal(readRegion(terminal, 1, 2, 1, 4), 'MNOP');
    terminal.dispose();
  });

  it('searches plain text and regex', async () => {
    const terminal = new Terminal({ cols: 40, rows: 5, allowProposedApi: true });
    await awaitWrite(terminal, 'abc 123\r\ndef 456\r\n');
    assert.equal(searchScreen(terminal, '456')[0].col, 4);
    assert.equal(searchScreen(terminal, '\\d+', true).length, 2);
    terminal.dispose();
  });

  it('reports cursor position', async () => {
    const terminal = new Terminal({ cols: 40, rows: 5, allowProposedApi: true });
    await awaitWrite(terminal, 'abc');
    assert.equal(cursorInfo(terminal).x, 3);
    terminal.dispose();
  });
});
