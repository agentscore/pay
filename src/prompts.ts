import { cancel, isCancel, password as clackPassword } from '@clack/prompts';
import { CliError } from './errors';
import { clearCache } from './unlock-cache';

const ENV_PASSPHRASE = 'AGENTSCORE_PAY_PASSPHRASE';

function isInteractive(): boolean {
  return Boolean(process.stdin.isTTY && process.stdout.isTTY);
}

export async function promptPassphrase(message = 'Enter wallet passphrase'): Promise<string> {
  const envPass = process.env[ENV_PASSPHRASE];
  if (envPass) return envPass;

  // The plaintext passphrase cache is gone; this DELETES a leftover one rather
  // than reading it. An installation upgrading from a version that wrote the
  // file would otherwise keep a cleartext secret on disk with nothing left that
  // admits to using it, which is worse than either using it or never having
  // written it. Silent because it is cleanup rather than an error, and the
  // passphrase is asked for immediately below.
  await clearCache().catch(() => false);

  if (!isInteractive()) {
    throw new CliError('user_cancelled', 'Passphrase required but no TTY and AGENTSCORE_PAY_PASSPHRASE not set.', {
      nextSteps: {
        action: 'set_env_passphrase',
        suggestion: 'Set AGENTSCORE_PAY_PASSPHRASE=... in the environment. The `unlock` passphrase cache was removed: it stored the passphrase in cleartext on disk, and the environment variable is the supported way to run unattended.',
      },
    });
  }
  const result = await clackPassword({
    message,
    validate: (v) => (v && v.length >= 8 ? undefined : 'Passphrase must be at least 8 characters'),
  });
  if (isCancel(result)) {
    cancel('Cancelled.');
    throw new CliError('user_cancelled', 'Passphrase input cancelled.');
  }
  return result as string;
}

export async function promptNewPassphrase(): Promise<string> {
  const envPass = process.env[ENV_PASSPHRASE];
  if (envPass) {
    if (envPass.length < 8) {
      throw new CliError('passphrase_too_short', 'AGENTSCORE_PAY_PASSPHRASE must be at least 8 characters.');
    }
    return envPass;
  }
  if (!isInteractive()) {
    throw new CliError('user_cancelled', 'Passphrase required but no TTY and AGENTSCORE_PAY_PASSPHRASE not set.', {
      nextSteps: {
        action: 'set_env_passphrase',
        suggestion: 'Set AGENTSCORE_PAY_PASSPHRASE=... in the environment before running.',
      },
    });
  }
  const first = await promptPassphrase('Create a passphrase (min 8 chars)');
  const second = await promptPassphrase('Confirm passphrase');
  if (first !== second) {
    throw new CliError('passphrase_mismatch', 'Passphrases did not match.');
  }
  return first;
}
