// @ts-check
import { defineConfig, sessionDrivers } from 'astro/config';
import tailwindcss from '@tailwindcss/vite';
import sitemap from '@astrojs/sitemap';
import cloudflare from '@astrojs/cloudflare';

export default defineConfig({
  // Astro 6: 'static' is the default and supports on-demand routes via
  // `export const prerender = false` (the /api/* endpoints).
  adapter: cloudflare({
    // Plain <img> tags everywhere — no Astro image optimization, so skip the
    // auto-provisioned Cloudflare Images binding.
    imageService: 'passthrough',
  }),
  // PG Hunter doesn't use Astro sessions — a no-op driver keeps the adapter
  // from auto-provisioning a KV namespace (see /ai/MASTER_ARCHITECTURE.md).
  // (Astro 6 rejects `session: false`; upgrade to Astro 7 + adapter 14 to
  // drop the driver entirely.)
  session: {
    driver: sessionDrivers.lruCache(),
  },
  site: 'https://pghunter.in',
  integrations: [sitemap()],
  vite: {
    plugins: [tailwindcss()],
  },
});
