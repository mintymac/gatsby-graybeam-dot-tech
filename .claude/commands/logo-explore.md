---
description: Generate logo system exploration sheets from BRAND_IDENTITY.md
---

## CRITICAL: Model Selection
**NEVER** use `gemini-2.0-flash-exp-image-generation` — it produces garbage text that destroys user trust.
The ONLY model for image generation is `gemini-3-pro-image-preview`.
Do NOT substitute, even if that model returns a 404. Report the error instead.

# /logo-explore — Logo System Exploration

Generates logo system sheets from your project's `BRAND_IDENTITY.md`. Each sheet is a single image showing the full logo system — primary lockup, compact/icon, stacked, and wordmark-only variants — rendered on both dark and light backgrounds. Use this during Phase 2 of the branding process (see `methodology/branding-process.md`).

## Invocation

```
/logo-explore [--dir design_targets/logos] [--n 3]
```

Examples:
- `/logo-explore`
- `/logo-explore --dir design_targets/logos --n 5`
- `/logo-explore --n 2`

## Prerequisites

- `VERTEX_API_KEY` in `.env` (preferred — Vertex AI, no RPD cap)
- Falls back to `GOOGLE_API_KEY` if no Vertex key found
- `BRAND_IDENTITY.md` (or `docs/BRAND_IDENTITY.md`) in the project root

## Related Skills

- `/brand-explore` — Generate brand exploration boards (run this first to establish the visual direction)
- `/component-sheet` — After logos, generate a full component design system sheet
- `/design-target` — After brand system is complete, generate morph design targets
- `/nbp-refine` — Low-level reference-based refinement (used inline during the refinement loop)

---

# EXECUTION INSTRUCTIONS

## Stage 1: Setup

### Step 1.1: Parse Arguments

Extract from `$ARGUMENTS`:
- `DIR` — Output directory (default: `design_targets/logos`)
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
   (color system, typography, visual personality, mood/inspiration).
   Run /brand-explore first to establish a visual direction.
   ```

Read the file and extract the brand brief. Look for these sections (by heading):
- **Color System** — primary, secondary, accent, background, surface colors
- **Typography** — heading, body, data/mono font preferences
- **Visual Personality** — adjectives, tone, feel, shape language
- **Mood / Inspiration** — reference points, aesthetic direction
- **Logo System** — if any logo direction already exists

Combine the extracted content into a `BRAND_BRIEF` string. If specific sections are not found by heading, use the entire file content as the brief.

### Step 1.3: Gather Logo Details

Use `AskUserQuestion`:
```
Question: "Let's generate logo system sheets. I need a few details:

1. **Company/Product name:** (the name that appears in the logo)
2. **Tagline** (optional): (text below the logo, e.g., 'by Sports Culture')
3. **Icon concept ideas** (optional): (e.g., '3x3 grid', 'abstract flame', 'letter monogram')
4. **Full system sheet or individual logos?** (system sheet recommended — shows all variants on one image)

Provide what you have — I'll use the brand brief for anything not specified."
Header: "Logo Explore"
```

Extract the user's responses:
- `COMPANY_NAME` — required
- `TAGLINE` — optional, may be empty
- `ICON_IDEAS` — optional, may be empty
- `SHEET_MODE` — default to "system sheet"

### Step 1.4: Construct Generation Prompt

Build the image generation prompt by combining the brand brief with logo system instructions:

```
LOGO_PROMPT = """
You are a brand designer creating a logo system exploration sheet. Based on the following brand brief and requirements, generate a SINGLE image that is a professional logo system sheet.

BRAND BRIEF:
{BRAND_BRIEF}

LOGO REQUIREMENTS:
- Company/Product name: {COMPANY_NAME}
- Tagline: {TAGLINE or "None"}
- Icon concept direction: {ICON_IDEAS or "Design an icon that reflects the brand personality described above"}

THE SHEET MUST SHOW ALL OF THE FOLLOWING, CLEARLY LABELED:

1. PRIMARY LOCKUP — DARK BACKGROUND
   - Icon + company name + optional tagline, arranged horizontally
   - Rendered on the brand's dark background color
   - Full color version

2. PRIMARY LOCKUP — LIGHT BACKGROUND
   - Same lockup as above, adapted for light background
   - Rendered on the brand's light background color (or white)
   - Full color version

3. COMPACT / ICON-ONLY VERSION
   - Just the icon mark, no text
   - Show at multiple sizes: large (64px+), medium (32px), small (16px favicon scale)
   - On both dark and light backgrounds

4. STACKED VERSION
   - Icon on top, company name below
   - Works in square/vertical contexts (social avatars, app icons)
   - On both dark and light backgrounds

5. WORDMARK ONLY
   - Just the company name in the brand typography, no icon
   - On both dark and light backgrounds

6. SIZE REFERENCE
   - Show the primary lockup at 3 different scales (large, medium, small)
   - Demonstrate it remains legible and recognizable at each size

Make the sheet visually polished and presentation-ready. Use a neutral dark gray background for the sheet itself, with clearly labeled sections. The logo should feel cohesive with the brand personality described in the brief — match the typography direction, color palette, and visual tone.
"""
```

### Step 1.5: Confirm with User

Use `AskUserQuestion`:
```
Question: "Generate {N} logo system sheets for '{COMPANY_NAME}'? (~${N * 0.14:.2f})"
Header: "Logo Explore"
Options:
- "Yes, generate {N} sheets"
- "Preview prompt first"
- "Cancel"
```

If "Preview prompt first": show the full LOGO_PROMPT, let user edit, then proceed.

---

## Stage 2: Generate Logo Sheets

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

prompt = """$LOGO_PROMPT"""
n = $N
output_dir = "$DIR"
prefix = "logo_system"

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
**Logo System v1:**
Read: {DIR}/logo_system_v1.{ext}

**Logo System v2:**
Read: {DIR}/logo_system_v2.{ext}

**Logo System v3:**
Read: {DIR}/logo_system_v3.{ext}

(etc. for N sheets)
```

Report summary: number generated, output directory, filenames.

### Step 2.4: Generate Review Page

Generate an HTML review page so the user can evaluate images in a browser with lightbox zoom. If `tools/make_review.py` exists in the project, use it:

```bash
python3 tools/make_review.py \
  --phase "B1 — LOGO SYSTEM EXPLORATION" \
  --title "Logo System" \
  --description "Logo system explorations showing icon mark + wordmark variants across dark and light backgrounds." \
  --dir "$DIR" \
  --prefix logo_system \
  --n $N
```

If the script doesn't exist, create the review page inline using the brand palette (dark #09090B background, #18181B cards, #3F3F46 borders, violet #7C3AED hover, amber #F59E0B phase label, lightbox with zoom-in/zoom-out).

Open the review page in the browser: `xdg-open "$DIR/review.html"` (Linux) or `open "$DIR/review.html"` (macOS).

---

## Stage 3: Review & Refine Loop

### Step 3.1: Ask User to Pick Base

Use `AskUserQuestion`:
```
Question: "Which logo system sheet is the strongest starting point?"
Header: "Logo System"
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
- Icon shape/concept — does it communicate the right idea?
- Typography — does the font feel right for the brand?
- Color application — does it work on both dark and light?
- Proportions — is the icon/text balance right?
- Size behavior — does the compact version work at small scale?"
Header: "Refine Logo"
```

### Step 3.3: Generate Refined Variations

Execute the `/nbp-refine` Python reference-image pattern inline (do NOT invoke as a slash command):
- Reference: `{DIR}/{chosen_version}.{ext}`
- Prompt: the user's refinement feedback
- N: 2
- Dir: `$DIR`

Output ancestry-named files: `logo_system_{parent}_r1.{ext}`, `logo_system_{parent}_r2.{ext}`

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

**If "One more round":** Go back to Step 3.2, using the chosen refinement as the new reference. The ancestry chain grows (e.g., `logo_system_v2_r1_r1.{ext}`).

**If winner declared:** Proceed to Stage 4.

---

## Stage 4: Record & Update Brand Docs

### Step 4.1: Declare Winner

Report to the user:
```
LOGO SYSTEM WINNER SELECTED

Winner: {winning_filename}
Lineage: {ancestry chain, e.g., "v2 > r1"}
Location: {DIR}/{winning_filename}
```

### Step 4.2: Guide Brand Doc Update

Display the winning image one more time for reference, then use `AskUserQuestion`:
```
Question: "Now let's update BRAND_IDENTITY.md with the logo system details. I'll help you document:

1. **Logo variants** — primary lockup, compact, stacked, wordmark
2. **Icon spec** — description of the icon mark and how it scales
3. **Color variants** — how the logo renders on dark, light, and single-color contexts

Ready to update the brand docs?"
Header: "Update Brand Docs"
Options:
- "Yes, let's document the logo system"
- "I'll do it manually later"
```

If the user wants to proceed, guide them through documenting:

**Logo Variants Table:**
```
| Variant | Usage | Description |
|---------|-------|-------------|
| Full lockup | Headers, splash, marketing | [icon] + [name] + [tagline] |
| Compact | Favicons, app icons | [icon] + [initials] |
| Stacked | Square contexts, avatars | [icon] above [name] |
| Wordmark | Inline, minimal | [name] only |
```

**Icon Spec:**
```
- Shape: [description of the icon]
- Minimum size: [smallest usable size]
- Color: [how it uses brand colors]
```

**Color Contexts:**
```
| Context | Icon Color | Text Color | Background |
|---------|-----------|------------|------------|
| On dark | [hex] | [hex] | [hex] |
| On light | [hex] | [hex] | [hex] |
| Single color | Current color | Current color | Any |
```

Look for a section headed `## Logo System` (or similar) in `BRAND_IDENTITY.md`. If it doesn't exist, add it after the Color System section. Update with the documented values.

### Step 4.3: Final Report

```
LOGO SYSTEM DOCUMENTED

Winner: {winning_filename}
Brand Docs: Updated BRAND_IDENTITY.md with logo system details
Design Target: {DIR}/{winning_filename}

Next steps:
- Run /component-sheet to generate a full component design system sheet
- Or run /brand-explore to refine the overall brand direction
- Or run /design-target to generate screen design targets (if brand system is complete)
```

---

# ERROR HANDLING

## BRAND_IDENTITY.md Not Found
```
ERROR: No BRAND_IDENTITY.md found.
Create one at the project root or docs/BRAND_IDENTITY.md with your brand brief.
Run /brand-explore first to establish a visual direction before logo exploration.
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
- Note that logo system documentation is still pending
