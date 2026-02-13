import { defineCollection, z } from "astro:content";

const blog = defineCollection({
  type: "content",
  schema: z.object({
    title: z.string(),
    category: z.string().optional(),
    cover: z.string().optional(),
    author: z.string().optional(),
    date: z.coerce.date(),
    draft: z.boolean().default(false),
  }),
});

const pages = defineCollection({
  type: "content",
  schema: z.object({
    title: z.string(),
    menuTitle: z.string().optional(),
    order: z.number().optional(),
  }),
});

export const collections = { blog, pages };
