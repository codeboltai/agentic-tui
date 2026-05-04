import { AgenticTuiError } from './errors.js';

export type MouseProtocol = 'auto' | 'sgr' | 'normal' | 'urxvt';
export type ResolvedMouseProtocol = Exclude<MouseProtocol, 'auto'>;

export interface MouseState {
  trackingModes: Set<number>;
  protocol: ResolvedMouseProtocol;
  parserTail: string;
}

export interface MouseWheelInput {
  direction: string;
  amount?: number;
  row?: number;
  col?: number;
  rows: number;
  cols: number;
  protocol?: MouseProtocol;
  state?: MouseState;
}

export interface EncodedMouseWheel {
  data: string;
  protocol: ResolvedMouseProtocol;
  amount: number;
  row: number;
  col: number;
  trackingEnabled: boolean;
}

const TRACKING_MODES = new Set([9, 1000, 1002, 1003]);
const PRIVATE_MODE_RE = /\x1b\[\?([0-9;]*)([hl])/g;

export function createMouseState(): MouseState {
  return {
    trackingModes: new Set(),
    protocol: 'sgr',
    parserTail: '',
  };
}

export function updateMouseStateFromOutput(state: MouseState, data: string): void {
  const input = state.parserTail + data;
  PRIVATE_MODE_RE.lastIndex = 0;

  for (let match = PRIVATE_MODE_RE.exec(input); match; match = PRIVATE_MODE_RE.exec(input)) {
    const enabled = match[2] === 'h';
    for (const value of match[1].split(';')) {
      const code = Number.parseInt(value, 10);
      if (!Number.isFinite(code)) continue;
      applyPrivateMode(state, code, enabled);
    }
  }

  state.parserTail = input.slice(-64);
}

export function encodeMouseWheel(input: MouseWheelInput): EncodedMouseWheel {
  const amount = Math.max(1, Math.floor(input.amount ?? 1));
  const row = clampCoordinate(input.row ?? Math.ceil(input.rows / 2), input.rows);
  const col = clampCoordinate(input.col ?? Math.ceil(input.cols / 2), input.cols);
  const button = wheelButton(input.direction);
  const protocol = resolveProtocol(input.protocol ?? 'auto', input.state);
  const event = encodeMouseEvent(protocol, button, col, row);

  return {
    data: event.repeat(amount),
    protocol,
    amount,
    row,
    col,
    trackingEnabled: (input.state?.trackingModes.size ?? 0) > 0,
  };
}

function applyPrivateMode(state: MouseState, code: number, enabled: boolean): void {
  if (TRACKING_MODES.has(code)) {
    if (enabled) state.trackingModes.add(code);
    else state.trackingModes.delete(code);
    return;
  }

  if (code === 1006) {
    if (enabled) state.protocol = 'sgr';
    else if (state.protocol === 'sgr') state.protocol = 'normal';
    return;
  }

  if (code === 1015) {
    if (enabled) state.protocol = 'urxvt';
    else if (state.protocol === 'urxvt') state.protocol = 'normal';
  }
}

function resolveProtocol(protocol: MouseProtocol, state: MouseState | undefined): ResolvedMouseProtocol {
  if (protocol === 'auto') return state?.protocol ?? 'sgr';
  return protocol;
}

function wheelButton(direction: string): number {
  switch (direction.toLowerCase()) {
    case 'up':
      return 64;
    case 'down':
      return 65;
    case 'left':
      return 66;
    case 'right':
      return 67;
    default:
      throw new AgenticTuiError('INVALID_DIRECTION', `Unsupported wheel direction: ${direction}`);
  }
}

function encodeMouseEvent(protocol: ResolvedMouseProtocol, button: number, col: number, row: number): string {
  if (protocol === 'sgr') return `\x1b[<${button};${col};${row}M`;
  if (protocol === 'urxvt') return `\x1b[${button + 32};${col};${row}M`;
  return `\x1b[M${mouseChar(button)}${mouseChar(col)}${mouseChar(row)}`;
}

function mouseChar(value: number): string {
  return String.fromCharCode(clampCoordinate(value, 223) + 32);
}

function clampCoordinate(value: number, max: number): number {
  if (!Number.isFinite(value)) return 1;
  return Math.min(Math.max(1, Math.floor(value)), Math.max(1, max));
}
