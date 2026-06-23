import { describe, it, expect } from 'vitest';
import { formatUpdateDiscordMessage } from './format';

describe('formatUpdateDiscordMessage', () => {
  it('shows current and available versions', () => {
    const { content } = formatUpdateDiscordMessage({ serverName: 'Survival', current: '1.21.1', available: '1.21.4', sourceLabel: 'Vanilla' });
    expect(content).toContain('Survival');
    expect(content).toContain('1.21.1');
    expect(content).toContain('1.21.4');
    expect(content).toContain('Vanilla');
  });
  it('handles an unknown current version', () => {
    const { content } = formatUpdateDiscordMessage({ serverName: 'Survival', current: null, available: '1.21.4', sourceLabel: 'Vanilla' });
    expect(content).toContain('unknown');
    expect(content).toContain('1.21.4');
  });
});
