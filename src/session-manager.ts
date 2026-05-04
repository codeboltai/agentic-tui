import * as pty from 'node-pty';
import xterm from '@xterm/headless';
import type { Terminal as XTermTerminal } from '@xterm/headless';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { DEFAULT_IDLE_TIMEOUT_MS, SNAPSHOT_TAIL_BYTES, STREAM_TAIL_BYTES, clampSize, sessionsPath } from './config.js';
import { AgenticTuiError } from './errors.js';
import { cursorInfo, awaitWrite, readRegion, readScreen, searchScreen } from './screen.js';
import type { OutputMode, SessionSummary } from './types.js';

const { Terminal } = xterm as typeof import('@xterm/headless');

interface Session {
  id: string;
  command: string;
  args: string[];
  cwd: string;
  ptyProcess: pty.IPty;
  terminal: XTermTerminal;
  outputBuffer: string;
  totalBytesReceived: number;
  lastWritePromise: Promise<void>;
  lastDataTime: number;
  lastActivityTime: number;
  createdAt: string;
  exited?: { exitCode: number; signal?: number; exitedAt: number };
}

export interface RunParams {
  command: string;
  args?: string[];
  cwd?: string;
  env?: Record<string, string>;
  cols?: number;
  rows?: number;
  sessionId?: string;
}

export class SessionManager {
  private readonly sessions = new Map<string, Session>();
  private activeSessionId: string | undefined;
  private cleanupTimer: NodeJS.Timeout;

  constructor(
    private readonly idleTimeoutMs = DEFAULT_IDLE_TIMEOUT_MS,
    private readonly defaultShell?: string,
  ) {
    this.cleanupTimer = setInterval(() => this.cleanupIdle(), 60_000);
    this.cleanupTimer.unref();
  }

  run(params: RunParams): { sessionId: string; pid: number; cols: number; rows: number } {
    if (!params.command?.trim()) throw new AgenticTuiError('INVALID_COMMAND', 'Command is required');
    const size = clampSize(params.cols, params.rows);
    const id = params.sessionId?.trim() || randomUUID();
    const cwd = params.cwd || process.cwd();
    const spawn = spawnSpec(params.command, params.args ?? [], this.defaultShell);

    let ptyProcess: pty.IPty;
    try {
      ptyProcess = pty.spawn(spawn.command, spawn.args, {
        name: 'xterm-color',
        cols: size.cols,
        rows: size.rows,
        cwd,
        env: { ...process.env, ...(params.env ?? {}) },
      });
    } catch (error) {
      throw new AgenticTuiError('SPAWN_FAILED', `Failed to run ${params.command}: ${error instanceof Error ? error.message : String(error)}`);
    }

    const terminal = new Terminal({ cols: size.cols, rows: size.rows, scrollback: 1000, allowProposedApi: true });
    const now = Date.now();
    const session: Session = {
      id,
      command: params.command,
      args: params.args ?? [],
      cwd,
      ptyProcess,
      terminal,
      outputBuffer: '',
      totalBytesReceived: 0,
      lastWritePromise: Promise.resolve(),
      lastDataTime: now,
      lastActivityTime: now,
      createdAt: new Date(now).toISOString(),
    };

    ptyProcess.onData((data) => {
      session.lastDataTime = Date.now();
      session.lastActivityTime = session.lastDataTime;
      session.totalBytesReceived += data.length;
      session.outputBuffer = trimTail(session.outputBuffer + data, STREAM_TAIL_BYTES);
      session.lastWritePromise = awaitWrite(session.terminal, data);
    });

    ptyProcess.onExit(({ exitCode, signal }) => {
      session.exited = { exitCode, signal, exitedAt: Date.now() };
    });

    this.sessions.set(id, session);
    this.activeSessionId = id;
    appendSessionMetadata(session);
    return { sessionId: id, pid: ptyProcess.pid, cols: size.cols, rows: size.rows };
  }

  async output(params: {
    sessionId?: string;
    mode?: OutputMode;
    waitForIdle?: number;
    trimWhitespace?: boolean;
    includeEmpty?: boolean;
  }): Promise<{ output: string; metadata: Record<string, unknown> }> {
    const session = this.resolve(params.sessionId, true);
    await this.waitForIdle(session, params.waitForIdle);
    const mode = params.mode ?? this.detectMode(session);
    const metadata: Record<string, unknown> = {
      mode,
      sessionId: session.id,
      totalBytesReceived: session.totalBytesReceived,
    };

    if (mode === 'streaming') {
      const output = session.outputBuffer;
      session.outputBuffer = '';
      return { output, metadata };
    }

    if (mode === 'snapshot') {
      return { output: trimTail(session.outputBuffer, SNAPSHOT_TAIL_BYTES), metadata: { ...metadata, isSnapshot: true } };
    }

    await session.lastWritePromise;
    const output = readScreen(session.terminal, {
      trimWhitespace: params.trimWhitespace ?? true,
      includeEmpty: params.includeEmpty ?? false,
    });
    return {
      output,
      metadata: {
        ...metadata,
        rows: session.terminal.rows,
        cols: session.terminal.cols,
        cursor: cursorInfo(session.terminal),
      },
    };
  }

  write(sessionId: string | undefined, data: string): { success: true } {
    const session = this.resolve(sessionId);
    session.lastActivityTime = Date.now();
    session.ptyProcess.write(data);
    return { success: true };
  }

  async resize(sessionId: string | undefined, cols: number, rows: number): Promise<{ sessionId: string; cols: number; rows: number }> {
    const session = this.resolve(sessionId);
    const size = clampSize(cols, rows);
    session.ptyProcess.resize(size.cols, size.rows);
    session.terminal.resize(size.cols, size.rows);
    session.lastActivityTime = Date.now();
    await session.lastWritePromise;
    return { sessionId: session.id, cols: size.cols, rows: size.rows };
  }

  async region(params: {
    sessionId?: string;
    row: number;
    col: number;
    rows: number;
    cols: number;
    trimWhitespace?: boolean;
    waitForIdle?: number;
  }): Promise<{ output: string; region: { row: number; col: number; rows: number; cols: number } }> {
    const session = this.resolve(params.sessionId, true);
    await this.waitForIdle(session, params.waitForIdle);
    await session.lastWritePromise;
    const output = readRegion(session.terminal, params.row, params.col, params.rows, params.cols, params.trimWhitespace ?? false);
    return { output, region: { row: params.row, col: params.col, rows: params.rows, cols: params.cols } };
  }

  async cursor(sessionId?: string, waitForIdle?: number) {
    const session = this.resolve(sessionId, true);
    await this.waitForIdle(session, waitForIdle);
    await session.lastWritePromise;
    return { sessionId: session.id, cursor: cursorInfo(session.terminal) };
  }

  async search(params: { sessionId?: string; pattern: string; regex?: boolean; waitForIdle?: number }) {
    const session = this.resolve(params.sessionId, true);
    await this.waitForIdle(session, params.waitForIdle);
    await session.lastWritePromise;
    const results = searchScreen(session.terminal, params.pattern, params.regex ?? false);
    return { sessionId: session.id, results, count: results.length };
  }

  async wait(params: { sessionId?: string; text?: string; gone?: boolean; stable?: boolean; timeoutMs: number }): Promise<{ found: boolean; elapsedMs: number }> {
    const session = this.resolve(params.sessionId, true);
    const started = Date.now();
    let lastScreen = '';
    let stableSince = 0;

    while (Date.now() - started <= params.timeoutMs) {
      await session.lastWritePromise;
      const screen = readScreen(session.terminal, { trimWhitespace: true, includeEmpty: false });

      if (params.stable) {
        if (screen === lastScreen) {
          if (!stableSince) stableSince = Date.now();
          if (Date.now() - stableSince >= 500) return { found: true, elapsedMs: Date.now() - started };
        } else {
          lastScreen = screen;
          stableSince = 0;
        }
      } else if (typeof params.text === 'string') {
        const includes = screen.includes(params.text) || session.outputBuffer.includes(params.text);
        if (params.gone ? !includes : includes) return { found: true, elapsedMs: Date.now() - started };
      } else {
        throw new AgenticTuiError('INVALID_WAIT', 'Wait requires text or --stable');
      }

      await delay(100);
    }

    return { found: false, elapsedMs: Date.now() - started };
  }

  kill(sessionId?: string): { sessionId: string; success: boolean } {
    const session = this.resolve(sessionId);
    this.dispose(session.id);
    if (this.activeSessionId === session.id) this.activeSessionId = this.sessions.keys().next().value;
    return { sessionId: session.id, success: true };
  }

  sessionsList(): { activeSessionId?: string; sessions: SessionSummary[] } {
    const now = Date.now();
    return {
      activeSessionId: this.activeSessionId,
      sessions: [...this.sessions.values()].map((session) => ({
        id: session.id,
        command: session.command,
        args: session.args,
        cwd: session.cwd,
        pid: session.ptyProcess.pid,
        cols: session.terminal.cols,
        rows: session.terminal.rows,
        running: !session.exited,
        createdAt: session.createdAt,
        idleSeconds: Math.floor((now - session.lastActivityTime) / 1000),
        isAlternateBuffer: session.terminal.buffer.active === session.terminal.buffer.alternate,
      })),
    };
  }

  show(sessionId?: string): SessionSummary {
    const id = sessionId ?? this.activeSessionId;
    if (!id) throw new AgenticTuiError('NO_SESSION', 'No active session');
    const found = this.sessionsList().sessions.find((session) => session.id === id);
    if (!found) throw new AgenticTuiError('NO_SESSION', `Unknown session: ${id}`);
    return found;
  }

  switch(sessionId: string): { activeSessionId: string } {
    if (!this.sessions.has(sessionId)) throw new AgenticTuiError('NO_SESSION', `Unknown session: ${sessionId}`);
    this.activeSessionId = sessionId;
    return { activeSessionId: sessionId };
  }

  cleanup(all = false): { cleaned: number } {
    const ids = [...this.sessions.values()].filter((session) => all || session.exited).map((session) => session.id);
    for (const id of ids) this.dispose(id);
    if (this.activeSessionId && !this.sessions.has(this.activeSessionId)) this.activeSessionId = this.sessions.keys().next().value;
    return { cleaned: ids.length };
  }

  close(): void {
    clearInterval(this.cleanupTimer);
    for (const id of [...this.sessions.keys()]) this.dispose(id);
  }

  private resolve(sessionId?: string, allowExited = false): Session {
    const id = sessionId ?? this.activeSessionId;
    if (!id) throw new AgenticTuiError('NO_SESSION', 'No active session');
    const session = this.sessions.get(id);
    if (!session) throw new AgenticTuiError('NO_SESSION', `Unknown session: ${id}`);
    if (session.exited && !allowExited) {
      throw new AgenticTuiError('SESSION_EXITED', `Session exited with code ${session.exited.exitCode}`);
    }
    return session;
  }

  private async waitForIdle(session: Session, waitForIdle?: number): Promise<void> {
    if (!waitForIdle || waitForIdle <= 0) {
      await session.lastWritePromise;
      return;
    }

    const started = Date.now();
    while (Date.now() - session.lastDataTime < waitForIdle && Date.now() - started < 5000) {
      await delay(50);
    }
    await session.lastWritePromise;
  }

  private detectMode(session: Session): OutputMode {
    if (session.terminal.buffer.active === session.terminal.buffer.alternate) return 'screen';
    const recent = session.outputBuffer.slice(-4096);
    if (recent.includes('\x1b[2J') || recent.includes('\x1b[3J') || recent.includes('\x1bc')) return 'snapshot';
    return 'streaming';
  }

  private cleanupIdle(): void {
    const now = Date.now();
    for (const session of this.sessions.values()) {
      if (now - session.lastActivityTime > this.idleTimeoutMs) this.dispose(session.id);
    }
  }

  private dispose(id: string): void {
    const session = this.sessions.get(id);
    if (!session) return;
    this.sessions.delete(id);
    try {
      session.ptyProcess.kill();
    } catch {
      // ignored during cleanup
    }
    try {
      session.terminal.dispose();
    } catch {
      // ignored during cleanup
    }
  }
}

function spawnSpec(command: string, args: string[], defaultShell?: string): { command: string; args: string[] } {
  const shell = defaultShell || process.env.AGENTIC_TUI_SHELL || platformDefaultShell();
  if (process.platform === 'win32') {
    if (isWindowsShell(command)) return { command, args };
    const commandLine = [command, ...args].map(quoteWindowsArg).join(' ');
    const lower = path.basename(shell).toLowerCase();
    if (lower === 'cmd.exe' || lower === 'cmd') return { command: shell, args: ['/d', '/s', '/c', commandLine] };
    return { command: shell, args: ['-NoLogo', '-NoProfile', '-Command', commandLine] };
  }
  if (args.length > 0 || !/\s/.test(command)) return { command, args };
  return { command: shell, args: ['-lc', command] };
}

function platformDefaultShell(): string {
  if (process.platform === 'win32') return 'powershell.exe';
  return process.env.SHELL || 'bash';
}

function isWindowsShell(command: string): boolean {
  const name = path.basename(command).toLowerCase();
  return name === 'powershell.exe' || name === 'powershell' || name === 'pwsh.exe' || name === 'pwsh' || name === 'cmd.exe' || name === 'cmd';
}

function quoteWindowsArg(value: string): string {
  if (/^[A-Za-z0-9_./\\:=@-]+$/.test(value)) return value;
  return `'${value.replace(/'/g, "''")}'`;
}

function trimTail(value: string, max: number): string {
  return value.length > max ? value.slice(-max) : value;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function appendSessionMetadata(session: Session): void {
  try {
    fs.mkdirSync(path.dirname(sessionsPath()), { recursive: true });
    fs.appendFileSync(
      sessionsPath(),
      JSON.stringify({
        id: session.id,
        command: session.command,
        args: session.args,
        cwd: session.cwd,
        pid: session.ptyProcess.pid,
        createdAt: session.createdAt,
      }) + '\n',
    );
  } catch {
    // Session metadata is useful but should not block running commands.
  }
}
