import { defineConfig } from 'astro/config';

export default defineConfig({
  // Canonical URLs. Change this the day you point a custom domain here --
  // leaving it on the vercel.app address would tell search engines your
  // content lives at the old URL.
  site: 'https://personal-website-minseo04.vercel.app',
  output: 'static',
  markdown: { shikiConfig: { themes: { light: 'github-light', dark: 'github-dark' } } },
});
