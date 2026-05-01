import { describe, expect, it } from 'vitest';
import { agentGuide } from '../src/commands/agent-guide';

describe('agent-guide', () => {
  it('returns the structured guide payload', async () => {
    const guide = await agentGuide();
    expect(guide.for_agents).toBe(true);
    expect(guide.golden_path.length).toBeGreaterThan(0);
    expect(guide.exit_codes['0']).toBe('success');
    expect(guide.exit_codes['4']).toContain('rejected');
  });

  it('every golden_path step has a step + why', async () => {
    const guide = await agentGuide();
    for (const step of guide.golden_path) {
      expect(step.step).toBeTruthy();
      expect(step.why).toBeTruthy();
    }
  });

  it('identity_error_recovery covers config_error, insufficient_balance, quota_exceeded, network_error', async () => {
    const guide = await agentGuide();
    const codes = guide.identity_error_recovery.map((p) => p.cli_code);
    expect(codes).toContain('config_error');
    expect(codes).toContain('insufficient_balance');
    expect(codes).toContain('quota_exceeded');
    expect(codes).toContain('network_error');
    for (const pattern of guide.identity_error_recovery) {
      expect(pattern.thrown_when).toBeTruthy();
      expect(pattern.next_action).toBeTruthy();
      expect(pattern.recovery).toBeTruthy();
    }
  });
});
