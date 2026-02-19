---
title: "Stop Generating PDFs: The Format Is Broken and You Have Better Options"
category: "Engineering"
author: McHughson Chambers
date: 2026-02-19
---

This morning, a PDF export failed in production. The error was `enoent` — the HTML-to-PDF tool wasn't installed on the server. A two-minute fix. But it made me ask a question I should have asked months ago: **why are we generating PDFs at all?**

The answer, when I was honest about it, was: because that's what everyone does. Not because it was the right format. Not because our users needed it. Because "export as PDF" is the default checkbox on every feature spec, and nobody questions it.

I think it's time to question it.

## PDF Is a Page Description Language

PDF descended from PostScript, which Adobe created in 1982 to describe ink placement on paper. The core abstraction is: *this glyph at coordinates (142.3, 891.7) on a page that is exactly 612 x 792 points.*

That made perfect sense for printers. It makes almost no sense for digital documents.

When you "generate a PDF" from a web application, here's what actually happens: a tool takes your fluid, responsive HTML — content designed to reflow across screen sizes — and forces it into fixed-dimension pages with absolute positioning. Every HTML-to-PDF tool is essentially a hack that translates between two incompatible paradigms:

- **HTML**: "Here's content in order. Let it flow."
- **PDF**: "Here's where every pixel goes on this 8.5×11 inch rectangle."

## Every Tool Is the Same Hack

The tooling landscape makes this obvious. Every popular approach does the same thing — run a rendering engine, then serialize the output:

**WeasyPrint** reimplements a CSS subset in Python and renders to Cairo. It's a mini browser that outputs PostScript coordinates instead of pixels.

**Chromic PDF** (Elixir) and **Puppeteer/Playwright** (Node) bundle headless Chrome — a 200MB+ dependency — to render your HTML in an actual browser, then call the browser's print function. You're shipping Chrome on your server to generate documents.

**wkhtmltopdf** did the same thing with a deprecated QtWebKit fork. It's abandoned now because maintaining a private browser engine isn't a business anyone wants to be in.

**Pure PDF libraries** (in any language) make you manually place text and rectangles at x,y coordinates. You're writing PostScript with extra steps.

None of these tools are bad. The engineers who built them are solving a genuinely hard problem. But the problem is hard because *it shouldn't exist.* We're translating between two paradigms that don't share a common model.

## The Real Cost

The hack has real consequences:

**Server dependencies.** WeasyPrint needs Python, pango, cairo, and gdk-pixbuf. Chromic PDF needs Chrome. On a minimal production server, your PDF generation dependency tree may be heavier than your application.

**Rendering inconsistencies.** CSS support varies wildly between tools. Your PDF will look different depending on which tool generated it. Page breaks will land in wrong places. Flexbox might not work. Grid probably won't.

**Maintenance burden.** Every major version bump of these tools changes rendering behavior. Tests that assert on PDF content are fragile. The tool you chose today may be abandoned tomorrow (see: wkhtmltopdf).

**Performance.** Spinning up a headless browser or a Cairo rendering pipeline to generate a document is orders of magnitude slower than serving HTML. For a brand book or a report, you're adding seconds of latency for a worse result.

## When PDF Is Actually Right

I'm not arguing PDF should never be used. There are domains where it's the correct format:

**Legal and regulatory compliance.** Courts, licensing boards, and government agencies expect PDF. PDF/A is a recognized archival standard. Digital signatures on PDFs have legal standing in most jurisdictions.

**Medical credentialing.** Hospitals and insurance companies have workflows built around PDF attachments. A credential packet needs to render identically on every system that touches it. The fixed-layout constraint is a feature here, not a bug.

**Print production.** If you're sending files to a printer, PDF is the lingua franca. Color profiles, bleed marks, crop marks — the print world is built on PDF and PostScript.

The common thread: **the recipient demands PDF.** These aren't cases where you're choosing PDF — you're conforming to an institutional requirement. That's legitimate.

Even in these cases, the generation approach matters. If you must produce PDFs, use a tool designed for structured documents — [Typst](https://typst.app/) is excellent — rather than trying to render HTML and serialize it. You'll get better output with less pain.

## What to Use Instead

For everything that doesn't require institutional PDF delivery, you have better options:

### Shareable HTML pages

A well-designed HTML page with `@media print` CSS rules produces a better "PDF" than any generation tool — because the user's browser is the best HTML renderer available. Ctrl+P in Chrome does exactly what Chromic PDF does, except it's free, maintained by Google, always up to date, and the user controls the output.

We switched our brand book export from generated PDF to a shareable HTML page. It loads instantly, looks correct on every device, and users who need a PDF can print to PDF from their browser. The result is better than what WeasyPrint produced.

### Downloadable asset packages

For design systems, the useful deliverable isn't a PDF — it's the actual assets. Color tokens as JSON. Logo files as SVG. Typography specs as CSS custom properties. A ZIP with these files plus an HTML index page gives designers what they actually need, not a static image of what they need.

### Native browser print

If your content needs to be printable, invest in `@media print` CSS instead of a generation pipeline. You're writing CSS either way — the question is whether to maintain CSS for a production browser or CSS for a subset rendering engine. The browser has better support, better debugging tools, and your users already have it installed.

## The Decision Framework

Before adding PDF generation to your application:

1. **Does the recipient require PDF?** (Legal, regulatory, institutional workflows.) If yes, use a purpose-built tool like Typst, not HTML-to-PDF.
2. **Does the user need to print it?** Serve HTML with good print CSS. Let the browser handle conversion.
3. **Does the user need to share it?** Serve a shareable URL. It's more useful than a static file — it can be updated, it's searchable, and it doesn't require downloading.
4. **Does the user need the data?** Export as JSON, CSV, or a ZIP of actual assets. A PDF containing a color value is less useful than a JSON file containing that color value.

The answer is almost never "generate a PDF from HTML." We've been doing it out of habit, not necessity.

---

The `enoent` error this morning was a gift. It forced us to ask why we were generating PDFs in the first place. The answer was: we shouldn't have been. The HTML brand book is faster, more flexible, and produces better output. The PDF pipeline was complexity we didn't need solving a problem we didn't have.

Sometimes the best fix for a broken tool is to stop using it.

---

*Built with Elixir, Phoenix LiveView, and a healthy skepticism of formats from 1982.*

**Version**: 1.0
**Classification**: Public
**Timestamp**: 2026-02-19T22:00:00Z
