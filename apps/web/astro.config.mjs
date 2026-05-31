// @ts-check
import { defineConfig } from 'astro/config';
import cloudflare from '@astrojs/cloudflare';
import react from '@astrojs/react';
import tailwindcss from '@tailwindcss/vite';

// @astrojs/cloudflare 13 integrates @cloudflare/vite-plugin, which always
// provides local bindings during `astro dev`. The old `platformProxy` option
// was removed. Bindings from wrangler.toml are accessed via
// `import { env } from 'cloudflare:workers'` — not `locals.runtime.env`.
export default defineConfig({
  output: 'server',
  adapter: cloudflare(),
  integrations: [react()],
  vite: {
    plugins: [tailwindcss()],
  },
});
