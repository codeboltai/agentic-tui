import http from 'node:http';
import { readDaemonState } from './daemon-state.js';
import { AgenticTuiError } from './errors.js';
import type { RpcRequest, RpcResponse } from './types.js';

export async function rpc<T = unknown>(method: string, params: Record<string, unknown> = {}): Promise<T> {
  const state = readDaemonState();
  if (!state) throw new AgenticTuiError('DAEMON_NOT_RUNNING', 'Daemon is not running. Start it with `agentic-tui daemon start`.');
  const response = await request('/rpc', 'POST', state.port, state.token, { method, params });
  if (!response.ok) throw new AgenticTuiError(response.error.code, response.error.message);
  return response.result as T;
}

export async function daemonStatus(): Promise<RpcResponse> {
  const state = readDaemonState();
  if (!state) return { ok: false, error: { code: 'DAEMON_NOT_RUNNING', message: 'Daemon is not running' } };
  return request('/status', 'GET', state.port, state.token);
}

export async function daemonShutdown(): Promise<RpcResponse> {
  const state = readDaemonState();
  if (!state) return { ok: false, error: { code: 'DAEMON_NOT_RUNNING', message: 'Daemon is not running' } };
  return request('/shutdown', 'POST', state.port, state.token, {});
}

async function request(path: string, method: string, port: number, token: string, body?: RpcRequest | object): Promise<RpcResponse> {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : undefined;
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port,
        path,
        method,
        timeout: 2000,
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': 'application/json',
          ...(payload ? { 'content-length': Buffer.byteLength(payload) } : {}),
        },
      },
      (res) => {
        let data = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => {
          data += chunk;
        });
        res.on('end', () => {
          try {
            resolve(JSON.parse(data) as RpcResponse);
          } catch (error) {
            reject(error);
          }
        });
      },
    );
    req.on('error', () => reject(new AgenticTuiError('DAEMON_NOT_RUNNING', 'Daemon is not reachable')));
    req.on('timeout', () => {
      req.destroy();
      reject(new AgenticTuiError('DAEMON_TIMEOUT', 'Daemon request timed out'));
    });
    if (payload) req.write(payload);
    req.end();
  });
}
