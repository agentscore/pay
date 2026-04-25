import { run } from './cli';
import { getMode, writeError } from './output';
import { getNoticeIfNewer, refreshCacheAwaited, refreshCacheInBackground } from './update-check';

declare const __VERSION__: string;

const VERSION = typeof __VERSION__ === 'string' ? __VERSION__ : '0.0.0-dev';

async function emitUpdateNoticeIfAvailable(): Promise<void> {
  if (getMode() !== 'human') return;
  const latest = await getNoticeIfNewer(VERSION);
  if (latest) {
    process.stderr.write(`\n  → A newer @agent-score/pay is available: ${latest} (you have ${VERSION}). Update with: npm i -g @agent-score/pay\n`);
  }
}

run(process.argv)
  .then(async () => {
    await emitUpdateNoticeIfAvailable();
    refreshCacheInBackground();
  })
  .catch(async (err: unknown) => {
    const e = err instanceof Error ? err : new Error(String(err));
    const code = writeError(e);
    await refreshCacheAwaited();
    process.exit(code);
  });
