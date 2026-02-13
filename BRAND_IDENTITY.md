# Gray Beam Technology — Brand Identity

## Color System

### Core Palette

| Role | Hex | Usage |
|------|-----|-------|
| Primary | `#7c3cb7` | Main brand color — primary buttons, active states, key accents |
| Primary Light | `#9b5ac7` | Hover/active variant of primary — lighter purple for interactive states |
| Primary Dark | `#5c2a8a` | Pressed/focus variant — deeper purple |

### Backgrounds & Surfaces (Dark Mode)

| Role | Hex | Usage |
|------|-----|-------|
| Background | `#0a0a0c` | Base layer — near-black canvas |
| Surface | `#121215` | Cards, panels — slightly elevated from background |
| Surface Elevated | `#1a1a1f` | Popovers, dropdowns, tooltips |
| Border | `#222332` | Default border color for cards and dividers |

### Backgrounds & Surfaces (Light Mode)

| Role | Hex | Usage |
|------|-----|-------|
| Background | `#ffffff` | Base layer — white canvas |
| Surface | `#f5f5f7` | Cards, panels — slightly elevated from background |
| Surface Elevated | `#ebebef` | Popovers, dropdowns, tooltips |
| Border | `#d0d0d8` | Default border color for cards and dividers |

### Grayscale Range

| Name | Hex | Usage |
|------|-----|-------|
| Near Black | `#121212` | Darkest gray, text on light backgrounds |
| Dark Gray | `#222221` | Secondary text, dark mode surface accents |
| Medium Gray | `#555555` | Muted text, placeholders |
| Light Gray | `#aaaaaa` | Disabled states, subtle borders |
| Pure White | `#ffffff` | Text on dark backgrounds, light mode base |

### Text (Dark Mode)

| Role | Hex | Usage |
|------|-----|-------|
| Text Primary | `#f0f0f2` | Headings and important content |
| Text Secondary | `#a0a0a8` | Body text and descriptions |
| Text Muted | `#606068` | Placeholders, timestamps, tertiary info |
| Text Inverse | `#121215` | Text on primary-colored backgrounds |

### Text (Light Mode)

| Role | Hex | Usage |
|------|-----|-------|
| Text Primary | `#121215` | Headings and important content |
| Text Secondary | `#505058` | Body text and descriptions |
| Text Muted | `#909098` | Placeholders, timestamps, tertiary info |
| Text Inverse | `#f0f0f2` | Text on primary-colored backgrounds |

### Semantic Colors

| Role | Hex | Usage |
|------|-----|-------|
| Success | `#4a8b5c` | Positive states — muted green, fits grayscale+purple palette |
| Warning | `#8b733a` | Caution states — muted amber, desaturated |
| Danger | `#b05050` | Errors, destructive — muted red |
| Info | `#4a6ab5` | Informational — muted blue |

---

## Typography

### Font Choices

| Role | Font | Weight(s) | Why |
|------|------|-----------|-----|
| Headings | Open Sans | Bold (700), Semibold (600) | Clean, professional, geometric undertones |
| Body | Open Sans | Regular (400) | Excellent readability for long-form technical content |
| Data/Mono | JetBrains Mono | Regular (400) | Code blocks, inline code, data displays |

### Size Scale

- **Headings:** Medium and commanding — blog content needs clear hierarchy
- **Body:** 16-18px range — generous for long-form reading
- **Data:** Slightly smaller than body, tabular figures
- **Overall density:** Generous line-height for readability — this is a reading-focused blog

---

## Visual Personality

### Temperature
**Position:** Cool neutral — technical, crystalline, precise

### Shape Language
**Position:** Angular and geometric — 4px border radius, echoing the faceted/crystalline brand motif. NOT bubbly or rounded.

### Density
**Position:** Spacious — blog content needs breathing room

### Tone
**Position:** Austere confidence — research-grade content, quiet mathematical beauty

---

## Component Language

### Geometry (extracted from component sheet v1)

| Element | Radius | Min Height | Border | Padding |
|---------|--------|------------|--------|---------|
| Cards/modals | 4px | — | 1px solid | 20-24px |
| Inputs | 4px | 40px | 1px solid | 8px 12px |
| Buttons | 4px | 40px | 1px solid | 10px 20px |
| Badges | 4px (angular, NOT pill) | 28px | none | 6px 14px |
| Toggles | pill (20px) | 24px | none | — |
| Select/dropdown | 4px | 40px | 1px solid | 8px 12px |
| Textarea | 4px | 80px | 1px solid | 8px 12px |
| Toasts | 4px | 48px | none | 12px 16px |

### Buttons

| Variant | Background | Text | Border | Notes |
|---------|-----------|------|--------|-------|
| Primary | `#7c3cb7` | `#ffffff` | none | Filled, bold weight |
| Secondary | transparent | text color | 1px solid border color | Outlined |
| Ghost | transparent | muted text | none | Text-only, no background |
| Danger | `#b05050` | `#ffffff` | none | Filled red |
| Disabled | `#222332` / `#d0d0d8` | `#606068` / `#909098` | none | Grayed out, no interaction |

### Shadows
- **Depth:** Subtle
- **Style:** Soft diffused — `0 1px 3px rgba(0,0,0,0.1)`
- **Cards:** No shadow, border-only elevation in dark mode; subtle shadow in light mode

### Borders
- **Default weight:** 1px
- **Style:** Hairline and precise
- **Dark mode border:** `#222332`
- **Light mode border:** `#d0d0d8`

### Spacing Rhythm
- **Section gaps:** 24-32px
- **Card internal padding:** 20-24px
- **Element gaps within cards:** 8-12px
- **Table row height:** 36-40px
- **Label-to-input gap:** 4-6px

### Navigation Sidebar
- **Active item:** Purple left border accent + surface background
- **Items:** Icon + label, 40px height, 12px padding
- **Icons:** 20px, muted color, purple when active

### Toasts
- **Success:** Left accent bar in `#4a8b5c`, icon + message
- **Error:** Left accent bar in `#b05050`, icon + message
- **Background:** Surface color, no border

### Data Table
- **Headers:** Bold, uppercase, with sort indicators
- **Rows:** Subtle dividers, 36-40px height
- **Selected row:** Purple accent highlight on background
- **Data font:** JetBrains Mono for IDs and numbers

### Toggle & Slider
- **Toggle ON:** Purple `#7c3cb7` track, white knob
- **Toggle OFF:** Gray track, white knob
- **Slider:** Purple fill from left, gray unfilled, circular thumb

### Design Target
- **Winner:** `design_targets/components/component_sheet_v1.jpg`

---

## Mood & Inspiration

### Reference Products

1. **Astro Starlight docs** — Clean typography, excellent reading experience, great dark mode
2. **Linear** — Precise, modern interface with confident use of color
3. **Bear Blog** — Minimal, content-focused, fast

### Mood Description

A technical blog that respects the reader's intelligence. Clean, fast, and content-first.
The aesthetic is crystalline — faceted geometry, angular shapes, mathematical precision.
Purple (#7c3cb7) is the ONLY chromatic color. Everything else is grayscale.
Dark mode should feel natural and unhurried, like reading in a quiet library.

---

## Dark/Light Mode

- **Stance:** Both from day one
- **Rationale:** Blog readers have strong preferences — support both with proper implementation

---

## Brand Context

- **Company:** Gray Beam Technology
- **Tagline:** "How can we help?"
- **Content tone:** Technical/research — swarm intelligence, biomimetics, AI coordination, constraint-driven development
- **Author:** McHughson Chambers
- **Social links:** GitHub (GrayBeamTechnology), Minds (graybeamtech)
- **Contact:** origin@graybeam.tech

---

## Logo System

### Concept
An **impossible Penrose triangle** (Escher-influenced) rendered as a prism in brand purple (#7c3cb7). White light enters one side; multiple gray beams fan out from the other side, representing the full grayscale spectrum. The "Gray Beam" name is literally visualized — light decomposed into grays through an impossible geometric form.

### Text Treatment
- **All lowercase** — "graybeam" as one word, "technology" below
- **Font:** Geometric/angular sans-serif with cyberpunk influence (sharp terminals, technical feel)
- **Weight contrast:** "graybeam" in bold, "technology" in light/regular

### Variants

| Variant | Usage | Description |
|---------|-------|-------------|
| Full lockup | Headers, splash, marketing | Prism icon + "graybeam" + "technology" horizontal |
| Compact/Icon | Favicons, app icons, small contexts | Prism icon only (with beams at large size, simplified at 16px) |
| Stacked | Square contexts, social avatars | Prism icon above "graybeam" / "technology" |
| Wordmark | Inline, minimal, text-only contexts | "graybeam" + "technology" without icon |

### Color Contexts

| Context | Icon | Text | Background |
|---------|------|------|------------|
| On dark | Purple prism + gray beams on white-to-dark | `#f0f0f2` | `#0a0a0c` |
| On light | Purple prism + gray beams on white-to-dark | `#121215` | `#ffffff` |
| Single color | Current color | Current color | Any |

### Size Behavior
- **64px+:** Full detail — impossible triangle geometry, individual gray beams visible
- **32px:** Simplified — prism shape clear, beams reduced
- **16px (favicon):** Minimal — triangle silhouette only

### Design Target
- **Winner:** `design_targets/logos/logo_system_v7.jpg`
- **Lineage:** v4 beams + v6 Escher triangle + lowercase cyberpunk

---

## Brand Prefix

```
Apply this brand system to the UI design:
- Colors: primary #7c3cb7, primary-light #9b5ac7, primary-dark #5c2a8a, grayscale only (no other chromatic colors)
- Dark mode: bg #0a0a0c, surface #121215, border #222332, text #f0f0f2/#a0a0a8
- Light mode: bg #ffffff, surface #f5f5f7, border #d0d0d8, text #121215/#505058
- Semantic: success #4a8b5c, warning #8b733a, danger #b05050, info #4a6ab5 (all muted/desaturated)
- Typography: headings in Open Sans Bold, body in Open Sans Regular, code in JetBrains Mono
- Shape: 4px radius (angular, geometric), subtle diffused shadows, spacious density
- Mood: crystalline, faceted geometry, austere mathematical precision, research-grade
- Logo: impossible Penrose triangle prism, white light in / gray beams out, all-lowercase "graybeam" in geometric cyberpunk font
```

---

## Revision Log

| Date | Change | Reason |
|------|--------|--------|
| 2026-02-12 | Initial creation | Pre-filled from existing Gatsby site brand knowledge for Astro migration |
| 2026-02-12 | Brand system extracted from v3 | Winning brand board: angular/crystalline aesthetic, grayscale+purple palette |
| 2026-02-12 | Logo system documented from v7 | Impossible Penrose prism + gray beams, all-lowercase cyberpunk typography |
| 2026-02-12 | Component specs extracted from v1 | Full geometry, button, shadow, border, spacing, nav, toast, table, toggle specs |
