import { describe, expect, it } from 'vitest';
import { extractNextStepsAction, extractTxHash } from '../src/payment-receipt';

describe('extractTxHash', () => {
  it('returns tx from x-payment-response (base64-encoded JSON)', () => {
    const payload = { transaction: '0xdeadbeef', success: true };
    const headers = new Headers({
      'x-payment-response': Buffer.from(JSON.stringify(payload)).toString('base64'),
    });
    expect(extractTxHash(headers, null)).toBe('0xdeadbeef');
  });

  it('handles tx_hash key in x-payment-response payload', () => {
    const payload = { tx_hash: '0xabc123' };
    const headers = new Headers({
      'x-payment-response': Buffer.from(JSON.stringify(payload)).toString('base64'),
    });
    expect(extractTxHash(headers, null)).toBe('0xabc123');
  });

  it('falls back to raw 0x-prefixed header value when not base64 JSON', () => {
    const headers = new Headers({ 'x-payment-response': '0xrawhash' });
    expect(extractTxHash(headers, null)).toBe('0xrawhash');
  });

  it('returns undefined when header is base64 garbage and not 0x-prefixed', () => {
    const headers = new Headers({ 'x-payment-response': 'not-json-not-hex' });
    expect(extractTxHash(headers, null)).toBeUndefined();
  });

  it('treats a base58 Solana-signature-shaped header value as the tx hash', () => {
    const sig = '5J' + 'a'.repeat(86); // 88 chars, base58-safe
    const headers = new Headers({ 'x-payment-response': sig });
    expect(extractTxHash(headers, null)).toBe(sig);
  });

  it('does not classify shorter base58 strings as Solana signatures', () => {
    const headers = new Headers({ 'x-payment-response': 'abcdef' });
    expect(extractTxHash(headers, null)).toBeUndefined();
  });

  it('does not classify base58-shaped strings with disallowed chars (0OIl) as Solana sigs', () => {
    const headers = new Headers({ 'x-payment-response': '0' + 'a'.repeat(87) });
    expect(extractTxHash(headers, null)).toBeUndefined();
  });

  it('reads tx_hash from response body when no header present', () => {
    const headers = new Headers();
    expect(extractTxHash(headers, { tx_hash: '0xfromBody' })).toBe('0xfromBody');
  });

  it('reads transaction from body when tx_hash absent', () => {
    expect(extractTxHash(new Headers(), { transaction: '0xfromBody' })).toBe('0xfromBody');
  });

  it('reads payment.tx_hash from nested body', () => {
    expect(extractTxHash(new Headers(), { payment: { tx_hash: '0xnested' } })).toBe('0xnested');
  });

  it('returns undefined when no source has a tx', () => {
    expect(extractTxHash(new Headers(), null)).toBeUndefined();
    expect(extractTxHash(new Headers(), {})).toBeUndefined();
    expect(extractTxHash(new Headers(), 'string body')).toBeUndefined();
  });

  it('ignores empty-string tx values', () => {
    expect(extractTxHash(new Headers(), { tx_hash: '' })).toBeUndefined();
  });

  it('header takes precedence over body', () => {
    const headers = new Headers({
      'x-payment-response': Buffer.from(JSON.stringify({ transaction: '0xheader' })).toString('base64'),
    });
    expect(extractTxHash(headers, { tx_hash: '0xbody' })).toBe('0xheader');
  });
});

describe('extractNextStepsAction', () => {
  it('returns next_steps.action from gate-shaped body', () => {
    expect(extractNextStepsAction({ next_steps: { action: 'shipping_pending' } })).toBe('shipping_pending');
  });

  it('returns undefined when next_steps missing', () => {
    expect(extractNextStepsAction({ ok: true })).toBeUndefined();
  });

  it('returns undefined when next_steps.action is not a string', () => {
    expect(extractNextStepsAction({ next_steps: { action: 42 } })).toBeUndefined();
  });

  it('returns undefined for null or non-object input', () => {
    expect(extractNextStepsAction(null)).toBeUndefined();
    expect(extractNextStepsAction('string')).toBeUndefined();
    expect(extractNextStepsAction(42)).toBeUndefined();
  });

  it('returns undefined when action is empty string', () => {
    expect(extractNextStepsAction({ next_steps: { action: '' } })).toBeUndefined();
  });
});
