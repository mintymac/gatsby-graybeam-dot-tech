---
description: Generate component design system sheets from BRAND_IDENTITY.md
---

## CRITICAL: Model Selection
**NEVER** use `gemini-2.0-flash-exp-image-generation` — it produces garbage text that destroys user trust.
The ONLY model for image generation is `gemini-3-pro-image-preview`.
Do NOT substitute, even if that model returns a 404. Report the error instead.

# /component-sheet — Component Design System Sheet Generator

Generates component design system sheets from your project's `BRAND_IDENTITY.md`. Each sheet is a single image showing all core UI primitives — buttons, cards, forms, tables, badges, toggles, navigation, toasts — rendered in both dark and light mode side by side. Use this during Phase 4 of the branding process (see `methodology/branding-process.md`).

## Invocation

```
/component-sheet [--dir design_targets/components] [--n 3]
```

Examples:
- `/component-sheet`
- `/component-sheet --dir design_targets/components --n 5`
- `/component-sheet --n 2`

## Prerequisites

- `VERTEX_API_KEY` in `.env` (preferred — Vertex AI, no RPD cap)
- Falls back to `GOOGLE_API_KEY` if no Vertex key found
- `BRAND_IDENTITY.md` (or `docs/BRAND_IDENTITY.md`) in the project root

## Related Skills

- `/brand-explore` — Generate brand exploration boards (run first to establish visual direction)
- `/logo-explore` — Generate logo system sheets (run before component sheets)
- `/design-target` — After component system is complete, generate morph design targets
- `/nbp-refine` — Low-level reference-based refinement (used inline during the refinement loop)

---

# EXECUTION INSTRUCTIONS

## Stage 1: Setup

### Step 1.1: Parse Arguments

Extract from `$ARGUMENTS`:
- `DIR` — Output directory (default: `design_targets/components`)
- `N` — Number of variations to generate (default: 3)

Parse flags: `--dir <path>`, `--n <count>`

### Step 1.2: Load Brand Brief

Search for the brand identity document:
1. Check `BRAND_IDENTITY.md` in the project root
2. If not found, check `docs/BRAND_IDENTITY.md`
3. If neither exists, report error and stop:
   ```
   ERROR: No BRAND_IDENTITY.md found.
   Create one at the project root or docs/BRAND_IDENTITY.md with your brand brief
   (color system, typography, visual personality, component language).
   Run /brand-explore first to establish a visual direction.
   ```

Read the file and extract the brand brief. Look for these sections (by heading):
- **Color System** — full palette including dark and light mode colors
- **Typography** — font stack, weights, scale
- **Visual Personality** — tone, shape language, density
- **Component Language** — card style, button style, borders, shadows, spacing
- **Mood / Inspiration** — reference products, aesthetic direction

Combine the extracted content into a `BRAND_BRIEF` string. If specific sections are not found by heading, use the entire file content as the brief.

### Step 1.3: Construct Generation Prompt

Build the image generation prompt by combining the brand brief with component sheet instructions:

```
COMPONENT_PROMPT = """
You are a UI/UX designer creating a comprehensive component design system sheet. Based on the following brand brief, generate a SINGLE image that is a professional component design system reference sheet.

BRAND BRIEF:
{BRAND_BRIEF}

THE SHEET MUST USE A SPLIT-SCREEN LAYOUT:
- LEFT HALF: All components rendered in DARK MODE (using the dark background, surface, and text colors from the brief)
- RIGHT HALF: All components rendered in LIGHT MODE (using the light background, surface, and text colors from the brief)
- Clear "DARK MODE" and "LIGHT MODE" labels at the top of each half

BOTH HALVES MUST INCLUDE ALL OF THE FOLLOWING COMPONENTS:

1. FORM CARD
   - A card containing a mini form with:
     - Text input with label and placeholder text
     - Dropdown/select with label
     - Textarea with label
     - A primary submit button and a secondary cancel button
   - Card should use the brand's card style (border, radius, shadow per the brief)

2. DATA TABLE
   - 4-5 columns, 4-5 rows of sample data
   - Column headers with sort indicator on one column
   - One row highlighted/selected (using brand accent color)
   - Alternating row backgrounds or subtle row dividers
   - Monospace font for data columns if specified in the brief

3. STATUS BADGES
   - At least 4 badge variants: Active/Success, Warning, Danger/Error, Info/Neutral
   - Pill-shaped or matching the brand's badge style
   - Each with an icon + label
   - Use the brand's semantic colors

4. BUTTON ROW
   - Primary button (filled, brand primary color)
   - Secondary button (outlined or muted)
   - Ghost/text button (minimal, text-only)
   - Danger button (destructive action)
   - Disabled button (grayed out, non-interactive)
   - All matching the brand's button style (radius, padding)

5. TOGGLE AND SLIDER
   - A chunky toggle switch in ON and OFF states
   - A horizontal slider/dial with a value indicator
   - Styled to match the brand's control language

6. NAVIGATION SIDEBAR
   - 4-5 navigation items with icons and labels
   - One item in active/selected state (using brand accent)
   - Collapsed/icon-only variant if space allows
   - Matching the brand's nav style

7. TOAST / NOTIFICATION
   - Success toast with icon and message
   - Error toast with icon and message
   - Styled to match brand personality (border, radius, color accents)

Make the sheet visually polished and presentation-ready. Every component should feel like it belongs to the same design system. Use the brand's actual colors, typography, border-radius, and spacing values — not generic defaults. Label each component section clearly.
"""
```

### Step 1.4: Confirm with User

Use `AskUserQuestion`:
```
Question: "Generate {N} component design system sheets from BRAND_IDENTITY.md? (~${N * 0.14:.2f})

Each sheet will show dark mode (left) and light mode (right) with: form card, data table, status badges, button row, toggle/slider, navigation sidebar, and toast notifications."
Header: "Component Sheet"
Options:
- "Yes, generate {N} sheets"
- "Preview prompt first"
- "Cancel"
```

If "Preview prompt first": show the full COMPONENT_PROMPT, let user edit, then proceed.

---

## Stage 2: Generate Component Sheets

### Step 2.1: Create Output Directory

```bash
mkdir -p "$DIR"
```

### Step 2.2: Generate N Variations

**IMPORTANT: Always use Python for API calls.** Use the EXACT same pattern as `/nbp`.

```python
python3 << 'PYEOF'
import base64, json, urllib.request, sys, os, time

# Load API key from .env — prefer VERTEX_API_KEY (no RPD cap), fall back to GOOGLE_API_KEY
api_key = None
api_base = None
for env_path in [".env", "../.env"]:
    if os.path.exists(env_path):
        for line in open(env_path):
            if line.startswith("VERTEX_API_KEY=") and not api_key:
                api_key = line.strip().split("=", 1)[1]
                api_base = "https://aiplatform.googleapis.com/v1/publishers/google/models"
            elif line.startswith("GOOGLE_API_KEY=") and not api_base:
                api_key = line.strip().split("=", 1)[1]
                api_base = "https://generativelanguage.googleapis.com/v1beta/models"
    if api_key:
        break

if not api_key:
    print("ERROR: VERTEX_API_KEY or GOOGLE_API_KEY not found in .env")
    sys.exit(1)

prompt = """$COMPONENT_PROMPT"""
n = $N
output_dir = "$DIR"
prefix = "component_sheet"

url = f"{api_base}/gemini-3-pro-image-preview:generateContent?key={api_key}"

payload = json.dumps({
    "contents": [{"parts": [{"text": prompt}]}],
    "generationConfig": {"responseModalities": ["TEXT", "IMAGE"]}
}).encode()

for i in range(1, n + 1):
    try:
        req = urllib.request.Request(url, data=payload, headers={"Content-Type": "application/json"})
        resp = urllib.request.urlopen(req, timeout=120)
        data = json.loads(resp.read())

        for part in data["candidates"][0]["content"]["parts"]:
            if "inlineData" in part:
                mime = part["inlineData"].get("mimeType", "image/jpeg")
                ext = "jpg" if "jpeg" in mime else "png"
                name = f"{prefix}_v{i}.{ext}"
                path = os.path.join(output_dir, name)
                img_bytes = base64.b64decode(part["inlineData"]["data"])
                with open(path, "wb") as f:
                    f.write(img_bytes)
                print(f"OK: {name} ({len(img_bytes)//1024}K)")
                break
        else:
            print(f"FAILED: v{i} — no image data in response")
            for part in data.get("candidates", [{}])[0].get("content", {}).get("parts", []):
                if "text" in part:
                    print(f"  Response: {part['text'][:200]}")
    except urllib.error.HTTPError as e:
        if e.code == 429:
            print(f"RATE LIMITED: v{i} — waiting 10s and retrying...")
            time.sleep(10)
            try:
                req = urllib.request.Request(url, data=payload, headers={"Content-Type": "application/json"})
                resp = urllib.request.urlopen(req, timeout=120)
                data = json.loads(resp.read())
                for part in data["candidates"][0]["content"]["parts"]:
                    if "inlineData" in part:
                        mime = part["inlineData"].get("mimeType", "image/jpeg")
                        ext = "jpg" if "jpeg" in mime else "png"
                        name = f"{prefix}_v{i}.{ext}"
                        path = os.path.join(output_dir, name)
                        img_bytes = base64.b64decode(part["inlineData"]["data"])
                        with open(path, "wb") as f:
                            f.write(img_bytes)
                        print(f"OK (retry): {name} ({len(img_bytes)//1024}K)")
                        break
                else:
                    print(f"FAILED (retry): v{i} — no image data")
            except Exception as e2:
                print(f"ERROR (retry): v{i} — {e2}")
        else:
            print(f"ERROR: v{i} — {e}")
    except Exception as e:
        print(f"ERROR: v{i} — {e}")
PYEOF
```

### Step 2.3: Present Variations

Use the `Read` tool to display all generated images, labeled clearly. Use `Glob` to find the actual files since the extension may vary:

```
**Component Sheet v1:**
Read: {DIR}/component_sheet_v1.{ext}

**Component Sheet v2:**
Read: {DIR}/component_sheet_v2.{ext}

**Component Sheet v3:**
Read: {DIR}/component_sheet_v3.{ext}

(etc. for N sheets)
```

Report summary: number generated, output directory, filenames.

### Step 2.4: Generate Review Page

Generate an HTML review page so the user can evaluate images in a browser with lightbox zoom. If `tools/make_review.py` exists in the project, use it:

```bash
python3 tools/make_review.py \
  --phase "B4 — COMPONENT DESIGN SYSTEM" \
  --title "Component Sheet" \
  --description "Component design system sheets showing all core UI primitives in both dark and light mode." \
  --dir "$DIR" \
  --prefix component_sheet \
  --n $N
```

If the script doesn't exist, create the review page inline using the brand palette (dark #09090B background, #18181B cards, #3F3F46 borders, violet #7C3AED hover, amber #F59E0B phase label, lightbox with zoom-in/zoom-out).

Open the review page in the browser: `xdg-open "$DIR/review.html"` (Linux) or `open "$DIR/review.html"` (macOS).

---

## Stage 3: Review & Refine Loop

### Step 3.1: Ask User to Pick Base

Use `AskUserQuestion`:
```
Question: "Which component sheet is the strongest starting point?"
Header: "Component Sheet"
Options:
- "v1" with description of its key characteristics
- "v2" with description
- "v3" with description
- (etc. for N sheets)
MultiSelect: false
```

The user may respond with:
- **A pick** — proceed to ask for refinement feedback
- **A pick + feedback** — proceed directly to refinement with their notes
- **"This one is the winner"** — skip refinement, go to Stage 4
- **Detailed feedback only** — infer which they liked most, confirm, then proceed

### Step 3.2: Collect Refinement Feedback

If the user wants refinement and hasn't already provided feedback, use `AskUserQuestion`:
```
Question: "What should be refined in {chosen_version}? Consider:
- Color application — do the brand colors translate well to components?
- Component proportions — are buttons/inputs/cards the right size?
- Dark vs light balance — does each mode feel intentional, not just inverted?
- Missing components — anything you need that isn't shown?
- Density/spacing — too tight or too loose?"
Header: "Refine Component Sheet"
```

### Step 3.3: Generate Refined Variations

Execute the `/nbp-refine` Python reference-image pattern inline (do NOT invoke as a slash command):
- Reference: `{DIR}/{chosen_version}.{ext}`
- Prompt: the user's refinement feedback
- N: 2
- Dir: `$DIR`

Output ancestry-named files: `component_sheet_{parent}_r1.{ext}`, `component_sheet_{parent}_r2.{ext}`

```python
python3 << 'PYEOF'
import base64, json, urllib.request, sys, os, time

# Load API key from .env — prefer VERTEX_API_KEY (no RPD cap), fall back to GOOGLE_API_KEY
api_key = None
api_base = None
for env_path in [".env", "../.env"]:
    if os.path.exists(env_path):
        for line in open(env_path):
            if line.startswith("VERTEX_API_KEY=") and not api_key:
                api_key = line.strip().split("=", 1)[1]
                api_base = "https://aiplatform.googleapis.com/v1/publishers/google/models"
            elif line.startswith("GOOGLE_API_KEY=") and not api_base:
                api_key = line.strip().split("=", 1)[1]
                api_base = "https://generativelanguage.googleapis.com/v1beta/models"
    if api_key:
        break

if not api_key:
    print("ERROR: VERTEX_API_KEY or GOOGLE_API_KEY not found in .env")
    sys.exit(1)

ref_path = "$REFERENCE_PATH"
refinement_prompt = """$REFINEMENT_PROMPT"""
n = $REFINE_N
output_dir = "$DIR"

# Read reference image and detect mime type
ref_ext = os.path.splitext(ref_path)[1].lower()
ref_mime = "image/jpeg" if ref_ext in [".jpg", ".jpeg"] else "image/png"
with open(ref_path, "rb") as f:
    img_b64 = base64.b64encode(f.read()).decode()

# Compute ancestry-based output names
ref_basename = os.path.splitext(os.path.basename(ref_path))[0]

url = f"{api_base}/gemini-3-pro-image-preview:generateContent?key={api_key}"

payload = json.dumps({
    "contents": [{"parts": [
        {"inlineData": {"mimeType": ref_mime, "data": img_b64}},
        {"text": refinement_prompt}
    ]}],
    "generationConfig": {"responseModalities": ["TEXT", "IMAGE"]}
}).encode()

for i in range(1, n + 1):
    try:
        req = urllib.request.Request(url, data=payload, headers={"Content-Type": "application/json"})
        resp = urllib.request.urlopen(req, timeout=120)
        data = json.loads(resp.read())

        for part in data["candidates"][0]["content"]["parts"]:
            if "inlineData" in part:
                mime = part["inlineData"].get("mimeType", "image/jpeg")
                ext = "jpg" if "jpeg" in mime else "png"
                name = f"{ref_basename}_r{i}.{ext}"
                path = os.path.join(output_dir, name)
                img_bytes = base64.b64decode(part["inlineData"]["data"])
                with open(path, "wb") as f:
                    f.write(img_bytes)
                print(f"OK: {name} ({len(img_bytes)//1024}K)")
                break
        else:
            print(f"FAILED: r{i} — no image data in response")
    except urllib.error.HTTPError as e:
        if e.code == 429:
            print(f"RATE LIMITED: r{i} — waiting 10s and retrying...")
            time.sleep(10)
            try:
                req = urllib.request.Request(url, data=payload, headers={"Content-Type": "application/json"})
                resp = urllib.request.urlopen(req, timeout=120)
                data = json.loads(resp.read())
                for part in data["candidates"][0]["content"]["parts"]:
                    if "inlineData" in part:
                        mime = part["inlineData"].get("mimeType", "image/jpeg")
                        ext = "jpg" if "jpeg" in mime else "png"
                        name = f"{ref_basename}_r{i}.{ext}"
                        path = os.path.join(output_dir, name)
                        img_bytes = base64.b64decode(part["inlineData"]["data"])
                        with open(path, "wb") as f:
                            f.write(img_bytes)
                        print(f"OK (retry): {name} ({len(img_bytes)//1024}K)")
                        break
                else:
                    print(f"FAILED (retry): r{i} — no image data")
            except Exception as e2:
                print(f"ERROR (retry): r{i} — {e2}")
        else:
            print(f"ERROR: r{i} — {e}")
    except Exception as e:
        print(f"ERROR: r{i} — {e}")
PYEOF
```

### Step 3.4: Present Refined Variations

Display both refined images with ancestry labels:
```
**{parent} > r1:**
Read: {DIR}/{parent}_r1.{ext}

**{parent} > r2:**
Read: {DIR}/{parent}_r2.{ext}
```

### Step 3.5: Decision Point

Use `AskUserQuestion`:
```
Question: "Pick the winner or refine further?"
Header: "Decision"
Options:
- "r1 is the winner"
- "r2 is the winner"
- "One more round"
MultiSelect: false
```

**If "One more round":** Go back to Step 3.2, using the chosen refinement as the new reference. The ancestry chain grows (e.g., `component_sheet_v2_r1_r1.{ext}`).

**If winner declared:** Proceed to Stage 4.

---

## Stage 4: Extract Component Specs

### Step 4.1: Declare Winner

Report to the user:
```
COMPONENT SHEET WINNER SELECTED

Winner: {winning_filename}
Lineage: {ancestry chain, e.g., "v2 > r1"}
Location: {DIR}/{winning_filename}
```

### Step 4.2: Guide Spec Extraction

Display the winning image one more time for reference, then use `AskUserQuestion`:
```
Question: "Now let's extract concrete component specs from the winning sheet. These values will go into your CSS custom properties and Tailwind config.

I'll help you document specs for each component category. Ready?"
Header: "Extract Component Specs"
Options:
- "Yes, let's extract specs"
- "I'll do it manually later"
```

If the user wants to proceed, guide them through extracting specs by category:

**Geometry:**
```
From the winning component sheet, what are the values for:

| Element | Border Radius | Min Height | Border Width | Padding |
|---------|---------------|------------|--------------|---------|
| Cards/modals | ___px | — | ___px | ___px |
| Inputs/buttons | ___px | ___px | ___px | ___px |
| Badges | pill / ___px | ___px | — | ___px |
| Toggles | pill | ___px | — | — |
| Touch targets | — | 44px min | — | — |
```

**Spacing:**
```
What spacing rhythm matches the sheet?
- Section gaps: ___px
- Card internal padding: ___px
- Element gaps within cards: ___px
- Table row height: ___px
```

**Shadows & Effects:**
```
What shadow/depth treatment is used?
- Card shadow: [none / subtle / medium / dramatic]
- Specific CSS shadow value (if visible): ___
- Border treatment: [hairline / prominent / none]
```

### Step 4.3: Update Brand Docs

After collecting specs, update `BRAND_IDENTITY.md`. Look for a section headed `## Component Language` or `## Component Patterns`. If it doesn't exist, add it after the Typography section.

Update with the extracted values in a table format:

```markdown
## Component Patterns

### Geometry
| Element | Radius | Min Height | Border | Padding |
|---------|--------|------------|--------|---------|
| Cards/modals | {radius}px | — | {border}px | {padding}px |
| Inputs/buttons | {radius}px | {height}px | {border}px | {padding}px |
| Badges | pill | {height}px | — | {padding}px |
| Toggles | pill | {height}px | — | — |

### Buttons
| Variant | Dark Mode | Light Mode |
|---------|-----------|------------|
| Primary | {dark primary style} | {light primary style} |
| Secondary | {dark secondary style} | {light secondary style} |
| Ghost | {dark ghost style} | {light ghost style} |
| Danger | {dark danger style} | {light danger style} |
| Disabled | {dark disabled style} | {light disabled style} |
```

Also update the Design Targets section with a reference to the winning component sheet file.

### Step 4.4: Final Report

```
COMPONENT SYSTEM DOCUMENTED

Winner: {winning_filename}
Brand Docs: Updated BRAND_IDENTITY.md with component specs
Design Target: {DIR}/{winning_filename}

Extracted specs:
- Geometry: {radius}, {heights}, {borders}, {padding}
- Spacing: {section gaps}, {card padding}, {element gaps}
- Shadows: {shadow style}

Next steps:
- Review the updated BRAND_IDENTITY.md for completeness
- Run /design-target to generate morph design targets (brand system is now complete)
- The brand prefix and component specs will be automatically used in all design targets
```

---

# ERROR HANDLING

## BRAND_IDENTITY.md Not Found
```
ERROR: No BRAND_IDENTITY.md found.
Create one at the project root or docs/BRAND_IDENTITY.md with your brand brief.
Run /brand-explore first to establish a visual direction before generating component sheets.
```

## API Key Missing
```
VERTEX_API_KEY or GOOGLE_API_KEY not found. Add one to .env:
echo "VERTEX_API_KEY=your_key" >> .env  # Preferred — Vertex AI, no RPD cap
echo "GOOGLE_API_KEY=your_key" >> .env  # Fallback — AI Studio, 250 RPD cap
```

## Generation Failed
If an individual sheet fails:
1. Report the error
2. Continue generating remaining sheets
3. At the end, report which succeeded and which failed

## Rate Limited (429)
Wait 10 seconds and retry the failed sheet once.

## User Cancels
At any AskUserQuestion, if user wants to stop:
- Save all generated images
- Report what was completed and where files are
- Note that component spec extraction is still pending
