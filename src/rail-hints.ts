export interface RailHint {
  name: string;
  description?: string;
  docs_url?: string;
  recommended_client?: {
    name: string;
    install?: string;
    docs_url?: string;
  };
}

const HINTS: Record<string, RailHint> = {
  'eip155:1': {
    name: 'Ethereum mainnet (x402)',
    description: 'x402 on Ethereum L1 — not natively supported by agentscore-pay; gas typically makes micropayments uneconomical.',
    docs_url: 'https://x402.org',
  },
  'eip155:137': {
    name: 'Polygon (x402)',
    description: 'x402 on Polygon — not natively supported by agentscore-pay.',
    docs_url: 'https://polygon.technology',
  },
  'eip155:42161': {
    name: 'Arbitrum (x402)',
    description: 'x402 on Arbitrum — not natively supported by agentscore-pay.',
    docs_url: 'https://x402.org',
  },
  'eip155:10': {
    name: 'Optimism (x402)',
    description: 'x402 on Optimism — not natively supported by agentscore-pay.',
    docs_url: 'https://x402.org',
  },
  stripe: {
    name: 'Stripe (Shared Payment Token)',
    description:
      "User-approved card payment from a Link wallet. Each spend requires the user's explicit approval via push notification.",
    docs_url: 'https://docs.stripe.com',
    recommended_client: {
      name: '@stripe/link-cli',
      install: 'npm i -g @stripe/link-cli',
      docs_url: 'https://github.com/stripe/link-cli',
    },
  },
  'stripe-spt': {
    name: 'Stripe Shared Payment Token',
    description:
      "User-approved card payment from a Link wallet. Each spend requires the user's explicit approval via push notification.",
    docs_url: 'https://docs.stripe.com',
    recommended_client: {
      name: '@stripe/link-cli',
      install: 'npm i -g @stripe/link-cli',
      docs_url: 'https://github.com/stripe/link-cli',
    },
  },
};

export function lookupRailHint(opts: { network?: string; scheme?: string; method?: string }): RailHint | undefined {
  const { network, scheme, method } = opts;
  if (network && HINTS[network]) return HINTS[network];
  if (method) {
    const m = method.toLowerCase();
    if (HINTS[m]) return HINTS[m];
    if (m.startsWith('stripe')) return HINTS.stripe;
  }
  if (scheme) {
    const s = scheme.toLowerCase();
    if (HINTS[s]) return HINTS[s];
    if (s.startsWith('stripe')) return HINTS.stripe;
  }
  return undefined;
}
