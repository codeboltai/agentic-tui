import fs from 'node:fs';
import { randomBytes } from 'node:crypto';
import { daemonStatePath, stateDir } from './config.js';

export interface DaemonState {
  pid: number;
  port: number;
  token: string;
  startedAt: string;
}

export function createToken(): string {
  return randomBytes(24).toString('hex');
}

export function readDaemonState(): DaemonState | undefined {
  try {
    const parsed = JSON.parse(fs.readFileSync(daemonStatePath(), 'utf8')) as DaemonState;
    if (!parsed.pid || !parsed.port || !parsed.token) return undefined;
    return parsed;
  } catch {
    return undefined;
  }
}

export function writeDaemonState(state: DaemonState): void {
  fs.mkdirSync(stateDir(), { recursive: true });
  fs.writeFileSync(daemonStatePath(), JSON.stringify(state, null, 2));
}

export function removeDaemonState(): void {
  try {
    fs.unlinkSync(daemonStatePath());
  } catch {
    // already removed
  }
}
