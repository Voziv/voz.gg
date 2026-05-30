// @ts-check
import { defineConfig } from 'astro/config';
import cloudflare from '@astrojs/cloudflare';
import tailwindcss from '@tailwindcss/vite';

// @astrojs/cloudflare 13 integrates @cloudflare/vite-plugin, which always
// provides local bindings during `astro dev`. The old `platformProxy` option
// was removed; bindings from wrangler.jsonc are available on
// `locals.runtime.env` in dev without extra configuration.
export default defineConfig({
  output: 'server',
  adapter: cloudflare(),
  vite: {
    plugins: [tailwindcss()],
  },
});
