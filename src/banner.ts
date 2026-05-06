const BANNER_ART = [
  ' ▄▀█ █▀▀ █▀▀ █▄ █ ▀█▀ █▀▀ █▀▀ █▀█ █▀█ █▀▀   █▀█ ▄▀█ █▄█',
  ' █▀█ █▄█ ██▄ █ ▀█  █  ▄▄█ █▄▄ █▄█ █▀▄ ██▄   █▀▀ █▀█  █',
].join('\n');

const TAGLINE = 'Universal agent-payment CLI';

const QUICK_START = [
  'Quick start:',
  '  agentscore-pay init                Create encrypted wallet across base, solana, tempo',
  '  agentscore-pay balance             Check USDC across chains',
  '  agentscore-pay pay POST <URL>      Pay any 402 / MPP merchant',
  '  agentscore-pay fund options        List funding methods for a wallet',
  '  agentscore-pay agent-guide         Full guide for LLM agents',
  '',
  'Run `agentscore-pay --help` for the full command list.',
].join('\n');

const MIN_BANNER_COLS = 60;
const PLAIN_BRAND = 'AgentScore Pay';
const ART_FG_ANSI = '\x1b[38;5;39m';
const ANSI_RESET = '\x1b[0m';

function shouldUseColor(): boolean {
  if (process.env.NO_COLOR) return false;
  return true;
}

export function renderBanner({
  cols,
  color,
}: {
  cols: number;
  color: boolean;
}): string {
  if (cols < MIN_BANNER_COLS) {
    return `${PLAIN_BRAND}\n${TAGLINE}\n\n${QUICK_START}\n`;
  }
  const art = color
    ? BANNER_ART.split('\n').map((line) => `${ART_FG_ANSI}${line}${ANSI_RESET}`).join('\n')
    : BANNER_ART;
  return `${art}\n\n${TAGLINE}\n\n${QUICK_START}\n`;
}

export function printBanner(): void {
  if (!process.stderr.isTTY) return;
  const cols = process.stderr.columns ?? 80;
  process.stderr.write(renderBanner({ cols, color: shouldUseColor() }));
}
