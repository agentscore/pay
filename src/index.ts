import { run } from './cli';
import { writeError } from './output';

run(process.argv).catch((err: unknown) => {
  const e = err instanceof Error ? err : new Error(String(err));
  const code = writeError(e);
  process.exit(code);
});
