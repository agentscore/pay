# Security Policy

## Reporting a Vulnerability

If you discover a security vulnerability, please report it responsibly.

**Do not open a public GitHub issue for security vulnerabilities.**

Instead, email us at **security@agentscore.sh** with:

- Description of the vulnerability
- Steps to reproduce
- Potential impact
- Suggested fix (if any)

We will acknowledge receipt within 48 hours and aim to release a fix within 7 days for critical issues.

## Supported Versions

| Version | Supported |
|---------|-----------|
| 1.x     | ✅        |
| < 1.0   | ❌        |

## Scope

This is a CLI wallet. The security model assumes:

- The machine running the CLI is trusted — keys are encrypted at rest, but a compromised host with keyboard/memory access can recover them
- The passphrase is not logged anywhere (we prompt interactively or read from `AGENTSCORE_PAY_PASSPHRASE`)
- `wallet export` and `wallet show-mnemonic` print secret material to stdout — only run these on trusted terminals

Issues outside this scope (e.g., extracting keys from a machine you already control, upstream `@x402/fetch` / `mppx` / `viem` vulnerabilities) should be reported to the respective projects.
