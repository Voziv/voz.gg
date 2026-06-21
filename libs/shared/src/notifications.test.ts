import { describe, it, expect } from 'vitest';
import { evaluateNotifications, formatNotification, handleNotificationMessage, type EvaluateInput, type NotificationDao, type NotifyMessage, type DiscordPost } from './notifications';

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

const msg: NotifyMessage = {
  serverId: 'srv1', type: 'join', identityKind: 'minecraft', identityKey: 'uuid-1',
  playerName: 'Steve', reason: null, occurredAt: 1_000_000,
};

function fakeNotifyDao(over: Partial<NotificationDao> = {}) {
  const recorded: string[] = [];
  const dao: NotificationDao = {
    async loadPlayer() { return { id: 'p1', displayName: 'Steve', status: 'allowed', isBot: false, muted: false }; },
    async loadServer() { return { name: 'Survival', discordWebhookUrl: 'https://discord.com/api/webhooks/1/abc' }; },
    async lastSentByTrigger() { return {}; },
    async hasPriorJoin() { return false; },
    async recordNotification(r) { recorded.push(r.trigger); },
    ...over,
  };
  return { dao, recorded };
}

describe('handleNotificationMessage', () => {
  it('posts to Discord and records the log on a first sighting', async () => {
    const { dao, recorded } = fakeNotifyDao();
    const posts: string[] = [];
    const post: DiscordPost = async (url) => { posts.push(url); return { status: 204 }; };
    await handleNotificationMessage(dao, post, msg, 'https://voz.gg');
    expect(posts).toEqual(['https://discord.com/api/webhooks/1/abc']);
    expect(recorded).toEqual(['first_sighting']);
  });
  it('no-ops when the server has no webhook url', async () => {
    const { dao, recorded } = fakeNotifyDao({ async loadServer() { return { name: 'S', discordWebhookUrl: null }; } });
    const post: DiscordPost = async () => { throw new Error('should not post'); };
    await handleNotificationMessage(dao, post, msg, 'https://voz.gg');
    expect(recorded).toEqual([]);
  });
  it('no-ops when no trigger fires (suppressed by cooldown)', async () => {
    const { dao, recorded } = fakeNotifyDao({ async lastSentByTrigger() { return { first_sighting: 1 }; } });
    let posted = false;
    const post: DiscordPost = async () => { posted = true; return { status: 204 }; };
    await handleNotificationMessage(dao, post, msg, 'https://voz.gg');
    expect(posted).toBe(false);
    expect(recorded).toEqual([]);
  });
  it('drops on a 4xx without recording (bad webhook)', async () => {
    const { dao, recorded } = fakeNotifyDao();
    const post: DiscordPost = async () => ({ status: 404 });
    await handleNotificationMessage(dao, post, msg, 'https://voz.gg');
    expect(recorded).toEqual([]);
  });
  it('throws on a 5xx so the queue retries', async () => {
    const { dao } = fakeNotifyDao();
    const post: DiscordPost = async () => ({ status: 500 });
    await expect(handleNotificationMessage(dao, post, msg, 'https://voz.gg')).rejects.toThrow();
  });
  it('throws on a 429 so the queue retries (rate limited, not dropped)', async () => {
    const { dao } = fakeNotifyDao();
    const post: DiscordPost = async () => ({ status: 429 });
    await expect(handleNotificationMessage(dao, post, msg, 'https://voz.gg')).rejects.toThrow();
  });
  it('does not propagate a failed audit write (avoids re-sending on retry)', async () => {
    const { dao } = fakeNotifyDao({
      async recordNotification() { throw new Error('transient D1 failure'); },
    });
    const post: DiscordPost = async () => ({ status: 204 });
    await expect(handleNotificationMessage(dao, post, msg, 'https://voz.gg')).resolves.toBeUndefined();
  });
  it('does not post when the player is unknown', async () => {
    const { dao } = fakeNotifyDao({ async loadPlayer() { return null; } });
    let posted = false;
    const post: DiscordPost = async () => { posted = true; return { status: 204 }; };
    await handleNotificationMessage(dao, post, msg, 'https://voz.gg');
    expect(posted).toBe(false);
  });
});
