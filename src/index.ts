import { run } from './cli';

run(process.argv).catch((err: unknown) => {
  const msg = err instanceof Error ? err.message : String(err);
  console.error(`agentscore-x402: ${msg}`);
  process.exit(1);
});
