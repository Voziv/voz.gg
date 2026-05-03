import 'server-only';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import Database from 'better-sqlite3';
import path from 'node:path';
import fs from 'node:fs';
import * as schema from './schema';

declare global {
  var __db__: ReturnType<typeof createClient> | undefined;
}

function resolveDbPath(): string {
  const url = process.env.DATABASE_URL ?? 'file:./data/app.db';
  return url.startsWith('file:') ? url.slice('file:'.length) : url;
}

function createClient() {
  const dbPath = resolveDbPath();
  const dir = path.dirname(dbPath);
  fs.mkdirSync(dir, { recursive: true });

  const sqlite = new Database(dbPath);
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('foreign_keys = ON');

  const db = drizzle(sqlite, { schema });

  const migrationsFolder = path.join(process.cwd(), 'src/db/migrations');
  if (fs.existsSync(migrationsFolder)) {
    migrate(db, { migrationsFolder });
  }

  return db;
}

export const db = globalThis.__db__ ?? createClient();
if (process.env.NODE_ENV !== 'production') globalThis.__db__ = db;
