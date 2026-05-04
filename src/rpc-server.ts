import http from 'node:http';
import { createToken, removeDaemonState, writeDaemonState } from './daemon-state.js';
import { errorCode, errorMessage } from './errors.js';
import { SessionManager } from './session-manager.js';
import type { RpcRequest, RpcResponse } from './types.js';

export interface DaemonServer {
  port: number;
  token: string;
  close: () => Promise<void>;
}

export async function startRpcServer(options: { shell?: string } = {}, manager = new SessionManager(undefined, options.shell)): Promise<DaemonServer> {
  const token = createToken();
  let server: http.Server;

  server = http.createServer(async (request, response) => {
    response.setHeader('content-type', 'application/json');

    if (request.url === '/status' && request.method === 'GET') {
      response.end(JSON.stringify({ ok: true, result: { pid: process.pid, sessions: manager.sessionsList() } }));
      return;
    }

    if (request.headers.authorization !== `Bearer ${token}`) {
      response.statusCode = 401;
      response.end(JSON.stringify({ ok: false, error: { code: 'UNAUTHORIZED', message: 'Invalid daemon token' } }));
      return;
    }

    if (request.url === '/shutdown' && request.method === 'POST') {
      response.end(JSON.stringify({ ok: true, result: { stopping: true } }));
      setTimeout(() => {
        manager.close();
        removeDaemonState();
        server.close(() => process.exit(0));
      }, 10).unref();
      return;
    }

    if (request.url !== '/rpc' || request.method !== 'POST') {
      response.statusCode = 404;
      response.end(JSON.stringify({ ok: false, error: { code: 'NOT_FOUND', message: 'Unknown endpoint' } }));
      return;
    }

    try {
      const body = await readBody(request);
      const rpc = JSON.parse(body) as RpcRequest;
      const result = await dispatch(manager, rpc);
      response.end(JSON.stringify({ ok: true, result } satisfies RpcResponse));
    } catch (error) {
      response.statusCode = 400;
      response.end(JSON.stringify({ ok: false, error: { code: errorCode(error), message: errorMessage(error) } } satisfies RpcResponse));
    }
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Failed to bind daemon server');
  writeDaemonState({ pid: process.pid, port: address.port, token, startedAt: new Date().toISOString() });

  return {
    port: address.port,
    token,
    close: () =>
      new Promise((resolve) => {
        manager.close();
        removeDaemonState();
        server.close(() => resolve());
      }),
  };
}

async function dispatch(manager: SessionManager, rpc: RpcRequest): Promise<unknown> {
  const params = rpc.params ?? {};
  switch (rpc.method) {
    case 'run':
      return manager.run({
        command: stringParam(params, 'command'),
        args: arrayParam(params, 'args'),
        cwd: optionalString(params, 'cwd'),
        env: objectParam(params, 'env'),
        cols: optionalNumber(params, 'cols'),
        rows: optionalNumber(params, 'rows'),
        sessionId: optionalString(params, 'sessionId'),
      });
    case 'output':
      return manager.output({
        sessionId: optionalString(params, 'sessionId'),
        mode: optionalString(params, 'mode') as never,
        waitForIdle: optionalNumber(params, 'waitForIdle'),
        trimWhitespace: optionalBool(params, 'trimWhitespace'),
        includeEmpty: optionalBool(params, 'includeEmpty'),
      });
    case 'write':
      return manager.write(optionalString(params, 'sessionId'), stringParam(params, 'data'));
    case 'resize':
      return manager.resize(optionalString(params, 'sessionId'), numberParam(params, 'cols'), numberParam(params, 'rows'));
    case 'region':
      return manager.region({
        sessionId: optionalString(params, 'sessionId'),
        row: numberParam(params, 'row'),
        col: numberParam(params, 'col'),
        rows: numberParam(params, 'rows'),
        cols: numberParam(params, 'cols'),
        trimWhitespace: optionalBool(params, 'trimWhitespace'),
        waitForIdle: optionalNumber(params, 'waitForIdle'),
      });
    case 'cursor':
      return manager.cursor(optionalString(params, 'sessionId'), optionalNumber(params, 'waitForIdle'));
    case 'search':
      return manager.search({
        sessionId: optionalString(params, 'sessionId'),
        pattern: stringParam(params, 'pattern'),
        regex: optionalBool(params, 'regex'),
        waitForIdle: optionalNumber(params, 'waitForIdle'),
      });
    case 'wait':
      return manager.wait({
        sessionId: optionalString(params, 'sessionId'),
        text: optionalString(params, 'text'),
        gone: optionalBool(params, 'gone'),
        stable: optionalBool(params, 'stable'),
        timeoutMs: numberParam(params, 'timeoutMs'),
      });
    case 'kill':
      return manager.kill(optionalString(params, 'sessionId'));
    case 'sessions.list':
      return manager.sessionsList();
    case 'sessions.show':
      return manager.show(optionalString(params, 'sessionId'));
    case 'sessions.switch':
      return manager.switch(stringParam(params, 'sessionId'));
    case 'sessions.cleanup':
      return manager.cleanup(optionalBool(params, 'all') ?? false);
    default:
      throw new Error(`Unknown RPC method: ${rpc.method}`);
  }
}

function readBody(request: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = '';
    request.setEncoding('utf8');
    request.on('data', (chunk) => {
      body += chunk;
      if (body.length > 1024 * 1024) reject(new Error('Request too large'));
    });
    request.on('end', () => resolve(body));
    request.on('error', reject);
  });
}

function stringParam(params: Record<string, unknown>, key: string): string {
  const value = params[key];
  if (typeof value !== 'string') throw new Error(`Missing string param: ${key}`);
  return value;
}

function optionalString(params: Record<string, unknown>, key: string): string | undefined {
  const value = params[key];
  return typeof value === 'string' ? value : undefined;
}

function numberParam(params: Record<string, unknown>, key: string): number {
  const value = params[key];
  if (typeof value !== 'number') throw new Error(`Missing number param: ${key}`);
  return value;
}

function optionalNumber(params: Record<string, unknown>, key: string): number | undefined {
  const value = params[key];
  return typeof value === 'number' ? value : undefined;
}

function optionalBool(params: Record<string, unknown>, key: string): boolean | undefined {
  const value = params[key];
  return typeof value === 'boolean' ? value : undefined;
}

function arrayParam(params: Record<string, unknown>, key: string): string[] {
  const value = params[key];
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

function objectParam(params: Record<string, unknown>, key: string): Record<string, string> | undefined {
  const value = params[key];
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const entries = Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === 'string');
  return Object.fromEntries(entries);
}
