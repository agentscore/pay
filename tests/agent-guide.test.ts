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
});
