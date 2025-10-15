# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a Gatsby v2 blog site for Gray Beam Technology based on the HeroBlog starter. It uses React 16.8, styled-jsx for CSS-in-JS, and markdown for content management.

## Development Commands

### Essential Commands
- `npm run develop` - Start development server at http://localhost:8000
- `npm run build` - Build production site to /public directory
- `npm run devhost` - Start dev server on network (192.168.0.112)

### Code Quality
- `npm run lint` - Run ESLint on all JS/JSX files in src/
- `npm run lint-errors` - Show only ESLint errors (quiet mode)
- `npm run format` - Format code with Prettier
- `npm run stylelint` - Lint styled-jsx CSS

### Utilities
- `npm run generate-app-icons` - Generate app icons from source images

## Architecture

### Content Management
Content is organized in markdown files under `/content`:
- **Posts**: `/content/posts/` - Blog posts with filename format `YYYY-MM-DD--slug/index.md`
- **Pages**: `/content/pages/` - Static pages with numeric prefix for ordering (e.g., `1--about/index.md`)
- **Parts**: `/content/parts/` - Reusable content fragments (author bio, footnote)
- **Meta**: `/content/meta/config.js` - Site configuration

### Slug Generation
The site uses a custom slug generation system in `gatsby-node.js:9-36`:
- Extracts date prefix from filenames (before `--` separator)
- Creates clean slugs by removing prefixes
- Pages with numeric prefixes are ordered in menu
- Draft posts (without date prefix) are excluded from production builds

### Page Generation
Three template types in `/src/templates/`:
- **PostTemplate.js** - Individual blog posts with prev/next navigation
- **PageTemplate.js** - Static pages
- **CategoryTemplate.js** - Category archive pages

### Styling System
- **styled-jsx** for component-scoped CSS with PostCSS processing
- **Theme object** generated from `/src/theme/theme.yaml`
- PostCSS plugins: nested, cssnext, media queries, text-remove-gap
- Custom breakpoints: tablet (600px), desktop (1024px)

### Component Structure
Components in `/src/components/` are organized by feature:
- Each component typically has its own directory
- React Context used for theme, screen width, and font loading state
- Main layout wrapper at `/src/layouts/index.js` provides app-wide context

### Data Layer
- GraphQL queries for content and configuration
- Algolia integration for full-text search (configured via `.env`)
- RSS feed generation for blog posts
- Facebook comments integration

### Build Configuration
- **gatsby-node.js** - Custom node APIs for page/slug creation, webpack config
- **gatsby-config.js** - Plugin configuration and site metadata
- **gatsby-browser.js** - Browser APIs
- Draft posts excluded in production (via `ACTIVE_ENV` or `NODE_ENV`)

## Environment Variables

Required in `.env` file (already configured but listed for reference):
- `GOOGLE_ANALYTICS_ID` - Google Analytics tracking
- `ALGOLIA_APP_ID`, `ALGOLIA_SEARCH_ONLY_API_KEY`, `ALGOLIA_ADMIN_API_KEY`, `ALGOLIA_INDEX_NAME` - Search
- `FB_APP_ID` - Facebook comments and sharing

## Key Patterns

### Adding New Blog Posts
Create directory under `/content/posts/` with format `YYYY-MM-DD--slug-name/index.md`. Include frontmatter:
```markdown
---
title: "Post Title"
category: "Category Name"
author: "Author Name"
---
```

### Adding New Pages
Create directory under `/content/pages/` with format `N--page-name/index.md` where N is numeric order. Pages are auto-added to navigation menu.

### Working with Styles
Use styled-jsx within components. Theme variables available via `ThemeContext`. PostCSS syntax supported (nested selectors, cssnext features).

### GraphQL Queries
Component queries use `gatsby` StaticQuery or page queries. Source instance names: "posts", "pages", "parts", "images".
