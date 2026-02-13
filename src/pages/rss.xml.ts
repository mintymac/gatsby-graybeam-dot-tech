import rss from "@astrojs/rss";
import { getCollection } from "astro:content";
import { site } from "../data/site";
import type { APIContext } from "astro";

export async function GET(context: APIContext) {
  const posts = (await getCollection("blog", ({ data }) => !data.draft)).sort(
    (a, b) => b.data.date.valueOf() - a.data.date.valueOf()
  );

  return rss({
    title: site.title,
    description: site.description,
    site: context.site!.toString(),
    items: posts.map((post) => ({
      title: post.data.title,
      pubDate: post.data.date,
      link: `/${post.slug}/`,
      categories: post.data.category ? [post.data.category] : [],
    })),
  });
}
