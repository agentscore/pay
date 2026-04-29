import { run } from './cli';
import { getNoticeIfNewer, refreshCacheAwaited, refreshCacheInBackground } from './update-check';

declare const __VERSION__: string;

const VERSION = typeof __VERSION__ === 'string' ? __VERSION__ : '0.0.0-dev';

async function emitUpdateNoticeIfAvailable(): Promise<void> {
  if (!process.stdout.isTTY) return;
  const latest = await getNoticeIfNewer(VERSION);
  if (latest) {
    process.stderr.write(
      `\n  → A newer @agent-score/pay is available: ${latest} (you have ${VERSION}). Update with: npm i -g @agent-score/pay\n`,
    );
  }
}

run()
  .then(async () => {
    await emitUpdateNoticeIfAvailable();
    refreshCacheInBackground();
  })
  .catch(async (err: unknown) => {
    // incur's serve() handles its own error formatting + exit codes for thrown errors
    // from command handlers. This catch only fires on unexpected runtime crashes.
    const e = err instanceof Error ? err : new Error(String(err));
    process.stderr.write(`agentscore-pay: ${e.message}\n`);
    await refreshCacheAwaited();
    process.exit(1);
  });
