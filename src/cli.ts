#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';
import { daemonShutdown, daemonStatus, rpc } from './rpc-client.js';
import { startRpcServer } from './rpc-server.js';
import { readDaemonState, removeDaemonState } from './daemon-state.js';
import { errorCode, errorMessage } from './errors.js';
import { directionToKey, keysToSequence, keyToSequence } from './keys.js';
import { DEFAULT_COLS, DEFAULT_ROWS, DEFAULT_WAIT_TIMEOUT_MS, daemonStatePath } from './config.js';
import { renderTextGridToPng } from './png-renderer.js';

interface CliContext {
  json: boolean;
  sessionId?: string;
}

interface Parsed {
  ctx: CliContext;
  args: string[];
}

type SaveFormat = 'text' | 'json' | 'png';

main().catch((error) => {
  const json = process.argv.includes('--json');
  if (json) {
    console.error(JSON.stringify({ ok: false, error: { code: errorCode(error), message: errorMessage(error) } }, null, 2));
  } else {
    console.error(`Error: ${errorMessage(error)}`);
  }
  process.exitCode = 1;
});

async function main(): Promise<void> {
  const parsed = parseGlobal(process.argv.slice(2));
  const [command, ...args] = parsed.args;

  switch (command) {
    case undefined:
    case 'help':
    case '--help':
    case '-h':
      printHelp();
      return;
    case 'daemon':
      await handleDaemon(parsed.ctx, args);
      return;
    case 'run':
      await ensureDaemon(parsed.ctx);
      await handleRun(parsed.ctx, args);
      return;
    case 'output':
      await handleOutput(parsed.ctx, args);
      return;
    case 'screen':
    case 'screenshot':
      await handleScreen(parsed.ctx, args);
      return;
    case 'press':
      await handlePress(parsed.ctx, args);
      return;
    case 'type':
      await handleType(parsed.ctx, args);
      return;
    case 'scroll':
      await handleScroll(parsed.ctx, args);
      return;
    case 'resize':
      await handleResize(parsed.ctx, args);
      return;
    case 'wait':
      await handleWait(parsed.ctx, args);
      return;
    case 'region':
      await handleRegion(parsed.ctx, args);
      return;
    case 'cursor':
      await printResult(parsed.ctx, await rpc('cursor', { sessionId: parsed.ctx.sessionId }), (value) => JSON.stringify(value, null, 2));
      return;
    case 'search':
      await handleSearch(parsed.ctx, args);
      return;
    case 'sessions':
      await handleSessions(parsed.ctx, args);
      return;
    case 'kill':
      await printResult(parsed.ctx, await rpc('kill', { sessionId: parsed.ctx.sessionId }), (value) => `Killed session ${(value as { sessionId: string }).sessionId}`);
      return;
    case 'version':
      printResult(parsed.ctx, { version: '0.1.0' }, () => 'agentic-tui 0.1.0');
      return;
    default:
      throw new Error(`Unknown command: ${command}`);
  }
}

async function handleDaemon(ctx: CliContext, args: string[]): Promise<void> {
  const [subcommand = 'status'] = args;
  switch (subcommand) {
    case 'run': {
      const parsed = parseOptions(args.slice(1), { string: ['shell'] });
      const server = await startRpcServer({ shell: parsed.options.shell as string | undefined });
      console.error(`agentic-tui daemon running on 127.0.0.1:${server.port}`);
      process.on('SIGINT', async () => {
        await server.close();
        process.exit(0);
      });
      process.on('SIGTERM', async () => {
        await server.close();
        process.exit(0);
      });
      await new Promise(() => undefined);
      return;
    }
    case 'start':
      await startDaemon(ctx, parseOptions(args.slice(1), { string: ['shell'] }).options.shell as string | undefined);
      return;
    case 'status': {
      const status = await daemonStatus();
      if (!status.ok) {
        printRpcEnvelope(ctx, status, `Daemon not running\nState file: ${daemonStatePath()}`);
        process.exitCode = 3;
      } else {
        printResult(ctx, status.result, (value) => {
          const result = value as { pid: number; sessions: { sessions: unknown[] } };
          return `Daemon running (pid ${result.pid})\nSessions: ${result.sessions.sessions.length}`;
        });
      }
      return;
    }
    case 'stop': {
      const result = await daemonShutdown().catch((error) => {
        removeDaemonState();
        return { ok: false as const, error: { code: errorCode(error), message: errorMessage(error) } };
      });
      if (!result.ok && result.error.code === 'DAEMON_NOT_RUNNING') removeDaemonState();
      printRpcEnvelope(ctx, result, result.ok ? 'Daemon stopping' : result.error.message);
      if (!result.ok) process.exitCode = 3;
      return;
    }
    case 'restart':
      await daemonShutdown().catch(() => undefined);
      await delay(300);
      removeDaemonState();
      await startDaemon(ctx, parseOptions(args.slice(1), { string: ['shell'] }).options.shell as string | undefined);
      return;
    default:
      throw new Error(`Unknown daemon command: ${subcommand}`);
  }
}

async function handleRun(ctx: CliContext, args: string[]): Promise<void> {
  const parsed = parseOptions(args, {
    string: ['cwd', 'cols', 'rows', 'session'],
    repeat: ['env'],
  });
  const [command, ...commandArgs] = parsed.positionals;
  if (!command) throw new Error('run requires a command');
  const env = parseEnv(parsed.options.env as string[] | undefined);
  const result = await rpc('run', {
    command,
    args: commandArgs,
    cwd: parsed.options.cwd,
    cols: numberOption(parsed.options.cols, DEFAULT_COLS),
    rows: numberOption(parsed.options.rows, DEFAULT_ROWS),
    env,
    sessionId: parsed.options.session ?? ctx.sessionId,
  });
  printResult(ctx, result, (value) => {
    const run = value as { sessionId: string; pid: number; cols: number; rows: number };
    return `Started session ${run.sessionId}\nPID: ${run.pid}\nSize: ${run.cols}x${run.rows}`;
  });
}

async function handleOutput(ctx: CliContext, args: string[]): Promise<void> {
  const parsed = parseOptions(args, { string: ['mode', 'wait-for-idle', 'out', 'format'], bool: ['trim', 'include-empty'] });
  const result = await rpc('output', {
    sessionId: ctx.sessionId,
    mode: parsed.options.mode,
    waitForIdle: numberOption(parsed.options['wait-for-idle']),
    trimWhitespace: parsed.options.trim,
    includeEmpty: parsed.options['include-empty'],
  });
  await emitOutputResult(ctx, result, {
    out: optionalStringOption(parsed.options.out),
    format: parseSaveFormat(parsed.options.format),
  });
}

async function handleScreen(ctx: CliContext, args: string[]): Promise<void> {
  const parsed = parseOptions(args, { string: ['out', 'format', 'wait-for-idle'], bool: ['trim', 'include-empty'] });
  const result = await rpc('output', {
    sessionId: ctx.sessionId,
    mode: 'screen',
    waitForIdle: numberOption(parsed.options['wait-for-idle']),
    trimWhitespace: parsed.options.trim,
    includeEmpty: parsed.options['include-empty'],
  });
  await emitOutputResult(ctx, result, {
    out: optionalStringOption(parsed.options.out),
    format: parseSaveFormat(parsed.options.format),
  });
}

async function handlePress(ctx: CliContext, args: string[]): Promise<void> {
  if (args.length === 0) throw new Error('press requires at least one key');
  const data = keysToSequence(args);
  const result = await rpc('write', { sessionId: ctx.sessionId, data });
  printResult(ctx, result, () => `Pressed ${args.join(' ')}`);
}

async function handleType(ctx: CliContext, args: string[]): Promise<void> {
  if (args.length === 0) throw new Error('type requires text');
  const text = args.join(' ');
  const result = await rpc('write', { sessionId: ctx.sessionId, data: text });
  printResult(ctx, result, () => 'Text sent');
}

async function handleScroll(ctx: CliContext, args: string[]): Promise<void> {
  const [direction, amountText = '1'] = args;
  if (!direction) throw new Error('scroll requires a direction');
  const amount = Math.max(1, Number.parseInt(amountText, 10) || 1);
  const key = directionToKey(direction);
  const data = keyToSequence(key).repeat(amount);
  const result = await rpc('write', { sessionId: ctx.sessionId, data });
  printResult(ctx, result, () => `Scrolled ${direction} ${amount}`);
}

async function handleResize(ctx: CliContext, args: string[]): Promise<void> {
  const parsed = parseOptions(args, { string: ['cols', 'rows'] });
  const cols = numberOption(parsed.options.cols);
  const rows = numberOption(parsed.options.rows);
  if (!cols || !rows) throw new Error('resize requires --cols and --rows');
  const result = await rpc('resize', { sessionId: ctx.sessionId, cols, rows });
  printResult(ctx, result, (value) => {
    const resize = value as { sessionId: string; cols: number; rows: number };
    return `Resized ${resize.sessionId} to ${resize.cols}x${resize.rows}`;
  });
}

async function handleWait(ctx: CliContext, args: string[]): Promise<void> {
  const parsed = parseOptions(args, { string: ['timeout'], bool: ['gone', 'stable'] });
  const text = parsed.positionals.join(' ') || undefined;
  const result = (await rpc('wait', {
    sessionId: ctx.sessionId,
    text,
    gone: parsed.options.gone,
    stable: parsed.options.stable,
    timeoutMs: numberOption(parsed.options.timeout, DEFAULT_WAIT_TIMEOUT_MS),
  })) as { found: boolean; elapsedMs: number };
  printResult(ctx, result, (value) => {
    const wait = value as { found: boolean; elapsedMs: number };
    return `${wait.found ? 'Matched' : 'Timed out'} after ${wait.elapsedMs}ms`;
  });
  if (!result.found) process.exitCode = 75;
}

async function handleRegion(ctx: CliContext, args: string[]): Promise<void> {
  const parsed = parseOptions(args, { string: ['row', 'col', 'rows', 'cols', 'wait-for-idle'], bool: ['trim'] });
  const result = await rpc('region', {
    sessionId: ctx.sessionId,
    row: requiredNumber(parsed.options.row, 'row'),
    col: requiredNumber(parsed.options.col, 'col'),
    rows: requiredNumber(parsed.options.rows, 'rows'),
    cols: requiredNumber(parsed.options.cols, 'cols'),
    trimWhitespace: parsed.options.trim,
    waitForIdle: numberOption(parsed.options['wait-for-idle']),
  });
  printResult(ctx, result, (value) => (value as { output: string }).output);
}

async function handleSearch(ctx: CliContext, args: string[]): Promise<void> {
  const parsed = parseOptions(args, { bool: ['regex'], string: ['wait-for-idle'] });
  const pattern = parsed.positionals.join(' ');
  if (!pattern) throw new Error('search requires a pattern');
  const result = await rpc('search', {
    sessionId: ctx.sessionId,
    pattern,
    regex: parsed.options.regex,
    waitForIdle: numberOption(parsed.options['wait-for-idle']),
  });
  printResult(ctx, result, (value) => {
    const search = value as { count: number; results: Array<{ row: number; col: number; text: string }> };
    if (search.count === 0) return 'No matches';
    return search.results.map((match) => `${match.row}:${match.col} ${match.text}`).join('\n');
  });
}

async function handleSessions(ctx: CliContext, args: string[]): Promise<void> {
  const [subcommand = 'list', ...rest] = args;
  if (subcommand === 'list') {
    const result = await rpc('sessions.list');
    printResult(ctx, result, formatSessions);
    return;
  }
  if (subcommand === 'show') {
    const result = await rpc('sessions.show', { sessionId: rest[0] ?? ctx.sessionId });
    printResult(ctx, result, (value) => JSON.stringify(value, null, 2));
    return;
  }
  if (subcommand === 'switch') {
    if (!rest[0]) throw new Error('sessions switch requires a session id');
    const result = await rpc('sessions.switch', { sessionId: rest[0] });
    printResult(ctx, result, (value) => `Active session: ${(value as { activeSessionId: string }).activeSessionId}`);
    return;
  }
  if (subcommand === 'cleanup') {
    const parsed = parseOptions(rest, { bool: ['all'] });
    const result = await rpc('sessions.cleanup', { all: parsed.options.all });
    printResult(ctx, result, (value) => `Cleaned ${(value as { cleaned: number }).cleaned} sessions`);
    return;
  }
  throw new Error(`Unknown sessions command: ${subcommand}`);
}

async function ensureDaemon(ctx: CliContext): Promise<void> {
  const status = await daemonStatus().catch(() => undefined);
  if (status?.ok) return;
  await startDaemon({ ...ctx, json: false }, undefined, true);
}

async function startDaemon(ctx: CliContext, shell?: string, quiet = false): Promise<void> {
  const existing = await daemonStatus().catch(() => undefined);
  if (existing?.ok) {
    if (!quiet) printResult(ctx, existing.result, () => 'Daemon already running');
    return;
  }

  removeDaemonState();
  const cliPath = fileURLToPath(import.meta.url);
  const daemonArgs = [cliPath, 'daemon', 'run'];
  if (shell) daemonArgs.push('--shell', shell);
  const child = spawn(process.execPath, daemonArgs, {
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
  });
  child.unref();

  for (let i = 0; i < 30; i += 1) {
    await delay(100);
    const state = readDaemonState();
    if (!state) continue;
    const status = await daemonStatus().catch(() => undefined);
    if (status?.ok) {
      if (!quiet) printResult(ctx, { pid: state.pid, port: state.port }, () => `Daemon started (pid ${state.pid})`);
      return;
    }
  }

  throw new Error('Daemon did not start within 3 seconds');
}

function parseGlobal(args: string[]): Parsed {
  const ctx: CliContext = { json: false };
  const rest: string[] = [];
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === '--json') ctx.json = true;
    else if (arg === '-s' || arg === '--session') ctx.sessionId = args[++i];
    else rest.push(arg);
  }
  return { ctx, args: rest };
}

function parseOptions(args: string[], spec: { string?: string[]; bool?: string[]; repeat?: string[] }) {
  const stringOptions = new Set(spec.string ?? []);
  const boolOptions = new Set(spec.bool ?? []);
  const repeatOptions = new Set(spec.repeat ?? []);
  const options: Record<string, string | string[] | boolean | undefined> = {};
  const positionals: string[] = [];

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === '--') {
      positionals.push(...args.slice(i + 1));
      break;
    }
    if (!arg.startsWith('--')) {
      positionals.push(arg);
      continue;
    }

    const [rawName, inlineValue] = arg.slice(2).split(/=(.*)/s, 2);
    if (boolOptions.has(rawName)) {
      options[rawName] = true;
    } else if (stringOptions.has(rawName) || repeatOptions.has(rawName)) {
      const value = inlineValue ?? args[++i];
      if (value === undefined) throw new Error(`Missing value for --${rawName}`);
      if (repeatOptions.has(rawName)) {
        const current = options[rawName];
        options[rawName] = [...(Array.isArray(current) ? current : []), value];
      } else {
        options[rawName] = value;
      }
    } else {
      throw new Error(`Unknown option --${rawName}`);
    }
  }

  return { options, positionals };
}

async function emitOutputResult(ctx: CliContext, value: unknown, options: { out?: string; format?: SaveFormat }): Promise<void> {
  const format = options.format ?? (ctx.json ? 'json' : 'text');
  if (options.out) {
    await saveOutputFile(options.out, format, value);
    if (ctx.json) {
      console.log(JSON.stringify({ ok: true, result: { path: options.out, format } }, null, 2));
    } else {
      console.log(`Saved ${format} screenshot to ${options.out}`);
    }
    return;
  }

  if (format === 'json') {
    console.log(JSON.stringify({ ok: true, result: value }, null, 2));
  } else if (format === 'png') {
    throw new Error('--format png requires --out <path>');
  } else {
    console.log(formatOutput(value));
  }
}

async function saveOutputFile(filePath: string, format: SaveFormat, value: unknown): Promise<void> {
  await fs.promises.mkdir(path.dirname(path.resolve(filePath)), { recursive: true });
  if (format === 'json') {
    await fs.promises.writeFile(filePath, JSON.stringify({ ok: true, result: value }, null, 2), 'utf8');
    return;
  }
  const output = formatOutput(value);
  if (format === 'png') {
    await fs.promises.writeFile(filePath, renderTextGridToPng(output));
    return;
  }
  await fs.promises.writeFile(filePath, output, 'utf8');
}

function parseSaveFormat(value: unknown): SaveFormat | undefined {
  if (value === undefined) return undefined;
  if (value !== 'text' && value !== 'json' && value !== 'png') {
    throw new Error('--format must be one of: text, json, png');
  }
  return value;
}

function optionalStringOption(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function numberOption(value: unknown, fallback?: number): number | undefined {
  if (typeof value !== 'string') return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function requiredNumber(value: unknown, name: string): number {
  const parsed = numberOption(value);
  if (parsed === undefined) throw new Error(`--${name} is required`);
  return parsed;
}

function parseEnv(values: string[] | undefined): Record<string, string> | undefined {
  if (!values?.length) return undefined;
  const env: Record<string, string> = {};
  for (const value of values) {
    const index = value.indexOf('=');
    if (index <= 0) throw new Error(`Invalid --env value: ${value}`);
    env[value.slice(0, index)] = value.slice(index + 1);
  }
  return env;
}

function printResult(ctx: CliContext, value: unknown, textFormatter: (value: unknown) => string): void {
  if (ctx.json) {
    console.log(JSON.stringify({ ok: true, result: value }, null, 2));
  } else {
    console.log(textFormatter(value));
  }
}

function printRpcEnvelope(ctx: CliContext, value: { ok: boolean; result?: unknown; error?: { message: string } }, text: string): void {
  if (ctx.json) console.log(JSON.stringify(value, null, 2));
  else console.log(text);
}

function formatOutput(value: unknown): string {
  return (value as { output: string }).output;
}

function formatSessions(value: unknown): string {
  const result = value as { activeSessionId?: string; sessions: Array<{ id: string; command: string; pid: number; rows: number; cols: number; running: boolean }> };
  if (result.sessions.length === 0) return 'No sessions';
  return result.sessions
    .map((session) => `${session.id === result.activeSessionId ? '*' : ' '} ${session.id} pid=${session.pid} ${session.cols}x${session.rows} ${session.running ? 'running' : 'exited'} ${session.command}`)
    .join('\n');
}

function printHelp(): void {
  const invoked = path.basename(process.argv[1] ?? 'agentic-tui');
  const bin = invoked === 'cli.js' ? 'agentic-tui' : invoked;
  console.log(`agentic-tui

Usage:
  ${bin} daemon start|run [--shell SHELL]|status|stop|restart
  ${bin} run <command> [...args] [--cwd DIR] [--cols N] [--rows N] [--env KEY=VALUE]
  ${bin} output --mode streaming|snapshot|screen
  ${bin} screen [--out PATH] [--format text|json|png]
  ${bin} screenshot [--out PATH] [--format text|json|png]
  ${bin} press <key...>
  ${bin} type <text>
  ${bin} scroll up|down|left|right [amount]
  ${bin} resize --cols N --rows N
  ${bin} wait <text> [--gone] [--timeout MS]
  ${bin} wait --stable [--timeout MS]
  ${bin} region --row N --col N --rows N --cols N
  ${bin} cursor
  ${bin} search <text> [--regex]
  ${bin} sessions list|show|switch|cleanup
  ${bin} kill

Global:
  --json
  -s, --session <id>`);
}
