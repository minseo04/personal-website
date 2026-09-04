import { defineConfig } from 'astro/config';

export default defineConfig({
  // `site` sets canonical URLs. Left unset on purpose: a wrong value is worse
  // than none, because it points canonical tags at a domain you do not own.
  // After the first Vercel deploy, set it to the URL Vercel gives you, e.g.
  //   site: 'https://personal-website-minseo04.vercel.app',
  // and replace that with your own domain once you have one.
  output: 'static',
  markdown: { shikiConfig: { themes: { light: 'github-light', dark: 'github-dark' } } },
});
