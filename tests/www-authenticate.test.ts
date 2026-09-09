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

  it('prices a stripe/charge challenge in cents, not 6-decimal token units', () => {
    // Real challenge from agents.scaledown.ai for a $5 top-up: 520 cents on the card rail.
    const headers = new Headers({
      'www-authenticate':
        'Payment id="-HTImfu1z1M_d_wnBV7gi5SxlH-E0E4rP1z1h2ovm1E", realm="agents.scaledown.ai", method="stripe", intent="charge", request="eyJhbW91bnQiOiI1MjAiLCJjdXJyZW5jeSI6InVzZCIsIm1ldGhvZERldGFpbHMiOnsibmV0d29ya0lkIjoicHJvZmlsZV82MVVoenpxcVdScUFsOFJpZkE2VWh6enBMTlNRS2VmQnB2dXdLbThvYTg1SSIsInBheW1lbnRNZXRob2RUeXBlcyI6WyJjYXJkIiwibGluayJdfX0", expires="2026-09-09T16:54:53.226Z"',
    });
    const [c] = parsePaymentChallenges(headers);
    const rail = challengeToRail(c);
    expect(rail.price_raw).toBe('520');
    expect(rail.price_usd).toBe('5.20');
    expect(rail.asset).toBe('usd');
    expect(rail.natively_supported).toBe(false);
  });

  it('honors methodDetails.decimals on a solana challenge', () => {
    const headers = new Headers({
      'www-authenticate':
        'Payment id="WwV8KyG2lRZ0OWV3Wy5EirC2cAkD7E-Itfv8Tshsgws", realm="agents.scaledown.ai", method="solana", intent="charge", request="eyJhbW91bnQiOiI1MDAwMDAwIiwiY3VycmVuY3kiOiJFUGpGV2RkNUF1ZnFTU3FlTTJxTjF4enliYXBDOEc0d0VHR2tad3lURHQxdiIsIm1ldGhvZERldGFpbHMiOnsiZGVjaW1hbHMiOjYsImZlZVBheWVyIjp0cnVlLCJmZWVQYXllcktleSI6IjZTODlZTXk5dGN5UWVqOHVidzN1Q1NQZHdCRG1CTUNlVlRNalFWWmZBcExWIiwibmV0d29yayI6Im1haW5uZXQtYmV0YSIsInJlY2VudEJsb2NraGFzaCI6IjZQWHRGTUF4VVQ1WWlBR2lXR2tDY2I4RWFqZ3d1MnhMSFpKM3FYVjIxclVnIiwidG9rZW5Qcm9ncmFtIjoiVG9rZW5rZWdRZmVaeWlOd0FKYk5iR0tQRlhDV3VCdmY5U3M2MjNWUTVEQSJ9LCJyZWNpcGllbnQiOiI4Um5rU0NpaHJIaVh1R2RhcFZwRHRBZUo0Umo4aXdkb2tLcEc1NDltNTlBZiJ9", expires="2026-09-09T16:54:53.173Z"',
    });
    const [c] = parsePaymentChallenges(headers);
    const rail = challengeToRail(c);
    expect(rail.price_usd).toBe('5.000000');
  });

  it('leaves price_usd undefined for a non-USD fiat challenge', () => {
    const request = Buffer.from(JSON.stringify({ amount: '1000', currency: 'jpy' })).toString('base64');
    const headers = new Headers({ 'www-authenticate': `Payment id="x", method="stripe", request="${request}"` });
    const [c] = parsePaymentChallenges(headers);
    const rail = challengeToRail(c);
    expect(rail.price_raw).toBe('1000');
    expect(rail.price_usd).toBeUndefined();
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
