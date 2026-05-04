import xterm from '@xterm/headless';
import type { Terminal as XTermTerminal } from '@xterm/headless';
import { AgenticTuiError } from './errors.js';

const { Terminal } = xterm as typeof import('@xterm/headless');

export function awaitWrite(terminal: XTermTerminal, data: string): Promise<void> {
  return new Promise((resolve) => terminal.write(data, resolve));
}

export interface ReadScreenOptions {
  startRow?: number;
  endRow?: number;
  trimWhitespace?: boolean;
  includeEmpty?: boolean;
}

export function readScreen(terminal: XTermTerminal, options: ReadScreenOptions = {}): string {
  const buffer = terminal.buffer.active;
  const viewportStart = buffer.viewportY;
  const startRow = clamp(options.startRow ?? 0, 0, terminal.rows);
  const endRow = clamp(options.endRow ?? terminal.rows, 0, terminal.rows);
  const trim = options.trimWhitespace ?? false;

  const lines: string[] = [];
  for (let y = startRow; y < endRow; y += 1) {
    const line = buffer.getLine(viewportStart + y);
    lines.push(line?.translateToString(trim) ?? '');
  }

  if (options.includeEmpty === false) {
    while (lines.length > 0 && lines[lines.length - 1].trim() === '') lines.pop();
  }

  return lines.join('\n');
}

export function readRegion(
  terminal: XTermTerminal,
  row: number,
  col: number,
  rows: number,
  cols: number,
  trimWhitespace = false,
): string {
  if (!Number.isInteger(row) || !Number.isInteger(col) || !Number.isInteger(rows) || !Number.isInteger(cols)) {
    throw new AgenticTuiError('INVALID_REGION', 'Region row, col, rows, and cols must be integers');
  }
  if (rows < 0 || cols < 0) {
    throw new AgenticTuiError('INVALID_REGION', 'Region rows and cols must be non-negative');
  }

  const startRow = clamp(row, 0, terminal.rows);
  const startCol = clamp(col, 0, terminal.cols);
  const endRow = clamp(row + rows, 0, terminal.rows);
  const endCol = clamp(col + cols, 0, terminal.cols);
  const buffer = terminal.buffer.active;
  const viewportStart = buffer.viewportY;
  const lines: string[] = [];

  for (let y = startRow; y < endRow; y += 1) {
    const line = buffer.getLine(viewportStart + y);
    lines.push(line?.translateToString(trimWhitespace, startCol, endCol) ?? '');
  }

  return lines.join('\n');
}

export interface SearchResult {
  row: number;
  col: number;
  text: string;
}

export function searchScreen(terminal: XTermTerminal, pattern: string, regex = false): SearchResult[] {
  if (!pattern) throw new AgenticTuiError('INVALID_SEARCH', 'Search pattern cannot be empty');
  if (pattern.length > 500) throw new AgenticTuiError('INVALID_SEARCH', 'Search pattern is too long');

  let compiled: RegExp | undefined;
  if (regex) {
    try {
      compiled = new RegExp(pattern, 'g');
    } catch {
      throw new AgenticTuiError('INVALID_SEARCH', `Invalid regex pattern: ${pattern}`);
    }
  }

  const buffer = terminal.buffer.active;
  const viewportStart = buffer.viewportY;
  const results: SearchResult[] = [];

  for (let y = 0; y < terminal.rows && results.length < 50; y += 1) {
    const line = buffer.getLine(viewportStart + y);
    if (!line) continue;
    const text = line.translateToString(true);

    if (compiled) {
      compiled.lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = compiled.exec(text)) && results.length < 50) {
        results.push({ row: y, col: match.index, text: match[0] });
        if (match[0].length === 0) compiled.lastIndex += 1;
      }
    } else {
      let start = 0;
      let index = text.indexOf(pattern, start);
      while (index !== -1 && results.length < 50) {
        results.push({ row: y, col: index, text: pattern });
        start = index + 1;
        index = text.indexOf(pattern, start);
      }
    }
  }

  return results;
}

export function cursorInfo(terminal: XTermTerminal): { x: number; y: number; currentLine: string; isAlternateBuffer: boolean } {
  const buffer = terminal.buffer.active;
  const line = buffer.getLine(buffer.viewportY + buffer.cursorY);
  return {
    x: buffer.cursorX,
    y: buffer.cursorY,
    currentLine: line?.translateToString(true) ?? '',
    isAlternateBuffer: buffer === terminal.buffer.alternate,
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
