import { spawn } from 'child_process';
import { CliError } from '../errors';
import { faucetUrls, tempoFaucetNote } from '../faucets';
import { loadKeystore } from '../keystore';
import { isJson, writeJson, writeLine } from '../output';
import type { Chain, Network } from '../constants';

interface FaucetInfo {
  chain: Chain;
  network: Network;
  address: string;
  faucet_urls: string[];
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

export async function faucet(chain: Chain, network: Network): Promise<void> {
  if (network !== 'testnet') {
    throw new CliError('invalid_input', 'faucet only supports --network testnet.', {
      nextSteps: {
        action: 'pass_testnet_flag',
        suggestion: 'Faucets only exist on testnets. Re-run with --network testnet.',
      },
    });
  }

  const ks = await loadKeystore(chain);
  const urls = faucetUrls(chain, network);
  const info: FaucetInfo = {
    chain,
    network,
    address: ks.address,
    faucet_urls: urls,
  };
  if (chain === 'tempo') info.notes = tempoFaucetNote();

  const copied = await copyToClipboard(ks.address);

  if (isJson()) {
    writeJson({ ...info, address_copied_to_clipboard: copied });
    return;
  }

  writeLine(`Faucet for ${chain} ${network}`);
  writeLine('');
  writeLine(`  Your address: ${ks.address}${copied ? '  (copied to clipboard)' : ''}`);
  writeLine('');
  if (info.notes) {
    writeLine(info.notes);
    return;
  }
  if (urls.length === 0) {
    writeLine('No public faucet URL registered for this chain; see Tempo-style testnet notes above.');
    return;
  }
  writeLine('Paste the address on any of these faucets:');
  for (const url of urls) writeLine(`  • ${url}`);
}
