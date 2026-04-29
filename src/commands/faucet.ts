import { spawn } from 'child_process';
import { CliError } from '../errors';
import { faucetUrls, tempoFaucetNote } from '../faucets';
import { loadKeystore } from '../keystore';
import type { Chain, Network } from '../constants';

export interface FaucetResult {
  chain: Chain;
  network: Network;
  address: string;
  faucet_urls: string[];
  address_copied_to_clipboard: boolean;
  notes?: string;
}

async function copyToClipboard(text: string): Promise<boolean> {
  const candidates = [
    { cmd: 'pbcopy', args: [] as string[] },
    { cmd: 'xclip', args: ['-selection', 'clipboard'] },
    { cmd: 'wl-copy', args: [] as string[] },
    { cmd: 'clip', args: [] as string[] },
  ];
  for (const { cmd, args } of candidates) {
    try {
      const ok = await new Promise<boolean>((resolve) => {
        const proc = spawn(cmd, args, { stdio: ['pipe', 'ignore', 'ignore'] });
        proc.on('error', () => resolve(false));
        proc.on('close', (code) => resolve(code === 0));
        proc.stdin.end(text);
      });
      if (ok) return true;
    } catch {
      // continue trying
    }
  }
  return false;
}

export async function faucet(input: { chain: Chain; network: Network }): Promise<FaucetResult> {
  if (input.network !== 'testnet') {
    throw new CliError('invalid_input', 'faucet only supports --network testnet.', {
      nextSteps: {
        action: 'pass_testnet_flag',
        suggestion: 'Faucets only exist on testnets. Re-run with --network testnet.',
      },
    });
  }

  const ks = await loadKeystore(input.chain);
  const urls = faucetUrls(input.chain, input.network);
  const copied = await copyToClipboard(ks.address);

  return {
    chain: input.chain,
    network: input.network,
    address: ks.address,
    faucet_urls: urls,
    address_copied_to_clipboard: copied,
    ...(input.chain === 'tempo' ? { notes: tempoFaucetNote() } : {}),
  };
}
