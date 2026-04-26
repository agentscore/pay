import { describe, expect, it } from 'vitest';
import { challengeToRail, parsePaymentChallenges } from '../src/www-authenticate';

const AGENTMAIL_HEADER =
  'Payment id="ZA7zPz8H3U2kkOuLF8Uz7UHF1GOVh6N41PK6Fz2MuqE", realm="mpp.api.agentmail.to", method="tempo", intent="charge", request="eyJhbW91bnQiOiIyMDAwMDAwIiwiY3VycmVuY3kiOiIweDIwQzAwMDAwMDAwMDAwMDAwMDAwMDAwMGI5NTM3ZDExYzYwRThiNTAiLCJtZXRob2REZXRhaWxzIjp7ImNoYWluSWQiOjQyMTd9LCJyZWNpcGllbnQiOiIweDZlMzE4NEMyMDRlNTk2ZEVEODlFOEE1NjkzQjYwMjA5N0Y0QWI2ODcifQ", expires="2026-04-26T00:27:52.082Z"';

describe('parsePaymentChallenges', () => {
  it('returns empty when no header', () => {
    expect(parsePaymentChallenges(new Headers())).toEqual([]);
  });

  it('parses the agentmail.to Payment challenge', () => {
    const headers = new Headers({ 'www-authenticate': AGENTMAIL_HEADER });
    const challenges = parsePaymentChallenges(headers);
    expect(challenges).toHaveLength(1);
    const c = challenges[0];
    expect(c.method).toBe('tempo');
    expect(c.realm).toBe('mpp.api.agentmail.to');
    expect(c.id).toBe('ZA7zPz8H3U2kkOuLF8Uz7UHF1GOVh6N41PK6Fz2MuqE');
    expect(c.intent).toBe('charge');
    expect(c.expires).toBe('2026-04-26T00:27:52.082Z');
    expect(c.request?.amount).toBe('2000000');
    expect(c.request?.methodDetails?.chainId).toBe(4217);
    expect(c.request?.recipient).toBe('0x6e3184C204e596dED89E8A5693B602097F4Ab687');
    expect(c.request?.currency).toBe('0x20C000000000000000000000b9537d11c60E8b50');
  });

  it('parses multiple Payment challenges in one header', () => {
    const headers = new Headers({
      'www-authenticate':
        'Payment id="a", realm="x.com", method="tempo", request="e30=", Payment id="b", realm="x.com", method="stripe", request="e30="',
    });
    const challenges = parsePaymentChallenges(headers);
    expect(challenges).toHaveLength(2);
    expect(challenges[0].method).toBe('tempo');
    expect(challenges[1].method).toBe('stripe');
  });

  it('ignores non-Payment auth schemes', () => {
    const headers = new Headers({ 'www-authenticate': 'Basic realm="x", Bearer realm="y"' });
    expect(parsePaymentChallenges(headers)).toEqual([]);
  });

  it('handles malformed base64 by leaving request undefined', () => {
    const headers = new Headers({
      'www-authenticate': 'Payment id="x", method="tempo", request="not-valid-base64!@#"',
    });
    const challenges = parsePaymentChallenges(headers);
    expect(challenges).toHaveLength(1);
    expect(challenges[0].request).toBeUndefined();
    expect(challenges[0].request_raw).toBe('not-valid-base64!@#');
  });
});

describe('challengeToRail', () => {
  it('marks tempo method (chainId 4217) as natively supported', () => {
    const headers = new Headers({ 'www-authenticate': AGENTMAIL_HEADER });
    const [c] = parsePaymentChallenges(headers);
    const rail = challengeToRail(c);
    expect(rail.natively_supported).toBe(true);
    expect(rail.scheme).toBe('tempo');
    expect(rail.network).toBe('eip155:4217');
    expect(rail.price_usd).toBe('2.000000');
    expect(rail.pay_to).toBe('0x6e3184C204e596dED89E8A5693B602097F4Ab687');
    expect(rail.hint).toBeUndefined();
  });

  it('marks unknown method (stripe) as unsupported with link-cli hint', () => {
    const headers = new Headers({
      'www-authenticate':
        'Payment id="x", method="stripe", realm="press.stripe.com", request="eyJhbW91bnQiOiIzNTAwIn0="',
    });
    const [c] = parsePaymentChallenges(headers);
    const rail = challengeToRail(c);
    expect(rail.natively_supported).toBe(false);
    expect(rail.scheme).toBe('stripe');
    expect(rail.hint?.recommended_client?.name).toBe('@stripe/link-cli');
  });
});
