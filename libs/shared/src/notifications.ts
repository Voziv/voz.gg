import type { PlayerStatus, PlayerIdentityKind, NotificationTrigger } from './schema';

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

// Precedence: first match wins per event. bot_escalation ignores mute (the alarm);
// the other three are suppressed when the player is muted.
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
