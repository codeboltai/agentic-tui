import { AgenticTuiError } from './errors.js';

const NAMED_KEYS: Record<string, string> = {
  enter: '\r',
  return: '\r',
  tab: '\t',
  escape: '\x1b',
  esc: '\x1b',
  backspace: '\x7f',
  delete: '\x1b[3~',
  arrowup: '\x1b[A',
  up: '\x1b[A',
  arrowdown: '\x1b[B',
  down: '\x1b[B',
  arrowright: '\x1b[C',
  right: '\x1b[C',
  arrowleft: '\x1b[D',
  left: '\x1b[D',
  home: '\x1b[H',
  end: '\x1b[F',
  pageup: '\x1b[5~',
  pagedown: '\x1b[6~',
  space: ' ',
};

const FUNCTION_KEYS: Record<string, string> = {
  f1: '\x1bOP',
  f2: '\x1bOQ',
  f3: '\x1bOR',
  f4: '\x1bOS',
  f5: '\x1b[15~',
  f6: '\x1b[17~',
  f7: '\x1b[18~',
  f8: '\x1b[19~',
  f9: '\x1b[20~',
  f10: '\x1b[21~',
  f11: '\x1b[23~',
  f12: '\x1b[24~',
};

export function keyToSequence(key: string): string {
  const normalized = key.replace(/[-_\s]/g, '').toLowerCase();
  if (NAMED_KEYS[normalized]) return NAMED_KEYS[normalized];
  if (FUNCTION_KEYS[normalized]) return FUNCTION_KEYS[normalized];

  const ctrlMatch = normalized.match(/^ctrl\+?(.+)$/);
  if (ctrlMatch) return ctrlSequence(ctrlMatch[1]);

  if (key.length === 1) return key;
  throw new AgenticTuiError('INVALID_KEY', `Unsupported key: ${key}`);
}

export function keysToSequence(keys: string[]): string {
  return keys.map(keyToSequence).join('');
}

export function directionToKey(direction: string): string {
  switch (direction.toLowerCase()) {
    case 'up':
      return 'ArrowUp';
    case 'down':
      return 'ArrowDown';
    case 'left':
      return 'ArrowLeft';
    case 'right':
      return 'ArrowRight';
    default:
      throw new AgenticTuiError('INVALID_DIRECTION', `Unsupported scroll direction: ${direction}`);
  }
}

function ctrlSequence(value: string): string {
  if (value.length !== 1) {
    throw new AgenticTuiError('INVALID_KEY', `Ctrl combinations require a single key, got Ctrl+${value}`);
  }
  const code = value.toUpperCase().charCodeAt(0);
  if (code >= 65 && code <= 90) return String.fromCharCode(code - 64);
  if (value === '[') return '\x1b';
  if (value === '\\') return '\x1c';
  if (value === ']') return '\x1d';
  if (value === '^') return '\x1e';
  if (value === '_') return '\x1f';
  throw new AgenticTuiError('INVALID_KEY', `Unsupported Ctrl combination: Ctrl+${value}`);
}
