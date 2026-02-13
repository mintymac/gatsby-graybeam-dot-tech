import { defineConfig } from "astro/config";
import tailwind from "@astrojs/tailwind";
import sitemap from "@astrojs/sitemap";
import pagefind from "astro-pagefind";
import remarkGemoji from "remark-gemoji";

export default defineConfig({
  site: "https://www.graybeam.tech",
  output: "static",
  integrations: [tailwind(), sitemap(), pagefind()],
  markdown: {
    remarkPlugins: [remarkGemoji],
    shikiConfig: {
      theme: "one-dark-pro",
    },
  },
});
