/**
 * Netlify Function (Node 20 ESM): Inkling 2 Mini Sous-Chef on Thinking Machines Tinker API.
 *
 * Routes:
 *   GET  /api/sous-chef/status  -> returns non-secret mode & config status
 *   POST /api/sous-chef/ask     -> queries Inkling 2 Mini grounded in live schedule + optional photo
 *
 * Security invariants:
 * - Zero hardcoded keys; never logs or echoes API keys or PINs.
 * - Defaults to "pin_protected" ONLY when both TINKER_API_KEY and SOUS_CHEF_ACCESS_PIN are set,
 *   otherwise fails closed to "byok" (never exposes server key without PIN or explicit public_free).
 * - Constant-time PIN verification via node:crypto SHA-256 + timingSafeEqual.
 * - Per-IP sliding-window rate limiter (20 req/hr default), 2.8 MB image cap, strict allow-list parser.
 */

import { createHash, timingSafeEqual } from "node:crypto";

const DAY_MINUTES = 1440;
const DEFAULT_TINKER_BASE_URL = "https://tinker.thinkingmachines.dev/services/tinker-prod/oai/api/v1";
const DEFAULT_TINKER_MODEL = "thinkingmachines/Inkling-2-Mini";
const FREE_TIER_MODEL = "thinkingmachines/Inkling-2-Mini:peft:65536:free";
const SUPPORTED_TINKER_MODELS = [DEFAULT_TINKER_MODEL, FREE_TIER_MODEL];

const MAX_IMAGE_DATA_URL_CHARS = 2_800_000; // ~2.8 MB cap
const DEFAULT_RATE_LIMIT_PER_HOUR = 20;
const RATE_WINDOW_MS = 3600 * 1000;
const TINKER_TIMEOUT_MS = 55_000;

const DEFAULT_PUBLIC_ALLOWED_ORIGINS = [
  "https://graybeam.tech",
  "https://www.graybeam.tech",
  "https://thanksgiving.graybeam.tech",
];

const QUICK_ADD_TEMPLATES_SUMMARY = [
  { key: "dinner_rolls", name: "Warm Buttermilk Rolls", appliance: "auto", cook_min: 15 },
  { key: "cranberry_sauce", name: "Spiced Cranberry Sauce", appliance: "stovetop", cook_min: 15 },
  { key: "brussels", name: "Air-Fry Maple Brussels Sprouts", appliance: "auto", cook_min: 15 },
  { key: "dessert_sauces", name: "Whipped Cream & Warm Caramel Sauce", appliance: "stovetop", cook_min: 12 },
];
const QUICK_ADD_TEMPLATE_KEYS = new Set(QUICK_ADD_TEMPLATES_SUMMARY.map((t) => t.key));

const ALLOWED_DISH_UPDATE_FIELDS = new Set([
  "name",
  "enabled",
  "appliance",
  "temp_f",
  "prep_min",
  "cook_min",
  "rest_min",
  "racks",
  "day_preference",
  "anchor",
  "max_hold_min",
  "turkey_weight_lb",
  "turkey_method",
  "probe_pull_f",
  "probe_target_f",
  "bread_dry_method",
  "bread_pudding_mode",
  "pie_bake_mode",
  "gravy_two_stage",
  "requires_chill_min",
  "temper_min",
  "reheat_min",
  "carve_min",
  "make_ahead_prep_ok",
  "technique_note",
  "locked_cook_start_min",
]);

const SYSTEM_PROMPT = `You are the Thanksgiving Culinary & KitchenAid Operations Sous-Chef powered by Inkling 2 Mini.
You advise the cook using their exact live CP-SAT Thanksgiving schedule (KitchenAid Combo Wall Oven: lower Main Oven + upper Convection/Air-Fry Microwave Combo, plus 4-burner stovetop).

Guidelines:
- Give concise, practical, high-confidence culinary and timing guidance grounded in the live schedule provided.
- Always respect physics & food safety (158°F breast pull → 165°F carryover, 20m cooldown when dropping from 450°F spatchcock to 350°F sides, pan-dripping gravy finishing after turkey pulls, pie 2h cool + 3h chill).
- If the user attaches a photo (e.g., meat thermometer, turkey browning, oven racks, pie jiggle, gravy consistency), analyze what you see directly and connect it to their schedule.
- Timeline minutes use Day Before 00:00 = 0 and Thanksgiving Day 00:00 = 1440 (e.g., Thu 4:00 PM = 2400, Thu 5:00 PM = 2460, Thu 5:30 PM = 2490).

Structured Schedule Changes:
ONLY when the user asks to change the schedule or you recommend concrete schedule edits they can apply with one click, append a single fenced \`\`\`json\`\`\` block at the end of your reply with this exact schema:
\`\`\`json
{
  "action_summary": "Short 1-line summary of the proposed schedule update",
  "proposed_actions": [
    {"op": "set_dinner_time", "dinner_ready_min": 2460},
    {"op": "update_dish", "dish_id": "turkey", "changes": {"cook_min": 195, "temp_f": 325}},
    {"op": "add_template", "template_key": "dinner_rolls"},
    {"op": "toggle_dish", "dish_id": "pan_gravy", "enabled": true},
    {"op": "set_upper_convection", "enabled": true}
  ]
}
\`\`\`
Supported action ops ONLY:
1. {"op": "set_dinner_time", "dinner_ready_min": <int between 2100 and 2760>}
2. {"op": "update_dish", "dish_id": "<existing dish id>", "changes": {<valid DishConfig fields>}}
3. {"op": "add_template", "template_key": "<key from QUICK-ADD TEMPLATES>"}
4. {"op": "toggle_dish", "dish_id": "<existing dish id>", "enabled": <bool>}
5. {"op": "set_upper_convection", "enabled": <bool>}

If no schedule change is needed, reply in clean markdown prose without a JSON block.`;

// ---------------------------------------------------------------------------
// Per-IP Sliding-Window Rate Limiter (warm-instance memory)
// ---------------------------------------------------------------------------
const rateBuckets = new Map();

function resolveRateLimitPerHour() {
  const raw = (process.env.SOUS_CHEF_RATE_LIMIT_PER_HOUR || "").trim();
  if (raw) {
    const parsed = Number.parseInt(raw, 10);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }
  return DEFAULT_RATE_LIMIT_PER_HOUR;
}

function checkRateLimit(ip) {
  const limit = resolveRateLimitPerHour();
  const now = Date.now();
  const cutoff = now - RATE_WINDOW_MS;
  let timestamps = rateBuckets.get(ip);
  if (!timestamps) {
    timestamps = [];
    rateBuckets.set(ip, timestamps);
  }
  while (timestamps.length > 0 && timestamps[0] <= cutoff) {
    timestamps.shift();
  }
  if (timestamps.length >= limit) {
    const retryAfter = Math.max(1, Math.ceil((timestamps[0] + RATE_WINDOW_MS - now) / 1000));
    return { allowed: false, retryAfter };
  }
  timestamps.push(now);
  return { allowed: true, retryAfter: 0 };
}

function extractClientIp(req, context) {
  const nfIp = (req.headers.get("x-nf-client-connection-ip") || "").trim();
  if (nfIp) return nfIp;
  const xff = (req.headers.get("x-forwarded-for") || "").trim();
  if (xff) {
    const first = xff.split(",")[0].trim();
    if (first) return first;
  }
  if (context && typeof context.ip === "string" && context.ip.trim()) {
    return context.ip.trim();
  }
  return "unknown";
}

// ---------------------------------------------------------------------------
// Security Headers & CORS
// ---------------------------------------------------------------------------
function resolveAllowedOrigins() {
  const raw = (process.env.ALLOWED_ORIGINS || "").trim();
  if (raw) {
    const parsed = raw
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    if (parsed.length > 0) return parsed;
  }
  return DEFAULT_PUBLIC_ALLOWED_ORIGINS;
}

function buildResponseHeaders(req, extra = {}) {
  const headers = new Headers({
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "SAMEORIGIN",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "Permissions-Policy": "geolocation=(), microphone=()",
    ...extra,
  });

  const origin = (req.headers.get("origin") || "").trim();
  const allowed = resolveAllowedOrigins();
  if (origin) {
    const reqOrigin = new URL(req.url).origin;
    if (origin === reqOrigin || allowed.includes("*") || allowed.includes(origin)) {
      headers.set("Access-Control-Allow-Origin", origin);
      headers.set("Vary", "Origin");
      headers.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
      headers.set("Access-Control-Allow-Headers", "Content-Type, X-Tinker-Api-Key, X-Sous-Chef-Pin");
    }
  }
  return headers;
}

function jsonResponse(req, body, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: buildResponseHeaders(req, extraHeaders),
  });
}

// ---------------------------------------------------------------------------
// Mode & Secret Resolution (Zero-Leak Fail-Closed)
// ---------------------------------------------------------------------------
function resolveSousChefMode() {
  const raw = (process.env.SOUS_CHEF_MODE || "").trim().toLowerCase();
  if (raw === "byok" || raw === "pin_protected" || raw === "public_free") {
    return raw;
  }
  if (raw) {
    // Unknown or unsupported mode fails closed to BYOK
    return "byok";
  }
  const hasServerKey = Boolean((process.env.TINKER_API_KEY || "").trim());
  const hasPin = Boolean((process.env.SOUS_CHEF_ACCESS_PIN || "").trim());
  return hasServerKey && hasPin ? "pin_protected" : "byok";
}

function verifyAccessPin(suppliedPin) {
  const expected = (process.env.SOUS_CHEF_ACCESS_PIN || "").trim();
  const supplied = typeof suppliedPin === "string" ? suppliedPin.trim() : "";
  if (!expected || !supplied) return false;
  // Constant-time comparison via fixed-length SHA-256 digests + timingSafeEqual
  const hExpected = createHash("sha256").update(expected, "utf8").digest();
  const hSupplied = createHash("sha256").update(supplied, "utf8").digest();
  return timingSafeEqual(hExpected, hSupplied);
}

function resolveTinkerApiKey(apiKeyOverride, accessPin) {
  if (typeof apiKeyOverride === "string" && apiKeyOverride.trim()) {
    return { apiKey: apiKeyOverride.trim(), source: "header" };
  }

  const mode = resolveSousChefMode();
  const serverKey = (process.env.TINKER_API_KEY || "").trim();

  if (mode === "byok") {
    return { apiKey: null, source: "none" };
  }
  if (mode === "pin_protected") {
    if (!verifyAccessPin(accessPin)) {
      return { apiKey: null, source: "none" };
    }
    return serverKey ? { apiKey: serverKey, source: "protected" } : { apiKey: null, source: "none" };
  }
  if (mode === "public_free") {
    return serverKey ? { apiKey: serverKey, source: "protected" } : { apiKey: null, source: "none" };
  }
  return { apiKey: null, source: "none" };
}

function resolveTinkerBaseUrl() {
  const envVal = (process.env.TINKER_BASE_URL || "").trim();
  return envVal ? envVal.replace(/\/+$/, "") : DEFAULT_TINKER_BASE_URL;
}

function resolveTinkerDefaultModel() {
  const mode = resolveSousChefMode();
  if (mode === "public_free") return FREE_TIER_MODEL;
  const envVal = (process.env.TINKER_MODEL || "").trim();
  return envVal || DEFAULT_TINKER_MODEL;
}

function getSousChefStatus() {
  const mode = resolveSousChefMode();
  const hasServerKey = Boolean((process.env.TINKER_API_KEY || "").trim());
  const hasPin = Boolean((process.env.SOUS_CHEF_ACCESS_PIN || "").trim());

  let configured = false;
  let keySource = "none";
  if (mode === "pin_protected") {
    configured = hasServerKey && hasPin;
    keySource = configured ? "protected" : "none";
  } else if (mode === "public_free") {
    configured = hasServerKey;
    keySource = configured ? "protected" : "none";
  }

  return {
    mode,
    configured,
    pin_required: mode === "pin_protected",
    byok_supported: true,
    key_source: keySource,
    base_url: resolveTinkerBaseUrl(),
    default_model: resolveTinkerDefaultModel(),
    models: [...SUPPORTED_TINKER_MODELS],
  };
}

// ---------------------------------------------------------------------------
// Live Schedule Grounding & Structured Action Parser (Mirrors sous_chef.py)
// ---------------------------------------------------------------------------
function formatMinute(minute) {
  const safe = Number.isFinite(Number(minute)) ? Math.round(Number(minute)) : 0;
  const day = Math.floor(safe / DAY_MINUTES);
  const dayLabel = day === 0 ? "Day Before" : day === 1 ? "Thanksgiving" : `Day ${day + 1}`;
  const m = ((safe % DAY_MINUTES) + DAY_MINUTES) % DAY_MINUTES;
  const hour24 = Math.floor(m / 60);
  const mins = m % 60;
  const period = hour24 < 12 ? "AM" : "PM";
  const hour12 = hour24 % 12 || 12;
  return `${dayLabel} ${hour12}:${String(mins).padStart(2, "0")} ${period}`;
}

function buildScheduleContext(request, plan) {
  const k = request?.kitchen || {};
  const dinner = Number(k.dinner_ready_min ?? DAY_MINUTES + 16 * 60);
  const dessert = Number(k.dessert_ready_min ?? Math.min(2 * DAY_MINUTES - 5, dinner + Number(k.dessert_offset_min ?? 60)));
  const earliest = k.earliest_start_min;

  const lines = [
    "=== LIVE KITCHEN CONFIGURATION ===",
    `Dinner Ready-By: ${formatMinute(dinner)} (minute=${dinner})`,
    `Dessert Service: ${formatMinute(dessert)} (minute=${dessert})`,
    `Earliest Start: ${earliest !== null && earliest !== undefined ? formatMinute(earliest) : "None (full 2-day window)"}`,
    `Kitchen Hours: Day Before ${formatMinute(k.day_before_start_min ?? 540)}–${formatMinute(k.day_before_end_min ?? 1410)}; Day Of ${formatMinute(k.day_of_start_min ?? 1860)}–${formatMinute(k.day_of_end_min ?? 2760)}`,
    `Appliances: Main Oven (${k.main_oven_racks ?? 2} racks, ±${k.temp_tolerance_f ?? 25}°F temp tolerance), Upper Combo Convection=${k.upper_has_convection === false ? "OFF" : "ON"}, Stovetop (${k.stovetop_burners ?? 4} burners), Cooks=${k.cook_count ?? 2}`,
    "",
    "=== CONFIGURED DISHES ===",
  ];

  const dishes = Array.isArray(request?.dishes) ? request.dishes : [];
  for (const d of dishes) {
    const extras = [];
    if (d.turkey_method) extras.push(`method=${d.turkey_method}`);
    if (d.turkey_weight_lb) extras.push(`weight=${d.turkey_weight_lb}lb`);
    if (d.bread_dry_method) extras.push(`bread_dry=${d.bread_dry_method}`);
    if (d.bread_pudding_mode) extras.push(`mode=${d.bread_pudding_mode}`);
    if (d.gravy_two_stage) extras.push("2-stage-drippings-linked");
    if (d.locked_cook_start_min !== null && d.locked_cook_start_min !== undefined) {
      extras.push(`LOCKED@${formatMinute(d.locked_cook_start_min)}`);
    }
    const extraStr = extras.length ? ` [${extras.join(", ")}]` : "";
    const tempStr = d.temp_f ? `${d.temp_f}°F` : "no-oven";
    lines.push(
      `- id=${d.id} | ${d.name} | enabled=${d.enabled !== false} | ${d.appliance} ${tempStr} | prep=${d.prep_min ?? 0}m cook=${d.cook_min ?? 0}m rest=${d.rest_min ?? 0}m | day=${d.day_preference ?? "any"} anchor=${d.anchor ?? "dinner"}${extraStr}`
    );
  }

  lines.push("");
  lines.push("=== QUICK-ADD TEMPLATES (available for add_template) ===");
  for (const tpl of QUICK_ADD_TEMPLATES_SUMMARY) {
    lines.push(`- template_key=${tpl.key}: ${tpl.name} (${tpl.appliance}, ${tpl.cook_min}m)`);
  }

  if (plan && typeof plan === "object") {
    lines.push("");
    lines.push(`=== CURRENT SOLVED SCHEDULE (status=${plan.status || "unknown"}) ===`);
    if (plan.validation) {
      lines.push(
        `Validator: ${
          plan.validation.valid
            ? "VALID 8/8"
            : `INVALID: ${(plan.validation.violations || []).join("; ")}`
        }`
      );
    }
    if (Array.isArray(plan.turkey_rest_window) && plan.turkey_rest_window.length === 2) {
      lines.push(
        `Turkey Rest Window (Main Oven FREE): ${formatMinute(plan.turkey_rest_window[0])} – ${formatMinute(plan.turkey_rest_window[1])}`
      );
    }
    if (Array.isArray(plan.diagnostics) && plan.diagnostics.length > 0) {
      lines.push(`Diagnostics: ${plan.diagnostics.join(" | ")}`);
    }
    for (const t of Array.isArray(plan.tasks) ? plan.tasks : []) {
      const tempPart = t.temp_f ? ` @${t.temp_f}°F` : "";
      const lockPart = t.locked ? " [LOCKED]" : "";
      lines.push(`- ${t.start_label || formatMinute(t.start_min)}–${t.end_label || formatMinute(t.end_min)} | ${t.resource}${tempPart} | ${t.id}: ${t.label}${lockPart}`);
    }
  }

  return lines.join("\n");
}

function sanitizeActions(rawActions) {
  if (!Array.isArray(rawActions)) return [];
  const sanitized = [];
  for (const item of rawActions) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const op = item.op;
    if (op === "set_dinner_time") {
      const val = item.dinner_ready_min;
      if (Number.isInteger(val) && val >= DAY_MINUTES + 11 * 60 && val <= DAY_MINUTES + 22 * 60) {
        sanitized.push({ op: "set_dinner_time", dinner_ready_min: val });
      }
    } else if (op === "update_dish") {
      const dishId = item.dish_id;
      const changes = item.changes;
      if (typeof dishId === "string" && dishId.trim() && changes && typeof changes === "object" && !Array.isArray(changes)) {
        const filtered = {};
        for (const [k, v] of Object.entries(changes)) {
          if (ALLOWED_DISH_UPDATE_FIELDS.has(k)) filtered[k] = v;
        }
        if (Object.keys(filtered).length > 0) {
          sanitized.push({ op: "update_dish", dish_id: dishId.trim(), changes: filtered });
        }
      }
    } else if (op === "add_template") {
      const templateKey = item.template_key;
      if (typeof templateKey === "string" && QUICK_ADD_TEMPLATE_KEYS.has(templateKey)) {
        sanitized.push({ op: "add_template", template_key: templateKey });
      }
    } else if (op === "toggle_dish") {
      const dishId = item.dish_id;
      const enabled = item.enabled;
      if (typeof dishId === "string" && dishId.trim() && typeof enabled === "boolean") {
        sanitized.push({ op: "toggle_dish", dish_id: dishId.trim(), enabled });
      }
    } else if (op === "set_upper_convection") {
      const enabled = item.enabled;
      if (typeof enabled === "boolean") {
        sanitized.push({ op: "set_upper_convection", enabled });
      }
    }
  }
  return sanitized;
}

function extractActionsFromObj(obj) {
  if (Array.isArray(obj)) {
    return { reply: null, actions: sanitizeActions(obj), summary: null };
  }
  if (obj && typeof obj === "object") {
    if ("op" in obj) {
      return { reply: null, actions: sanitizeActions([obj]), summary: null };
    }
    const rawActions = obj.proposed_actions !== undefined ? obj.proposed_actions : obj.actions;
    const actions = sanitizeActions(rawActions);
    const reply = typeof obj.reply === "string" ? obj.reply : null;
    const summary = typeof obj.action_summary === "string" ? obj.action_summary : null;
    return { reply, actions, summary };
  }
  return { reply: null, actions: [], summary: null };
}

function parseSousChefOutput(rawText) {
  const text = String(rawText || "").trim();
  if (!text) return { reply: "", proposedActions: [], actionSummary: null };

  // Case 1: Pure JSON object
  if (text.startsWith("{") && text.endsWith("}")) {
    try {
      const obj = JSON.parse(text);
      const { reply, actions, summary } = extractActionsFromObj(obj);
      if (reply !== null || actions.length > 0) {
        return {
          reply: (reply || summary || "Proposed schedule update ready to apply.").trim(),
          proposedActions: actions,
          actionSummary: summary,
        };
      }
    } catch {
      // Fall through to prose parsing
    }
  }

  // Case 2: Fenced ```json ... ``` blocks inside markdown prose
  const fenceRe = /```(?:json)?\s*([\s\S]*?)```/gi;
  const collectedActions = [];
  let actionSummary = null;
  let extractedReply = null;
  const spansToStrip = [];

  for (const match of text.matchAll(fenceRe)) {
    const snippet = (match[1] || "").trim();
    let obj;
    try {
      obj = JSON.parse(snippet);
    } catch {
      continue;
    }
    const { reply: rPart, actions: acts, summary: summ } = extractActionsFromObj(obj);
    if (acts.length > 0 || rPart !== null || summ !== null) {
      collectedActions.push(...acts);
      if (summ && !actionSummary) actionSummary = summ;
      if (rPart && !extractedReply) extractedReply = rPart;
      spansToStrip.push([match.index, match.index + match[0].length]);
    }
  }

  if (spansToStrip.length > 0) {
    const parts = [];
    let cursor = 0;
    for (const [start, end] of spansToStrip) {
      parts.push(text.slice(cursor, start));
      cursor = end;
    }
    parts.push(text.slice(cursor));
    let cleanedReply = parts
      .map((p) => p.trim())
      .filter(Boolean)
      .join("\n")
      .trim();
    if (!cleanedReply) {
      cleanedReply = (extractedReply || actionSummary || "Proposed schedule update ready to apply.").trim();
    }
    return { reply: cleanedReply, proposedActions: collectedActions, actionSummary };
  }

  return { reply: text, proposedActions: [], actionSummary: null };
}

// ---------------------------------------------------------------------------
// POST /api/sous-chef/ask Handler
// ---------------------------------------------------------------------------
async function handleAsk(req, context) {
  const clientIp = extractClientIp(req, context);
  const rl = checkRateLimit(clientIp);
  if (!rl.allowed) {
    return jsonResponse(
      req,
      { detail: `Rate limit exceeded for Sous-Chef assistant. Please retry in ${rl.retryAfter}s.` },
      429,
      { "Retry-After": String(rl.retryAfter) }
    );
  }

  let payload;
  try {
    payload = await req.json();
  } catch {
    return jsonResponse(req, { detail: "Invalid JSON request body." }, 400);
  }

  const message = typeof payload?.message === "string" ? payload.message.trim() : "";
  if (!message || message.length > 4000) {
    return jsonResponse(req, { detail: "Field 'message' must be between 1 and 4000 characters." }, 422);
  }

  const apiKeyOverride = req.headers.get("x-tinker-api-key");
  const accessPin = req.headers.get("x-sous-chef-pin");
  const mode = resolveSousChefMode();
  const { apiKey, source } = resolveTinkerApiKey(apiKeyOverride, accessPin);

  const chosenModel =
    mode === "public_free" && source !== "header"
      ? FREE_TIER_MODEL
      : (typeof payload.model === "string" && payload.model.trim()) || resolveTinkerDefaultModel();

  const imageDataUrl = typeof payload.image_data_url === "string" ? payload.image_data_url : null;
  if (imageDataUrl && imageDataUrl.length > MAX_IMAGE_DATA_URL_CHARS) {
    return jsonResponse(req, {
      configured: apiKey !== null,
      model: chosenModel,
      reply: "That photo is larger than the 2 MB limit. Please upload a smaller image or compress it before retrying.",
      proposed_actions: [],
      action_summary: null,
      error: `image_data_url exceeds maximum allowed length of ${MAX_IMAGE_DATA_URL_CHARS} characters.`,
    });
  }

  if (!apiKey) {
    if (mode === "pin_protected") {
      const suppliedPin = typeof accessPin === "string" && accessPin.trim().length > 0;
      return jsonResponse(req, {
        configured: false,
        model: chosenModel,
        reply: suppliedPin
          ? "That host access PIN did not match.\n\nEnter the correct Sous-Chef PIN, or paste your own Tinker API key (from https://tinker-console.thinkingmachines.ai/keys) to use BYOK mode."
          : "This Thanksgiving Planner is running in PIN-protected Sous-Chef mode.\n\n1. Enter the host Sous-Chef PIN to unlock the shared assistant, OR\n2. Paste your own Tinker API key from https://tinker-console.thinkingmachines.ai/keys.",
        proposed_actions: [],
        action_summary: null,
        error: suppliedPin
          ? "Invalid Sous-Chef access PIN."
          : "Sous-Chef PIN required (or provide your own X-Tinker-Api-Key).",
      });
    }

    if (mode === "byok") {
      return jsonResponse(req, {
        configured: false,
        model: chosenModel,
        reply:
          "Public BYOK mode is active—this server does not expose a shared Tinker key.\n\n1. Create your own key at https://tinker-console.thinkingmachines.ai/keys\n2. Paste it into the Sous-Chef session key field in the UI.",
        proposed_actions: [],
        action_summary: null,
        error: "BYOK mode active: X-Tinker-Api-Key header is required.",
      });
    }

    return jsonResponse(req, {
      configured: false,
      model: chosenModel,
      reply:
        "Inkling 2 Mini Sous-Chef needs a Tinker API key before it can answer.\n\n1. Create a key at https://tinker-console.thinkingmachines.ai/keys\n2. Paste it into the Sous-Chef session key box in the UI.",
      proposed_actions: [],
      action_summary: null,
      error: "TINKER_API_KEY is not configured.",
    });
  }

  const baseUrl = resolveTinkerBaseUrl();
  const endpoint = `${baseUrl}/chat/completions`;
  const contextSnapshot = buildScheduleContext(payload.request, payload.plan);

  const messages = [{ role: "system", content: `${SYSTEM_PROMPT}\n\n${contextSnapshot}` }];
  const history = Array.isArray(payload.history) ? payload.history.slice(-8) : [];
  for (const turn of history) {
    if (
      turn &&
      (turn.role === "user" || turn.role === "assistant") &&
      typeof turn.content === "string" &&
      turn.content.trim()
    ) {
      messages.push({ role: turn.role, content: turn.content.trim() });
    }
  }

  const userContent =
    imageDataUrl && imageDataUrl.trim()
      ? [
          { type: "text", text: message },
          { type: "image_url", image_url: { url: imageDataUrl.trim() } },
        ]
      : message;
  messages.push({ role: "user", content: userContent });

  const body = {
    model: chosenModel,
    messages,
    temperature: 0.3,
    max_tokens: 4096,
  };

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), TINKER_TIMEOUT_MS);
  const tStart = Date.now();

  try {
    const upstream = await fetch(endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    if (!upstream.ok) {
      let errDetail = `Tinker API returned HTTP ${upstream.status}.`;
      try {
        const errJson = await upstream.json();
        const errObj = errJson?.error;
        if (errObj && typeof errObj === "object" && errObj.message) {
          errDetail = `Tinker API error (${upstream.status}): ${errObj.message}`;
        } else if (typeof errObj === "string") {
          errDetail = `Tinker API error (${upstream.status}): ${errObj}`;
        }
      } catch {
        // Ignore non-JSON error body
      }
      return jsonResponse(req, {
        configured: true,
        model: chosenModel,
        reply: "Couldn't reach Inkling 2 Mini right now—check your Tinker API key or model selection and retry.",
        proposed_actions: [],
        action_summary: null,
        error: errDetail,
      });
    }

    const data = await upstream.json();
    const firstChoice = Array.isArray(data?.choices) ? data.choices[0] : null;
    const finishReason = firstChoice?.finish_reason ?? null;
    const contentVal = firstChoice?.message?.content ?? "";
    let rawContent = "";
    if (typeof contentVal === "string") {
      rawContent = contentVal;
    } else if (Array.isArray(contentVal)) {
      rawContent = contentVal
        .filter((part) => part && typeof part === "object" && part.type === "text")
        .map((part) => part.text || "")
        .join("\n");
    }

    // Strip any inline <think>...</think> blocks emitted inside content
    rawContent = rawContent.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();

    const { reply, proposedActions, actionSummary } = parseSousChefOutput(rawContent);
    const resolvedModel = typeof data?.model === "string" && data.model ? data.model : chosenModel;

    if (!reply && proposedActions.length === 0) {
      const errMsg =
        finishReason === "length"
          ? "Inkling 2 Mini exhausted its reasoning token budget before writing a reply."
          : "Inkling 2 Mini returned an empty response.";
      return jsonResponse(req, {
        configured: true,
        model: resolvedModel,
        reply:
          "Inkling 2 Mini needed a bit more room to finish thinking—please try asking again or make the question slightly shorter.",
        proposed_actions: [],
        action_summary: null,
        error: errMsg,
      });
    }

    return jsonResponse(req, {
      configured: true,
      model: resolvedModel,
      reply,
      proposed_actions: proposedActions,
      action_summary: actionSummary,
      latency_ms: Date.now() - tStart,
      error: null,
    });
  } catch (err) {
    const isAbort = err && (err.name === "AbortError" || err.name === "TimeoutError");
    return jsonResponse(req, {
      configured: true,
      model: chosenModel,
      reply: isAbort
        ? "Inkling 2 Mini timed out waiting for a response. Please try again."
        : "Network error contacting Tinker API. Please check connectivity and try again.",
      proposed_actions: [],
      action_summary: null,
      error: isAbort ? "Request to Tinker API timed out." : `HTTP error: ${err?.name || "FetchError"}`,
    });
  } finally {
    clearTimeout(timeoutId);
  }
}

// ---------------------------------------------------------------------------
// Netlify Function Entrypoint (Web Request -> Web Response)
// ---------------------------------------------------------------------------
export default async function handler(req, context) {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: buildResponseHeaders(req) });
  }

  const url = new URL(req.url);
  const path = url.pathname.replace(/\/+$/, "");
  const isStatusRoute =
    path.endsWith("/status") || (req.method === "GET" && (path.endsWith("/sous-chef") || url.searchParams.get("action") === "status"));
  const isAskRoute = path.endsWith("/ask") || (req.method === "POST" && path.endsWith("/sous-chef"));

  if (req.method === "GET" && isStatusRoute) {
    return jsonResponse(req, getSousChefStatus(), 200);
  }

  if (req.method === "POST" && isAskRoute) {
    return handleAsk(req, context);
  }

  return jsonResponse(req, { detail: "Not found. Expected GET /api/sous-chef/status or POST /api/sous-chef/ask." }, 404);
}
