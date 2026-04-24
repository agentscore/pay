import { CliError, exitCodeForError } from './errors';

export type OutputMode = 'human' | 'json' | 'plain';

let currentMode: OutputMode = 'human';

export interface ModeFlags {
  json?: boolean;
  plain?: boolean;
}

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

export function writeJson(data: unknown): void {
  process.stdout.write(JSON.stringify(data) + '\n');
}

export function writeLine(text: string): void {
  if (currentMode === 'json') return;
  process.stdout.write(text + '\n');
}

export function writeText(text: string): void {
  process.stdout.write(text);
}

export function writeHumanNote(text: string): void {
  if (currentMode === 'json') return;
  process.stderr.write(text + '\n');
}

export function emitProgress(event: string, data?: Record<string, unknown>): void {
  if (currentMode === 'json') {
    process.stderr.write(JSON.stringify({ event, ...data }) + '\n');
    return;
  }
  if (data) {
    process.stderr.write(`${event} ${JSON.stringify(data)}\n`);
  } else {
    process.stderr.write(event + '\n');
  }
}

export function writeError(err: CliError | Error): number {
  const structured = toStructured(err);
  if (currentMode === 'human') {
    const { error } = structured;
    process.stderr.write(`agentscore-pay: ${error.message}\n`);
    if (structured.next_steps && typeof structured.next_steps === 'object') {
      const ns = structured.next_steps as NextStepsSerialized;
      if (ns.suggestion) process.stderr.write(`  → ${ns.suggestion}\n`);
    }
    process.stderr.write(`\nMachine-readable:\n${JSON.stringify(structured)}\n`);
  } else {
    process.stderr.write(JSON.stringify(structured) + '\n');
  }
  return err instanceof CliError ? exitCodeForError(err.code) : 1;
}

interface StructuredError {
  error: { code: string; message: string };
  next_steps?: NextStepsSerialized;
  [key: string]: unknown;
}

interface NextStepsSerialized {
  action: string;
  suggestion?: string;
}

function toStructured(err: CliError | Error): StructuredError {
  if (err instanceof CliError) {
    const base: StructuredError = {
      error: { code: err.code, message: err.message },
      ...err.extra,
    };
    if (err.nextSteps) base.next_steps = err.nextSteps;
    return base;
  }
  return { error: { code: 'unknown', message: err.message ?? String(err) } };
}
