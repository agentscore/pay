import { spawn } from 'child_process';
import { access, constants } from 'fs/promises';
import { homedir } from 'os';
import { delimiter, join } from 'path';

/**
 * Tempo's install script (https://tempo.xyz/install) drops the binary at
 * ~/.tempo/bin/tempo. Some users may have it on PATH instead. We check both.
 */
function tempoHomeBin(): string {
  return join(homedir(), '.tempo', 'bin', 'tempo');
}

export interface TempoCli {
  found: boolean;
  path?: string;
}

export async function locateTempoCli(): Promise<TempoCli> {
  const homeBin = tempoHomeBin();
  try {
    await access(homeBin, constants.X_OK);
    return { found: true, path: homeBin };
  } catch {
    // fall through
  }

  const pathVar = process.env.PATH ?? '';
  const exts = process.platform === 'win32' ? (process.env.PATHEXT ?? '.EXE;.CMD;.BAT').split(';') : [''];
  for (const dir of pathVar.split(delimiter)) {
    if (!dir) continue;
    for (const ext of exts) {
      const candidate = join(dir, `tempo${ext.toLowerCase()}`);
      try {
        await access(candidate, constants.X_OK);
        return { found: true, path: candidate };
      } catch {
        // continue
      }
    }
  }
  return { found: false };
}

export interface SpawnTempoResult {
  exitCode: number;
}

export function spawnTempo(binPath: string, args: string[]): Promise<SpawnTempoResult> {
  return new Promise((resolve, reject) => {
    const proc = spawn(binPath, args, { stdio: 'inherit' });
    proc.on('error', (err) => reject(err));
    proc.on('close', (code) => resolve({ exitCode: code ?? 0 }));
  });
}

export const TEMPO_INSTALL_URL = 'https://tempo.xyz/install';
