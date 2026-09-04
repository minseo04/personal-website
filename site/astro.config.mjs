import { defineConfig } from 'astro/config';

export default defineConfig({
  // TODO: set this to your real domain before deploying -- it is used for
  // canonical URLs and the sitemap.
  site: 'https://example.com',
  output: 'static',
  markdown: { shikiConfig: { themes: { light: 'github-light', dark: 'github-dark' } } },
});
