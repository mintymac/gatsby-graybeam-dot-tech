---
description: Generate brand exploration boards from BRAND_IDENTITY.md
---

## CRITICAL: Model Selection
**NEVER** use `gemini-2.0-flash-exp-image-generation` — it produces garbage text that destroys user trust.
The ONLY model for image generation is `gemini-3-pro-image-preview`.
Do NOT substitute, even if that model returns a 404. Report the error instead.

# /brand-explore — Brand Exploration Board Generator

Generates brand exploration boards from your project's `BRAND_IDENTITY.md`. Each board is a single image showing color palette swatches, sample UI components, typography samples, and a mini dashboard snippet — all rendered in your brand's visual style. Use this BEFORE running `/design-target` to establish a brand system.

## Invocation

```
/brand-explore [--dir design_targets/brand] [--n 3]
```

Examples:
- `/brand-explore`
- `/brand-explore --dir design_targets/brand --n 5`
- `/brand-explore --n 2`

## Prerequisites

- `VERTEX_API_KEY` in `.env` (preferred — Vertex AI, no RPD cap)
- Falls back to `GOOGLE_API_KEY` if no Vertex key found
- `BRAND_IDENTITY.md` (or `docs/BRAND_IDENTITY.md`) in the project root

## Related Skills

- `/design-target` — After picking a winning brand board and filling in the Brand Prefix, run `/design-target` to generate morph design targets. It will automatically load the Brand Prefix from BRAND_IDENTITY.md.
- `/nbp` — Low-level text-to-image generation (this skill uses the same API pattern inline)
- `/nbp-refine` — Low-level reference-based refinement (used inline during the refinement loop)

---

# EXECUTION INSTRUCTIONS

## Stage 1: Setup

### Step 1.1: Parse Arguments

Extract from `$ARGUMENTS`:
- `DIR` — Output directory (default: `design_targets/brand`)
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
   ```

Read the file and extract the brand brief. Look for these sections (by heading):
- **Color System** — primary, secondary, accent, semantic colors
- **Typography** — heading, body, data/mono font preferences
- **Visual Personality** — adjectives, tone, feel
- **Mood / Inspiration** — reference points, aesthetic direction

Combine the extracted content into a `BRAND_BRIEF` string. If specific sections are not found by heading, use the entire file content as the brief.

### Step 1.3: Construct Generation Prompt

Build the image generation prompt by combining the brand brief with board instructions:

```
BRAND_PROMPT = """
You are a UI/UX designer creating a brand exploration board. Based on the following brand brief, generate a SINGLE image that is a brand exploration board containing ALL of the following sections arranged in a clean layout:

BRAND BRIEF:
{BRAND_BRIEF}

THE BOARD MUST INCLUDE:

1. COLOR PALETTE SWATCHES
   - Primary color (large swatch with hex label)
   - Secondary color (large swatch with hex label)
   - Accent color (large swatch with hex label)
   - Semantic colors: success (green), warning (amber), danger (red), info (blue) — smaller swatches
   - Background and surface colors

2. SAMPLE UI COMPONENT KIT (rendered in the brand's style):
   - A primary button and a secondary/ghost button
   - A card component with header, body text, and a subtle border/shadow
   - A table row with alternating background
   - A badge/pill component (e.g., status indicator)
   - A sidebar navigation snippet (3-4 items, one active)
   - A form input field with label and placeholder text

3. TYPOGRAPHY SAMPLES
   - Heading text sample (large, bold)
   - Body text sample (regular weight, readable)
   - Data/monospace text sample (for numbers, code, IDs)
   - Caption/small text sample

4. MINI DASHBOARD SNIPPET
   - A small section showing how these elements come together
   - Should convey the overall feel/mood of the brand
   - Include at least a metric card, a small chart area, and a nav element

Make the board visually polished and presentation-ready. Use a dark or light background consistent with the brand brief. Label each section clearly.
"""
```

### Step 1.4: Confirm with User

Use `AskUserQuestion`:
```
Question: "Generate {N} brand exploration boards from BRAND_IDENTITY.md? (~${N * 0.14:.2f})"
Header: "Brand Explore"
Options:
- "Yes, generate {N} boards"
- "Preview prompt first"
- "Cancel"
```

If "Preview prompt first": show the full BRAND_PROMPT, let user edit, then proceed.

---

## Stage 2: Generate Brand Boards

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

prompt = """$BRAND_PROMPT"""
n = $N
output_dir = "$DIR"
prefix = "brand_board"

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
**Brand Board v1:**
Read: {DIR}/brand_board_v1.{ext}

**Brand Board v2:**
Read: {DIR}/brand_board_v2.{ext}

**Brand Board v3:**
Read: {DIR}/brand_board_v3.{ext}

(etc. for N boards)
```

Report summary: number generated, output directory, filenames.

### Step 2.4: Generate Review Page

Generate an HTML review page so the user can evaluate images in a browser with lightbox zoom. If `tools/make_review.py` exists in the project, use it:

```bash
python3 tools/make_review.py \
  --phase "B0 — BRAND EXPLORATION" \
  --title "Brand Board" \
  --description "Brand board variations showing color palette, UI components, typography, and dashboard snippet." \
  --dir "$DIR" \
  --prefix brand_board \
  --n $N
```

If the script doesn't exist, create the review page inline using the brand palette (dark #09090B background, #18181B cards, #3F3F46 borders, violet #7C3AED hover, amber #F59E0B phase label, lightbox with zoom-in/zoom-out).

Open the review page in the browser: `xdg-open "$DIR/review.html"` (Linux) or `open "$DIR/review.html"` (macOS).

---

## Stage 3: Review & Refine Loop

### Step 3.1: Ask User to Pick Base

Use `AskUserQuestion`:
```
Question: "Which brand board is the strongest starting point?"
Header: "Brand Board"
Options:
- "v1" with description of its key characteristics
- "v2" with description
- "v3" with description
- (etc. for N boards)
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
Question: "What should be refined in {chosen_version}?"
Header: "Refine Brand Board"
```

### Step 3.3: Generate Refined Variations

Execute the `/nbp-refine` Python reference-image pattern inline (do NOT invoke as a slash command):
- Reference: `{DIR}/{chosen_version}.{ext}`
- Prompt: the user's refinement feedback
- N: 2
- Dir: `$DIR`

Output ancestry-named files: `brand_board_{parent}_r1.{ext}`, `brand_board_{parent}_r2.{ext}`

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

**If "One more round":** Go back to Step 3.2, using the chosen refinement as the new reference. The ancestry chain grows (e.g., `brand_board_v2_r1_r1.{ext}`).

**If winner declared:** Proceed to Stage 4.

---

## Stage 4: Extract Brand System

### Step 4.1: Declare Winner

Report to the user:
```
BRAND BOARD WINNER SELECTED

Winner: {winning_filename}
Lineage: {ancestry chain, e.g., "v2 > r1"}
Location: {DIR}/{winning_filename}
```

### Step 4.2: Extract Brand Values

Display the winning image one more time for reference, then use `AskUserQuestion`:
```
Question: "Now let's extract concrete values from the winning board to fill in the Brand Prefix section of BRAND_IDENTITY.md. I'll guide you through each category. Ready?"
Header: "Extract Brand System"
Options:
- "Yes, let's extract values"
- "I'll do it manually later"
```

If the user wants to proceed, guide them through extracting:

**Colors** — Ask user to identify from the winning board:
```
From the winning brand board, what are the exact hex values for:
- Primary: #______
- Secondary: #______
- Accent: #______
- Background: #______
- Surface: #______
- Text primary: #______
- Text secondary: #______
- Success: #______
- Warning: #______
- Danger: #______
```

**Typography** — Ask user to confirm font choices:
```
What font names should we use?
- Heading font: ______
- Body font: ______
- Mono/data font: ______
```

**Shape & Spacing** — Ask user to specify:
```
What values match the board's style?
- Border radius (e.g., 4px, 8px, 12px): ______
- Card shadow style (e.g., subtle, medium, none): ______
- Density (compact, normal, spacious): ______
```

### Step 4.3: Update BRAND_IDENTITY.md

After collecting the extracted values, update the Brand Prefix section in `BRAND_IDENTITY.md`. Look for a section headed `## Brand Prefix` (or similar). If it doesn't exist, append it.

The Brand Prefix section should be a concise block that can be prepended to image generation prompts. Format it as:

```markdown
## Brand Prefix

```
Apply this brand system to the UI design:
- Colors: primary {primary}, secondary {secondary}, accent {accent}, bg {background}, surface {surface}
- Text: primary {text_primary}, secondary {text_secondary}
- Semantic: success {success}, warning {warning}, danger {danger}
- Typography: headings in {heading_font}, body in {body_font}, data in {mono_font}
- Shape: {border_radius} radius, {shadow_style} shadows, {density} density
- Mood: {visual personality keywords from brief}
```
```

### Step 4.4: Final Report

```
BRAND SYSTEM EXTRACTED

Winner: {winning_filename}
Brand Prefix: Updated in BRAND_IDENTITY.md

Next step: Run /design-target to generate morph design targets.
The brand prefix will be automatically prepended to all design target prompts.
```

---

# ERROR HANDLING

## BRAND_IDENTITY.md Not Found
```
ERROR: No BRAND_IDENTITY.md found.
Create one at the project root or docs/BRAND_IDENTITY.md with your brand brief.
```

## API Key Missing
```
VERTEX_API_KEY or GOOGLE_API_KEY not found. Add one to .env:
echo "VERTEX_API_KEY=your_key" >> .env  # Preferred — Vertex AI, no RPD cap
echo "GOOGLE_API_KEY=your_key" >> .env  # Fallback — AI Studio, 250 RPD cap
```

## Generation Failed
If an individual board fails:
1. Report the error
2. Continue generating remaining boards
3. At the end, report which succeeded and which failed

## Rate Limited (429)
Wait 10 seconds and retry the failed board once.

## User Cancels
At any AskUserQuestion, if user wants to stop:
- Save all generated images
- Report what was completed and where files are
- Note that brand system extraction is still pending
