import { sqliteTable, text, integer, uniqueIndex, index, primaryKey } from 'drizzle-orm/sqlite-core';

// Placeholder table so migrations and the D1 binding can be exercised end to end.
// Real domain tables (users, servers, ...) are added in later sub-projects.
export const healthchecks = sqliteTable('healthchecks', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  checkedAt: integer('checked_at', { mode: 'number' }).notNull(),
  note: text('note'),
});

export const user = sqliteTable('user', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
  emailVerified: integer('email_verified', { mode: 'boolean' }).notNull().default(false),
  image: text('image'),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),

  // admin plugin fields
  role: text('role').default('user'),
  banned: integer('banned', { mode: 'boolean' }),
  banReason: text('ban_reason'),
  banExpires: integer('ban_expires', { mode: 'timestamp' }),

  // custom profile/link fields (server-populated except displayName/bio)
  displayName: text('display_name'),
  bio: text('bio'),
  minecraftUuid: text('minecraft_uuid').unique(),
  minecraftName: text('minecraft_name'),
  steamId64: text('steam_id_64').unique(),
  steamPersona: text('steam_persona'),
  steamAvatar: text('steam_avatar'),
  theme: text('theme'),
});

export const session = sqliteTable('session', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  token: text('token').notNull().unique(),
  expiresAt: integer('expires_at', { mode: 'timestamp' }).notNull(),
  ipAddress: text('ip_address'),
  userAgent: text('user_agent'),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
});

export const account = sqliteTable('account', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  accountId: text('account_id').notNull(),
  providerId: text('provider_id').notNull(),
  accessToken: text('access_token'),
  refreshToken: text('refresh_token'),
  accessTokenExpiresAt: integer('access_token_expires_at', { mode: 'timestamp' }),
  refreshTokenExpiresAt: integer('refresh_token_expires_at', { mode: 'timestamp' }),
  scope: text('scope'),
  idToken: text('id_token'),
  password: text('password'),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
});

export const verification = sqliteTable('verification', {
  id: text('id').primaryKey(),
  identifier: text('identifier').notNull(),
  value: text('value').notNull(),
  expiresAt: integer('expires_at', { mode: 'timestamp' }).notNull(),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
});

export const UPDATE_SOURCES = ['none', 'vanilla', 'forge', 'neoforge', 'fabric', 'modpack'] as const;
export type UpdateSource = (typeof UPDATE_SOURCES)[number];

export const MODPACK_PROVIDERS = ['modrinth', 'curseforge', 'ftb', 'packwiz'] as const;
export type ModpackProvider = (typeof MODPACK_PROVIDERS)[number];

export const UPDATE_POLICIES = ['notify', 'approve', 'auto'] as const;
export type UpdatePolicy = (typeof UPDATE_POLICIES)[number];

export const GAME_TYPES = [
  'minecraft-java',
  'minecraft-bedrock',
  'source',
  'generic-tcp',
  'unknown',
] as const;

export type GameType = (typeof GAME_TYPES)[number];

// Per-game-type defaults for the agent-host fields. The OS account a game server
// runs under (and therefore its log location) is game-type specific; these are
// editable suggestions, not enforced values. Consumed by the server form and by
// buildProvisioning when a per-server value is absent.
export const GAME_TYPE_DEFAULTS: Record<GameType, { gameServerUser?: string; logPath?: string }> = {
  'minecraft-java': { gameServerUser: 'minecraft', logPath: '/home/minecraft/logs' },
  'minecraft-bedrock': { gameServerUser: 'minecraft', logPath: '/home/minecraft/logs' },
  source: {},
  'generic-tcp': {},
  unknown: {},
};

export const servers = sqliteTable('servers', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  gameType: text('game_type').notNull().$type<GameType>(),
  host: text('host').notNull(),
  port: integer('port').notNull(),
  description: text('description'),
  // Agent-host provisioning (install-time only; never used by the runtime probe).
  // All nullable. buildProvisioning resolves a null: run-as user/group default to
  // 'voz-gg'; game-server user / log path fall back to GAME_TYPE_DEFAULTS.
  runAsUser: text('run_as_user'),
  runAsGroup: text('run_as_group'),
  gameServerUser: text('game_server_user'),
  logPath: text('log_path'),
  monitorEnabled: integer('monitor_enabled', { mode: 'boolean' }),
  logParserEnabled: integer('log_parser_enabled', { mode: 'boolean' }),
  // Server control (systemd lifecycle + RCON). slug is the immutable unit-name
  // key (voz-gg-<slug>.service), set once at create from the name. restartSchedule
  // is a UTC "HH:MM" or null. serverUser reuses gameServerUser above.
  slug: text('slug'),
  serverControlEnabled: integer('server_control_enabled', { mode: 'boolean' }),
  serverWorkingDir: text('server_working_dir'),
  startCommand: text('start_command'),
  restartSchedule: text('restart_schedule'),
  discordWebhookUrl: text('discord_webhook_url'),
  updateSource: text('update_source').$type<UpdateSource>(),
  modpackProvider: text('modpack_provider').$type<ModpackProvider>(),
  modpackId: text('modpack_id'),
  updateVersionLine: text('update_version_line'),
  updateChannel: text('update_channel'),
  pinnedVersion: text('pinned_version'),
  updatePolicy: text('update_policy').$type<UpdatePolicy>(),
  currentVersion: text('current_version'),
  createdBy: text('created_by').notNull().references(() => user.id),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
});

export type Server = typeof servers.$inferSelect;

export const serverStatus = sqliteTable('server_status', {
  serverId: text('server_id')
    .primaryKey()
    .references(() => servers.id, { onDelete: 'cascade' }),
  status: text('status').notNull(), // 'online' | 'offline' | 'unknown'
  players: integer('players'),
  maxPlayers: integer('max_players'),
  version: text('version'),
  latencyMs: integer('latency_ms'),
  checkedAt: integer('checked_at', { mode: 'timestamp' }).notNull(),
});

export const serverUpdateState = sqliteTable('server_update_state', {
  serverId: text('server_id')
    .primaryKey()
    .references(() => servers.id, { onDelete: 'cascade' }),
  availableVersion: text('available_version'),
  availablePublishedAt: integer('available_published_at', { mode: 'timestamp' }),
  checkedAt: integer('checked_at', { mode: 'timestamp' }),
  lastError: text('last_error'),
  notifiedVersion: text('notified_version'),
});

export const serverAgent = sqliteTable('server_agent', {
  serverId: text('server_id')
    .primaryKey()
    .references(() => servers.id, { onDelete: 'cascade' }),
  enrollmentTokenHash: text('enrollment_token_hash'),
  agentTokenHash: text('agent_token_hash'),
  enrolledAt: integer('enrolled_at', { mode: 'timestamp' }),
  lastSeenAt: integer('last_seen_at', { mode: 'timestamp' }),
});

export const INVITE_REQUEST_STATUSES = ['pending', 'approved', 'denied'] as const;

export type InviteRequestStatus = (typeof INVITE_REQUEST_STATUSES)[number];

export const inviteRequest = sqliteTable('invite_request', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  discordName: text('discord_name').notNull(),
  email: text('email').notNull(),
  status: text('status').notNull().$type<InviteRequestStatus>().default('pending'),
  denyReason: text('deny_reason'),
  reviewedBy: text('reviewed_by').references(() => user.id),
  reviewedAt: integer('reviewed_at', { mode: 'timestamp' }),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
});

export const ADMIN_AUDIT_ACTIONS = [
  'ban',
  'unban',
  'set-role',
  'delete',
  'revoke-sessions',
  'transfer-ownership',
] as const;

export type AdminAuditAction = (typeof ADMIN_AUDIT_ACTIONS)[number];

// Immutable history of admin actions. actorId/targetUserId are plain columns (no
// FK cascade) so entries survive deletion of either user — the log must outlive
// the accounts it references.
export const adminAuditLog = sqliteTable('admin_audit_log', {
  id: text('id').primaryKey(),
  actorId: text('actor_id').notNull(),
  action: text('action').notNull().$type<AdminAuditAction>(),
  targetUserId: text('target_user_id').notNull(),
  details: text('details'),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
});

export const PRESENCE_EVENT_TYPES = [
  'join',
  'leave',
  'connection_rejected',
  'server_start',
  'server_stop',
] as const;

export type PresenceEventType = (typeof PRESENCE_EVENT_TYPES)[number];

export const PLAYER_IDENTITY_KINDS = ['minecraft', 'steam', 'discord'] as const;

export type PlayerIdentityKind = (typeof PLAYER_IDENTITY_KINDS)[number];

export const PLAYER_STATUSES = ['new', 'allowed', 'blocked'] as const;

export type PlayerStatus = (typeof PLAYER_STATUSES)[number];

// Raw, append-only event log. Sessions/playtime are derived at read time.
// `dedupeKey` is a deterministic NOT NULL key computed at ingest: a plain
// composite UNIQUE cannot be used because SQLite treats a NULL identity_key
// (lifecycle events) as distinct, so re-backfilled lifecycle lines would never
// dedupe.
export const presenceEvents = sqliteTable('presence_events', {
  id: text('id').primaryKey(),
  serverId: text('server_id')
    .notNull()
    .references(() => servers.id, { onDelete: 'cascade' }),
  type: text('type').notNull().$type<PresenceEventType>(),
  identityKind: text('identity_kind').$type<PlayerIdentityKind>(),
  identityKey: text('identity_key'),
  playerName: text('player_name'),
  ip: text('ip'),
  reason: text('reason'),
  occurredAt: integer('occurred_at', { mode: 'timestamp' }).notNull(),
  dedupeKey: text('dedupe_key').notNull().unique(),
}, (table) => [
  index('presence_events_server_id_idx').on(table.serverId),
  index('presence_events_server_id_identity_key_idx').on(table.serverId, table.identityKey),
]);

// A unified person across game identities. displayName/notes/userId are
// populated/edited in later sub-projects; auto-link sets userId here.
export const player = sqliteTable('player', {
  id: text('id').primaryKey(),
  displayName: text('display_name'),
  userId: text('user_id').references(() => user.id, { onDelete: 'set null' }),
  notes: text('notes'),
  status: text('status').notNull().$type<PlayerStatus>().default('new'),
  isBot: integer('is_bot', { mode: 'boolean' }).notNull().default(false),
  muted: integer('muted', { mode: 'boolean' }).notNull().default(false),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
}, (table) => [index('player_user_id_idx').on(table.userId)]);

// One row per game identity; many per player.
export const playerIdentity = sqliteTable(
  'player_identity',
  {
    id: text('id').primaryKey(),
    playerId: text('player_id')
      .notNull()
      .references(() => player.id, { onDelete: 'cascade' }),
    kind: text('kind').notNull().$type<PlayerIdentityKind>(),
    identityKey: text('identity_key').notNull(),
    displayName: text('display_name'),
    createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
  },
  (table) => [uniqueIndex('player_identity_kind_key_unq').on(table.kind, table.identityKey)],
);

// Freeform, operator-defined tags. Named group_tag because `group` is a SQLite
// reserved word. Names are unique (case-insensitive match happens in app code).
export const groupTag = sqliteTable(
  'group_tag',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
  },
  (table) => [uniqueIndex('group_tag_name_unq').on(table.name)],
);

// Junction table: cascades on both sides so removing a player or a tag prunes
// its memberships without orphaned rows.
export const playerGroupTag = sqliteTable(
  'player_group_tag',
  {
    playerId: text('player_id')
      .notNull()
      .references(() => player.id, { onDelete: 'cascade' }),
    groupTagId: text('group_tag_id')
      .notNull()
      .references(() => groupTag.id, { onDelete: 'cascade' }),
  },
  (table) => [primaryKey({ columns: [table.playerId, table.groupTagId] })],
);

export const NOTIFICATION_TRIGGERS = [
  'bot_escalation', 'blocked_return', 'first_sighting', 'new_player_rejection',
] as const;
export type NotificationTrigger = (typeof NOTIFICATION_TRIGGERS)[number];

// Business-level dedup/cooldown + audit for Discord presence notifications.
export const notificationLog = sqliteTable(
  'notification_log',
  {
    id: text('id').primaryKey(),
    serverId: text('server_id')
      .notNull()
      .references(() => servers.id, { onDelete: 'cascade' }),
    identityKind: text('identity_kind').notNull().$type<PlayerIdentityKind>(),
    identityKey: text('identity_key').notNull(),
    trigger: text('trigger').notNull().$type<NotificationTrigger>(),
    occurredAt: integer('occurred_at', { mode: 'timestamp' }).notNull(),
  },
  (table) => [index('notification_log_lookup_idx').on(table.serverId, table.identityKey, table.trigger)],
);
