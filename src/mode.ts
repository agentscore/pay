export type OutputMode = 'human' | 'json' | 'plain';

export interface ModeFlags {
  json?: boolean;
  plain?: boolean;
}

let currentMode: OutputMode = 'human';

export function resolveMode(flags: ModeFlags = {}): OutputMode {
  if (flags.json) return 'json';
  if (flags.plain) return 'plain';
  return process.stdout.isTTY ? 'human' : 'plain';
}

export function setMode(mode: OutputMode): void {
  currentMode = mode;
}

export function getMode(): OutputMode {
  return currentMode;
}

export function isHuman(): boolean {
  return currentMode === 'human';
}

export function isJson(): boolean {
  return currentMode === 'json';
}
