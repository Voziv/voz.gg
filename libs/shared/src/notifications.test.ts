import { describe, it, expect } from 'vitest';
import { evaluateNotifications, formatNotification, type EvaluateInput } from './notifications';

const base: EvaluateInput = {
  type: 'join',
  status: 'new',
  isBot: false,
  muted: false,
  hasPriorJoin: false,
  occurredAt: 1_000_000,
  lastSentAt: {},
};
const trig = (i: Partial<EvaluateInput>) =>
  evaluateNotifications({ ...base, ...i }).map((p) => p.trigger);

describe('evaluateNotifications', () => {
  it('fires first_sighting on a first join', () => {
    expect(trig({ status: 'allowed' })).toEqual(['first_sighting']);
  });
  it('does not fire first_sighting when a prior join exists', () => {
    expect(trig({ status: 'allowed', hasPriorJoin: true })).toEqual([]);
  });
  it('fires first_sighting only once ever (cooldown via lastSentAt)', () => {
    expect(trig({ status: 'allowed', lastSentAt: { first_sighting: 500_000 } })).toEqual([]);
  });
  it('fires new_player_rejection on a rejected new player', () => {
    expect(trig({ type: 'connection_rejected', status: 'new' })).toEqual(['new_player_rejection']);
  });
  it('respects the 24h cooldown on new_player_rejection', () => {
    const last = base.occurredAt - 86_399;
    expect(trig({ type: 'connection_rejected', status: 'new', lastSentAt: { new_player_rejection: last } })).toEqual([]);
    const old = base.occurredAt - 86_400;
    expect(trig({ type: 'connection_rejected', status: 'new', lastSentAt: { new_player_rejection: old } })).toEqual(['new_player_rejection']);
  });
  it('fires blocked_return on a blocked join or rejection', () => {
    expect(trig({ status: 'blocked' })).toEqual(['blocked_return']);
    expect(trig({ type: 'connection_rejected', status: 'blocked' })).toEqual(['blocked_return']);
  });
  it('fires bot_escalation when an isBot player joins', () => {
    expect(trig({ status: 'allowed', isBot: true })).toEqual(['bot_escalation']);
  });
  it('fires bot_escalation when a muted player joins, despite mute', () => {
    expect(trig({ status: 'allowed', muted: true })).toEqual(['bot_escalation']);
  });
  it('bot_escalation wins precedence over blocked_return on a bot+blocked join', () => {
    expect(trig({ status: 'blocked', isBot: true })).toEqual(['bot_escalation']);
  });
  it('mutes the routine triggers (no escalation on a rejection)', () => {
    expect(trig({ type: 'connection_rejected', status: 'new', muted: true })).toEqual([]);
    expect(trig({ status: 'blocked', type: 'connection_rejected', muted: true })).toEqual([]);
    expect(trig({ status: 'allowed', muted: true, type: 'connection_rejected' })).toEqual([]);
  });
  it('respects the 24h cooldown on blocked_return', () => {
    const last = base.occurredAt - 86_399;
    expect(trig({ status: 'blocked', lastSentAt: { blocked_return: last } })).toEqual([]);
    const old = base.occurredAt - 86_400;
    expect(trig({ status: 'blocked', lastSentAt: { blocked_return: old } })).toEqual(['blocked_return']);
  });
  it('respects the 1h cooldown on bot_escalation', () => {
    const last = base.occurredAt - 3599;
    expect(trig({ status: 'allowed', isBot: true, lastSentAt: { bot_escalation: last } })).toEqual([]);
    const old = base.occurredAt - 3600;
    expect(trig({ status: 'allowed', isBot: true, lastSentAt: { bot_escalation: old } })).toEqual(['bot_escalation']);
  });
  it('returns nothing for an allowed rejection that matches no trigger', () => {
    expect(trig({ type: 'connection_rejected', status: 'allowed' })).toEqual([]);
  });
});

describe('formatNotification', () => {
  it('builds an embed with a dashboard link', () => {
    const payload = formatNotification({
      trigger: 'first_sighting',
      serverName: 'Survival',
      playerName: 'Steve',
      playerId: 'p1',
      siteUrl: 'https://voz.gg',
      reason: null,
    });
    expect(payload.embeds?.[0]?.url).toBe('https://voz.gg/dashboard/players/p1');
    expect(JSON.stringify(payload)).toContain('Survival');
    expect(JSON.stringify(payload)).toContain('Steve');
  });
});
