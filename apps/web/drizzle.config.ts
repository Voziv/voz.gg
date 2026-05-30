import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  schema: '../../libs/shared/src/schema.ts',
  out: './drizzle/migrations',
  dialect: 'sqlite',
});
