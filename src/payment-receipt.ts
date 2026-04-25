export function extractTxHash(headers: Headers, body: unknown): string | undefined {
  const header = headers.get('x-payment-response');
  if (header) {
    try {
      const decoded = JSON.parse(Buffer.from(header, 'base64').toString('utf-8')) as Record<string, unknown>;
      const tx = decoded.transaction ?? decoded.tx ?? decoded.tx_hash;
      if (typeof tx === 'string' && tx.length > 0) return tx;
    } catch {
      if (header.startsWith('0x')) return header;
    }
  }
  if (body && typeof body === 'object') {
    const obj = body as Record<string, unknown>;
    const tx = obj.tx_hash ?? obj.transaction ?? obj.tx;
    if (typeof tx === 'string' && tx.length > 0) return tx;
    const payment = obj.payment;
    if (payment && typeof payment === 'object') {
      const ptx = (payment as Record<string, unknown>).tx_hash;
      if (typeof ptx === 'string' && ptx.length > 0) return ptx;
    }
  }
  return undefined;
}

export function extractNextStepsAction(body: unknown): string | undefined {
  if (!body || typeof body !== 'object') return undefined;
  const next = (body as Record<string, unknown>).next_steps;
  if (next && typeof next === 'object') {
    const action = (next as Record<string, unknown>).action;
    if (typeof action === 'string' && action.length > 0) return action;
  }
  return undefined;
}
