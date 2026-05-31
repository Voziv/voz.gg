import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';

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
  minecraftUuid: text('minecraft_uuid'),
  minecraftName: text('minecraft_name'),
  steamId64: text('steam_id_64').unique(),
  steamPersona: text('steam_persona'),
  steamAvatar: text('steam_avatar'),
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

export const GAME_TYPES = [
  'minecraft-java',
  'minecraft-bedrock',
  'source',
  'generic-tcp',
  'unknown',
] as const;

export type GameType = (typeof GAME_TYPES)[number];

export const servers = sqliteTable('servers', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  gameType: text('game_type').notNull().$type<GameType>(),
  host: text('host').notNull(),
  port: integer('port').notNull(),
  description: text('description'),
  createdBy: text('created_by').notNull().references(() => user.id),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
});
