import { describe, expect, it } from 'vitest';
import { renderBanner } from '../src/banner';

describe('banner', () => {
  it('renders block-art logo when terminal is wide enough', () => {
    const out = renderBanner({ cols: 100, color: false });
    expect(out).toContain('░');
    expect(out).toContain('█');
    expect(out).toContain('Universal agent-payment CLI');
    expect(out).toContain('Quick start:');
    expect(out).toContain('agentscore-pay init');
  });

  it('falls back to plain-text brand on narrow terminals', () => {
    const out = renderBanner({ cols: 40, color: false });
    expect(out).not.toContain('░');
    expect(out).toContain('AgentScore Pay');
    expect(out).toContain('Universal agent-payment CLI');
    expect(out).toContain('Quick start:');
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

  it('quick-start references the binary, not the brand', () => {
    const out = renderBanner({ cols: 100, color: false });
    expect(out).toContain('agentscore-pay init');
    expect(out).toContain('agentscore-pay balance');
    expect(out).toContain('agentscore-pay pay POST <URL>');
    expect(out).toContain('agentscore-pay fund options');
    expect(out).toContain('agentscore-pay agent-guide');
  });
});
