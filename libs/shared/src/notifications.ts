import type { PlayerIdentityKind, PlayerStatus, NotificationTrigger } from './schema';

export { NOTIFICATION_TRIGGERS } from './schema';
export type { NotificationTrigger } from './schema';

export const COOLDOWN_BOT_ESCALATION = 60 * 60; // 1h
export const COOLDOWN_BLOCKED_RETURN = 24 * 60 * 60; // 24h
export const COOLDOWN_NEW_PLAYER_REJECTION = 24 * 60 * 60; // 24h

export interface EvaluateInput {
  type: 'join' | 'connection_rejected';
  status: PlayerStatus;
  isBot: boolean;
  muted: boolean;
  hasPriorJoin: boolean;
  occurredAt: number;
  lastSentAt: Partial<Record<NotificationTrigger, number>>;
}

export interface PendingNotification {
  trigger: NotificationTrigger;
}

function fire(
  input: EvaluateInput,
  trigger: NotificationTrigger,
  cooldownSeconds: number | null,
): PendingNotification[] {
  const last = input.lastSentAt[trigger];
  if (cooldownSeconds === null) {
    return last == null ? [{ trigger }] : []; // once ever
  }
  return last == null || input.occurredAt - last >= cooldownSeconds ? [{ trigger }] : [];
}

// bot_escalation bypasses the mute guard below — it is an alarm, not a routine notification.
export function evaluateNotifications(input: EvaluateInput): PendingNotification[] {
  if (input.type === 'join' && (input.isBot || input.muted)) {
    return fire(input, 'bot_escalation', COOLDOWN_BOT_ESCALATION);
  }
  if (input.muted) return [];
  if (input.status === 'blocked') {
    return fire(input, 'blocked_return', COOLDOWN_BLOCKED_RETURN);
  }
  if (input.type === 'join' && !input.hasPriorJoin) {
    return fire(input, 'first_sighting', null);
  }
  if (input.type === 'connection_rejected' && input.status === 'new') {
    return fire(input, 'new_player_rejection', COOLDOWN_NEW_PLAYER_REJECTION);
  }
  return [];
}

export interface DiscordEmbed {
  title: string;
  description?: string;
  url?: string;
  color?: number;
  fields?: { name: string; value: string; inline?: boolean }[];
}

export interface DiscordPayload {
  content?: string;
  embeds?: DiscordEmbed[];
}

export interface FormatArgs {
  trigger: NotificationTrigger;
  serverName: string;
  playerName: string;
  playerId: string;
  siteUrl: string;
  reason: string | null;
}

const TRIGGER_TITLE: Record<NotificationTrigger, string> = {
  bot_escalation: '⚠️ Flagged player joined',
  blocked_return: '⛔ Blocked player returned',
  first_sighting: '👋 New player first seen',
  new_player_rejection: '🚪 New player rejected',
};

const TRIGGER_COLOR: Record<NotificationTrigger, number> = {
  bot_escalation: 0xe11d48,
  blocked_return: 0xdc2626,
  first_sighting: 0x16a34a,
  new_player_rejection: 0xd97706,
};

export function formatNotification(args: FormatArgs): DiscordPayload {
  const fields: DiscordEmbed['fields'] = [
    { name: 'Player', value: args.playerName, inline: true },
    { name: 'Server', value: args.serverName, inline: true },
  ];
  if (args.reason) fields.push({ name: 'Reason', value: args.reason });
  return {
    embeds: [
      {
        title: TRIGGER_TITLE[args.trigger],
        url: `${args.siteUrl}/dashboard/players/${args.playerId}`,
        color: TRIGGER_COLOR[args.trigger],
        fields,
      },
    ],
  };
}

export interface NotifyMessage {
  serverId: string;
  type: 'join' | 'connection_rejected';
  identityKind: PlayerIdentityKind;
  identityKey: string;
  playerName: string | null;
  reason: string | null;
  occurredAt: number; // epoch seconds
}

export interface NotificationDao {
  loadPlayer(kind: PlayerIdentityKind, key: string): Promise<{
    id: string; displayName: string | null; status: PlayerStatus; isBot: boolean; muted: boolean;
  } | null>;
  loadServer(serverId: string): Promise<{ name: string; discordWebhookUrl: string | null } | null>;
  lastSentByTrigger(serverId: string, identityKey: string): Promise<Partial<Record<NotificationTrigger, number>>>;
  hasPriorJoin(serverId: string, identityKey: string, beforeEpochSeconds: number): Promise<boolean>;
  recordNotification(row: {
    serverId: string; identityKind: PlayerIdentityKind; identityKey: string;
    trigger: NotificationTrigger; occurredAt: number;
  }): Promise<void>;
}

export type DiscordPost = (url: string, payload: DiscordPayload) => Promise<{ status: number }>;

// Processes one queue message. Throws on a retryable failure (5xx / network) so the
// queue redelivers; returns normally (ack) on success, no-op, or a 4xx drop.
export async function handleNotificationMessage(
  dao: NotificationDao,
  post: DiscordPost,
  msg: NotifyMessage,
  siteUrl: string,
): Promise<void> {
  const player = await dao.loadPlayer(msg.identityKind, msg.identityKey);
  if (!player) return;

  const server = await dao.loadServer(msg.serverId);
  if (!server || !server.discordWebhookUrl) return;

  const lastSentAt = await dao.lastSentByTrigger(msg.serverId, msg.identityKey);
  const hasPriorJoin =
    msg.type === 'join' ? await dao.hasPriorJoin(msg.serverId, msg.identityKey, msg.occurredAt) : true;

  const pending = evaluateNotifications({
    type: msg.type,
    status: player.status,
    isBot: player.isBot,
    muted: player.muted,
    hasPriorJoin,
    occurredAt: msg.occurredAt,
    lastSentAt,
  });
  if (pending.length === 0) return;

  const { trigger } = pending[0];
  const payload = formatNotification({
    trigger,
    serverName: server.name,
    playerName: msg.playerName ?? player.displayName ?? msg.identityKey,
    playerId: player.id,
    siteUrl,
    reason: msg.reason,
  });

  const { status } = await post(server.discordWebhookUrl, payload);
  if (status >= 200 && status < 300) {
    // The Discord send already happened; a failed audit write must not propagate,
    // or the queue would retry and re-POST the same notification.
    try {
      await dao.recordNotification({
        serverId: msg.serverId,
        identityKind: msg.identityKind,
        identityKey: msg.identityKey,
        trigger,
        occurredAt: msg.occurredAt,
      });
    } catch (err) {
      console.warn(`Discord notification sent for ${msg.serverId} but recording the log failed:`, err);
    }
    return;
  }
  // 5xx and 429 (rate limited) are transient — throw so the queue retries.
  if (status >= 500 || status === 429) {
    throw new Error(`Discord webhook returned ${status}`);
  }
  // Other 4xx: bad/removed webhook — drop without retry.
  console.warn(`Discord webhook ${msg.serverId} returned ${status}; dropping notification.`);
}
