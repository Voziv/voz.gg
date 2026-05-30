import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';

// Placeholder table so migrations and the D1 binding can be exercised end to end.
// Real domain tables (users, servers, ...) are added in later sub-projects.
export const healthchecks = sqliteTable('healthchecks', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  checkedAt: integer('checked_at', { mode: 'number' }).notNull(),
  note: text('note'),
});
