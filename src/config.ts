import os from 'node:os';
import path from 'node:path';

export const APP_NAME = 'agentic-tui';
export const DEFAULT_COLS = 120;
export const DEFAULT_ROWS = 40;
export const MIN_COLS = 10;
export const MIN_ROWS = 2;
export const MAX_COLS = 500;
export const MAX_ROWS = 200;
export const DEFAULT_IDLE_TIMEOUT_MS = 10 * 60 * 1000;
export const MAX_WAIT_MS = 60_000;
export const DEFAULT_WAIT_TIMEOUT_MS = 30_000;
export const SNAPSHOT_TAIL_BYTES = 50_000;
export const STREAM_TAIL_BYTES = 1024 * 1024;

export function stateDir(): string {
  if (process.env.AGENTIC_TUI_STATE_DIR) return process.env.AGENTIC_TUI_STATE_DIR;
  if (process.platform === 'win32') {
    return path.join(process.env.LOCALAPPDATA ?? os.tmpdir(), APP_NAME);
  }
  return path.join(process.env.XDG_STATE_HOME ?? path.join(os.homedir(), '.local', 'state'), APP_NAME);
}

export function daemonStatePath(): string {
  return path.join(stateDir(), 'daemon.json');
}

export function sessionsPath(): string {
  return path.join(stateDir(), 'sessions.jsonl');
}

export function activeSessionPath(): string {
  return path.join(stateDir(), 'active-session.json');
}

export function clampSize(cols?: number, rows?: number): { cols: number; rows: number } {
  return {
    cols: clampDimension(cols, DEFAULT_COLS, MIN_COLS, MAX_COLS),
    rows: clampDimension(rows, DEFAULT_ROWS, MIN_ROWS, MAX_ROWS),
  };
}

function clampDimension(value: number | undefined, fallback: number, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isInteger(value)) return fallback;
  return Math.max(min, Math.min(max, value));
}
