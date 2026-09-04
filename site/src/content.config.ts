import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';

/** Essays and posts -- things written to be read on their own. */
const writing = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/writing' }),
  schema: z.object({
    title: z.string(),
    date: z.coerce.date(),
    summary: z.string().optional(),
    draft: z.boolean().default(false),
  }),
});

/**
 * The study log: short dated entries about what you are learning right now.
 * Deliberately a separate collection from `writing` -- different intent, so a
 * half-formed note here never has to meet the bar of a finished post.
 */
const studyLog = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/study-log' }),
  schema: z.object({
    title: z.string(),
    date: z.coerce.date(),
    topics: z.array(z.string()).default([]),
    summary: z.string().optional(),
    draft: z.boolean().default(false),
  }),
});

export const collections = { writing, 'study-log': studyLog };
