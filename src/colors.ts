import pc from 'picocolors';
import { isHuman } from './output';

function plain(s: string): string {
  return s;
}

export function green(s: string): string {
  return isHuman() ? pc.green(s) : plain(s);
}

export function red(s: string): string {
  return isHuman() ? pc.red(s) : plain(s);
}

export function yellow(s: string): string {
  return isHuman() ? pc.yellow(s) : plain(s);
}

export function cyan(s: string): string {
  return isHuman() ? pc.cyan(s) : plain(s);
}

export function dim(s: string): string {
  return isHuman() ? pc.dim(s) : plain(s);
}

export function bold(s: string): string {
  return isHuman() ? pc.bold(s) : plain(s);
}

export const SUCCESS_MARK = '✓';
export const FAILURE_MARK = '✗';

export function ok(text: string): string {
  return `${green(SUCCESS_MARK)} ${text}`;
}

export function fail(text: string): string {
  return `${red(FAILURE_MARK)} ${text}`;
}
