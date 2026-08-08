import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';

// EDIT THESE before deploying:
// - site: https://<your-github-username>.github.io
// - base: /<repo-name>  (omit entirely if the repo is named <your-username>.github.io)
export default defineConfig({
	site: 'https://vicepalette.dev',
	base: '/',
	integrations: [sitemap()],
});
