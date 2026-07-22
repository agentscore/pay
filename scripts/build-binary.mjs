// Compiled binaries need __VERSION__ injected at build time the same way the
// tsup bundle gets it; a bare `bun build --compile` leaves the define unset
// and the binary reports 0.0.0-dev from --version and MCP serverInfo.
import { execSync } from 'node:child_process';
import console from 'node:console';
import { readFileSync } from 'node:fs';
import process from 'node:process';

const { version } = JSON.parse(readFileSync('./package.json', 'utf8'));
const [target, outfile] = process.argv.slice(2);
if (!target || !outfile) {
  console.error('usage: node scripts/build-binary.mjs <bun-target> <outfile>');
  process.exit(1);
}
execSync(
  `bun build src/index.ts --compile --target=${target} --outfile ${outfile} --define __VERSION__='"${version}"'`,
  { stdio: 'inherit' },
);
