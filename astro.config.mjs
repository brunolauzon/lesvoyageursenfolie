// @ts-check
import { defineConfig } from 'astro/config';

import tailwindcss from '@tailwindcss/vite';
import react from '@astrojs/react';

// On GitHub Actions the repository is known, so Pages URLs work without manual config.
// Locally (or on a custom domain) set SITE_URL / BASE_PATH instead.
const [owner, repo] = (process.env.GITHUB_REPOSITORY ?? '').split('/');
const isUserSite = repo?.toLowerCase() === `${owner}.github.io`.toLowerCase();

// https://astro.build/config
export default defineConfig({
  site: process.env.SITE_URL ?? (owner ? `https://${owner}.github.io` : undefined),
  base: process.env.BASE_PATH ?? (repo && !isUserSite ? `/${repo}` : '/'),
  vite: {
    plugins: [tailwindcss()],
  },
  integrations: [react()],
});
