import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';

export const users = sqliteTable('users', {
  id: text('id').primaryKey(),
  displayName: text('display_name'),
  bio: text('bio'),
  minecraftUuid: text('minecraft_uuid'),
  minecraftName: text('minecraft_name'),
  steamId64: text('steam_id_64').unique(),
  steamPersona: text('steam_persona'),
  steamAvatar: text('steam_avatar'),
  isAdmin: integer('is_admin', { mode: 'boolean' }).notNull().default(false),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
});

export const servers = sqliteTable('servers', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  gameType: text('game_type').notNull(),
  host: text('host').notNull(),
  port: integer('port').notNull(),
  description: text('description'),
  createdBy: text('created_by').references(() => users.id, { onDelete: 'set null' }),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
});

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type Server = typeof servers.$inferSelect;
export type NewServer = typeof servers.$inferInsert;

export const GAME_TYPES = [
  'minecraft-java',
  'minecraft-bedrock',
  'source',
  'generic-tcp',
  'unknown',
] as const;
export type GameType = (typeof GAME_TYPES)[number];
