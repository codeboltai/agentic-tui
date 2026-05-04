export type OutputMode = 'streaming' | 'snapshot' | 'screen';

export interface TerminalSize {
  cols: number;
  rows: number;
}

export interface CursorInfo {
  x: number;
  y: number;
  currentLine: string;
  isAlternateBuffer: boolean;
}

export interface SessionSummary {
  id: string;
  command: string;
  args: string[];
  cwd: string;
  pid: number;
  cols: number;
  rows: number;
  running: boolean;
  createdAt: string;
  idleSeconds: number;
  isAlternateBuffer: boolean;
}

export interface RpcRequest {
  method: string;
  params?: Record<string, unknown>;
}

export interface RpcSuccess<T = unknown> {
  ok: true;
  result: T;
}

export interface RpcFailure {
  ok: false;
  error: {
    code: string;
    message: string;
  };
}

export type RpcResponse<T = unknown> = RpcSuccess<T> | RpcFailure;
