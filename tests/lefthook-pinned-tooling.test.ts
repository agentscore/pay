/**
 * Guard test: the git hooks must run this repo's own pinned tooling.
 *
 * `bunx <tool>` resolves the tool independently of the project, so it can fetch
 * a different major and fail, or pass, for reasons unrelated to the code being
 * checked, and it writes to the lockfile as a side effect. This repo is the
 * worst case for it: eslint is held at 9 and TypeScript at 6 while 10 and 7 are
 * published, so `bunx eslint` and `bunx tsc` would pull precisely the majors the
 * manifest pins away from.
 *
 * CI invokes the package scripts, so the hooks are the only place that can drift
 * away from them, and a hook that "passes" against the wrong tool version looks
 * exactly like a hook that works.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = join(__dirname, '..');
const lefthook = readFileSync(join(ROOT, 'lefthook.yml'), 'utf8');

/** Every `run:` line, trimmed of the key. */
const runLines = lefthook
  .split('\n')
  .map((l) => l.trim())
  .filter((l) => l.startsWith('run:'))
  .map((l) => l.slice('run:'.length).trim());

describe('lefthook runs pinned tooling', () => {
  it('finds the hook commands (an empty sweep must not read as agreement)', () => {
    expect(runLines.length).toBeGreaterThan(0);
  });

  it('never invokes bunx', () => {
    const offenders = runLines.filter((l) => /\bbunx\b/.test(l));
    expect(offenders, `bunx resolves outside the project: ${offenders.join(', ')}`).toEqual([]);
  });

  it('lints through the local eslint binary', () => {
    const lint = runLines.find((l) => l.includes('eslint'));
    expect(lint).toBeDefined();
    expect(lint).toContain('./node_modules/.bin/eslint');
  });

  it('typechecks through the pinned script rather than a bare tsc', () => {
    const tc = runLines.find((l) => l.includes('typecheck') || l.includes('tsc'));
    expect(tc).toBeDefined();
    expect(tc).toBe('bun run typecheck');
  });

  // The hooks are only worth anything if the scripts they call exist.
  it('every `bun run <script>` hook names a real package script', () => {
    const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as { scripts: Record<string, string> };
    const scripts = runLines
      .filter((l) => l.startsWith('bun run '))
      .map((l) => l.slice('bun run '.length).split(' ')[0]);
    expect(scripts.length).toBeGreaterThan(0);
    for (const s of scripts) {
      expect(pkg.scripts[s], `lefthook calls \`bun run ${s}\` but no such script exists`).toBeDefined();
    }
  });
});
