import { cancel, isCancel, password as clackPassword } from '@clack/prompts';

const ENV_PASSPHRASE = 'AGENTSCORE_PAY_PASSPHRASE';

export async function promptPassphrase(message = 'Enter wallet passphrase'): Promise<string> {
  if (process.env[ENV_PASSPHRASE]) return process.env[ENV_PASSPHRASE] as string;
  const result = await clackPassword({
    message,
    validate: (v) => (v && v.length >= 8 ? undefined : 'Passphrase must be at least 8 characters'),
  });
  if (isCancel(result)) {
    cancel('Cancelled.');
    process.exit(1);
  }
  return result as string;
}

export async function promptNewPassphrase(): Promise<string> {
  if (process.env[ENV_PASSPHRASE]) return process.env[ENV_PASSPHRASE] as string;
  const first = await promptPassphrase('Create a passphrase (min 8 chars)');
  const second = await promptPassphrase('Confirm passphrase');
  if (first !== second) {
    cancel('Passphrases did not match.');
    process.exit(1);
  }
  return first;
}
