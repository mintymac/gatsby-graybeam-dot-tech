/** @type {import('tailwindcss').Config} */
export default {
  content: ["./src/**/*.{astro,html,js,jsx,md,mdx,svelte,ts,tsx,vue}"],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        brand: {
          primary: "#7c3cb7",
          "primary-light": "#9b5ac7",
          "primary-dark": "#5c2a8a",
        },
      },
      borderRadius: {
        DEFAULT: "4px",
      },
      fontFamily: {
        sans: ['"Open Sans"', "system-ui", "sans-serif"],
        mono: ['"JetBrains Mono"', "monospace"],
      },
      typography: ({ theme }) => ({
        DEFAULT: {
          css: {
            "--tw-prose-links": theme("colors.brand.primary"),
            a: {
              textDecoration: "underline",
              textUnderlineOffset: "2px",
              "&:hover": {
                color: theme("colors.brand.primary-light"),
              },
            },
            code: {
              fontFamily: theme("fontFamily.mono").join(", "),
            },
          },
        },
        invert: {
          css: {
            "--tw-prose-links": theme("colors.brand.primary-light"),
          },
        },
      }),
    },
  },
  plugins: [require("@tailwindcss/typography")],
};
