import { describe, expect, it } from 'vitest';
import { renderBanner } from '../src/banner';

describe('banner', () => {
  it('renders block-art logo when terminal is wide enough', () => {
    const out = renderBanner({ cols: 100, color: false });
    expect(out).toContain('░');
    expect(out).toContain('█');
    expect(out).toContain('Universal agent-payment CLI');
  });

  it('falls back to plain-text brand on narrow terminals', () => {
    const out = renderBanner({ cols: 40, color: false });
    expect(out).not.toContain('░');
    expect(out).toContain('AgentScore Pay');
    expect(out).toContain('Universal agent-payment CLI');
  });

  it('uses full brand prefix, never bare Pay or PAY.SH', () => {
    const wide = renderBanner({ cols: 100, color: false });
    const narrow = renderBanner({ cols: 40, color: false });
    expect(wide).not.toContain('PAY.SH');
    expect(narrow).not.toContain('PAY.SH');
    expect(narrow).toContain('AgentScore Pay');
  });

  it('omits ANSI escapes when color is disabled', () => {
    const out = renderBanner({ cols: 100, color: false });
    expect(out).not.toContain('\x1b[');
  });

  it('includes ANSI escapes when color is enabled', () => {
    const out = renderBanner({ cols: 100, color: true });
    expect(out).toContain('\x1b[');
  });

  it('plain-text fallback never includes ANSI escapes regardless of color flag', () => {
    const out = renderBanner({ cols: 40, color: true });
    expect(out).not.toContain('\x1b[');
  });

  it('plain art width fits within 70 cols (the threshold for falling back)', () => {
    const out = renderBanner({ cols: 100, color: false });
    const artLines = out.split('\n').filter((line) => line.includes('░') || line.includes('█'));
    for (const line of artLines) {
      expect(line.length).toBeLessThanOrEqual(70);
    }
  });

  it('groups commands by audience role', () => {
    const out = renderBanner({ cols: 100, color: false });
    expect(out).toContain('Pay any 402 / MPP endpoint:');
    expect(out).toContain('Identity (AgentScore Passport):');
    expect(out).toContain('Agents (LLM tool-loop):');
    expect(out).toContain('Account management:');
    expect(out).toContain('Output formats:');
  });

  it('lists real commands without the binary prefix', () => {
    const out = renderBanner({ cols: 100, color: false });
    for (const cmd of [
      'pay',
      'check',
      'balance',
      'discover',
      'fund',
      'passport',
      'reputation',
      'assess',
      'credentials',
      'agent-guide',
      'skills add',
      'init',
      'wallet',
      'limits',
      'history',
    ]) {
      expect(out).toContain(cmd);
    }
    // Lines starting with the binary prefix would be the old format; new format omits it.
    const lines = out.split('\n');
    const prefixedLines = lines.filter((l) => l.startsWith('  agentscore-pay '));
    expect(prefixedLines).toHaveLength(0);
  });

  it('surfaces dual-audience output flags', () => {
    const out = renderBanner({ cols: 100, color: false });
    expect(out).toContain('--json');
    expect(out).toContain('--format toon');
    expect(out).toContain('--help');
    expect(out).toContain('--mcp');
  });

  it('does not reference the unbuilt `fund options` subcommand', () => {
    const out = renderBanner({ cols: 100, color: false });
    expect(out).not.toContain('fund options');
  });
});
