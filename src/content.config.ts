import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';

const gallery = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/gallery' }),
  schema: z.object({
    title: z.string(),
    // pipeline is a free-form string on purpose so filters stay in sync
    // with whatever you're actually running (ltx-2.3, krea2, wan-2.2, ...)
    pipeline: z.string(),
    date: z.coerce.date(),
    mediaType: z.enum(['image', 'video']),
    // path under /public, e.g. "/gallery/my-entry/output.mp4"
    src: z.string(),
    // small grid thumbnail (images), e.g. "/gallery/my-entry/thumb.jpg"
    thumb: z.string().optional(),
    // poster frame for video cards/detail view — optional but recommended
    poster: z.string().optional(),
    description: z.string().optional(),
    // free-form key/value pairs: sampler, cfg, steps, seed, model, denoise...
    params: z.record(z.string()).optional(),
    tags: z.array(z.string()).default([]),
    // scheduled release: entry stays hidden until this UTC instant
    publishAt: z.coerce.date().optional(),
    // set to true by the scheduled-release workflow once it has been
    // revealed; purely a marker so the cron doesn't redeploy forever
    published: z.boolean().optional(),
  }),
});

export const collections = { gallery };
