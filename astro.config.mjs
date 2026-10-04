// @ts-check
import { defineConfig, sessionDrivers } from 'astro/config';
import tailwindcss from '@tailwindcss/vite';
import sitemap from '@astrojs/sitemap';
import cloudflare from '@astrojs/cloudflare';
import react from '@astrojs/react';

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
  // React powers shadcn/ui islands (src/components/ui/*); everything else
  // stays server-rendered .astro.
  integrations: [react(), sitemap()],
  vite: {
    plugins: [tailwindcss()],
    // React and sonner were being resolved twice (once pre-bundled for the
    // server bundle, once for the client), which gave the island a second React
    // instance: sonner's <Toaster> then threw "Invalid hook call" during SSR and
    // its toast store never reached the mounted <Toaster> in the browser.
    resolve: {
      dedupe: ['react', 'react-dom', 'sonner'],
    },
    optimizeDeps: {
      include: ['react', 'react-dom', 'sonner'],
    },
    build: {
      // Keep every script an external file under 'self'. Astro decides whether
      // to inline a script with Vite's assetsInlineLimit, and the strict CSP in
      // src/lib/server/securityHeaders.ts has no 'unsafe-inline' for scripts.
      // Without this, the <astro-island> runtime ships as an inline <script>
      // and hydration silently dies under the production CSP.
      assetsInlineLimit: 0,
    },
  },
});
