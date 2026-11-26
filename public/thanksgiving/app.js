/* Graybeam Thanksgiving OR Planner — Zero-Build Modular ES6 Frontend */

import { solveScheduleBrowser, turkeyRecommendationBrowser } from "./engine-browser.js";

const DAY_MINUTES = 1440;
const STORAGE_KEY = "graybeam_thanksgiving_or_state_v2";
const CHECKED_KEY = "graybeam_thanksgiving_or_checked_v2";
const ITEMS_CHECKED_KEY = "graybeam_thanksgiving_or_items_v1";
const RECIPE_OVERRIDES_KEY = "graybeam_thanksgiving_or_recipes_v1";
const TINKER_SESSION_KEY = "graybeam_tinker_session_key";
const TINKER_PIN_SESSION_KEY = "graybeam_tinker_session_pin";
const TINKER_MODEL_SESSION_KEY = "graybeam_tinker_model";
const DEFAULT_TINKER_MODEL = "thinkingmachines/Inkling-2-Mini";

const DEFAULT_HOST_ESSENTIALS = [
  {
    item: "Double trivets / heavy heat-proof pads",
    note: "Supports a 35–40 lb roasting pan safely on your counter.",
  },
  {
    item: "Large moat carving board + sharp carving knife & fork",
    note: "Catches resting & carving juices cleanly.",
  },
  {
    item: "Fat separator (4-cup)",
    note: "Separates drippings cleanly in 2 minutes for silky pan gravy.",
  },
  {
    item: "Pre-warmed gravy boat & warmed serving platters",
    note: "Fill with hot tap water 5m before serving, then dry.",
  },
  {
    item: "Empty dishwasher before 2:45 PM",
    note: "Keeps the sink clear for the golden turkey-rest sides crunch!",
  },
  {
    item: "Heavy-duty aluminum foil & parchment paper",
    note: "For turkey breast tenting, casserole covers, and sheet pans.",
  },
  {
    item: "KitchenAid oven probe + instant-read thermometer",
    note: "Verify 158°F breast pull → 165°F carryover without guesswork.",
  },
  {
    item: "Extra thick oven mitts / silicone grips & dry towels",
    note: "Wet towels conduct steam — keep 2 dry mitts dedicated to the roaster.",
  },
];

const state = {
  useBrowserSolver: false,
  request: null,
  plan: null,
  quickAddTemplates: {},
  turkeyMethods: {},
  recipes: {},
  recipeOverrides: {},
  hostEssentials: [],
  recipesTab: "recipes", // "recipes" | "gear"
  dayView: "day_of", // "day_of" | "day_before" | "both"
  eventFilter: "all", // "all" | "oven" | "day_before" | "day_of"
  ganttCollapsed: false,
  checkedEvents: new Set(),
  checkedItems: new Set(),
  editingDishId: null,
  editingRecipeDishId: null,
  sousChef: {
    open: false,
    settingsOpen: false,
    mode: "local", // "local" | "byok" | "pin_protected" | "public_free"
    pinRequired: false,
    serverConfigured: false,
    statusChecked: false,
    busy: false,
    model: DEFAULT_TINKER_MODEL,
    pendingImageDataUrl: null,
    pendingImageLabel: "",
    messages: [],
  },
};

// ---------------------------------------------------------------------------
// Time & Real-Clock ("No Time Travel") Helpers
// ---------------------------------------------------------------------------
function safeNum(val, fallback) {
  const n = Number(val);
  return Number.isFinite(n) ? n : fallback;
}

function getDessertReadyMin(k) {
  if (!k) return DAY_MINUTES + 17 * 60;
  const dinner = safeNum(k.dinner_ready_min, DAY_MINUTES + 16 * 60);
  if (typeof k.dessert_ready_min === "number" && Number.isFinite(k.dessert_ready_min)) {
    return k.dessert_ready_min;
  }
  return Math.min(2 * DAY_MINUTES - 5, dinner + safeNum(k.dessert_offset_min, 60));
}

function computeLiveStartMinute() {
  // Maps real browser local time onto Day 0 (Wed / Day Before) or Day 1 (Thu / Thanksgiving)
  // Rounded up to the next 15-minute mark so nothing is ever scheduled in the past!
  const now = new Date();
  const minsOfDay = now.getHours() * 60 + now.getMinutes();
  const rounded = Math.ceil(minsOfDay / 15) * 15;
  const dow = now.getDay(); // 3 = Wed, 4 = Thu
  if (dow === 4) {
    // Today IS Thanksgiving Day!
    return Math.min(2 * DAY_MINUTES - 120, DAY_MINUTES + Math.max(6 * 60, rounded));
  }
  // Evening/day before Thanksgiving (or planning mode): map onto Day 0 (Wed)
  if (rounded >= 22 * 60 + 15) {
    // Past 10:15 PM Wed -> start tomorrow morning Thu 7:00 AM
    return DAY_MINUTES + 7 * 60;
  }
  return Math.max(9 * 60, rounded);
}

function formatLiveHeaderClock(date = new Date()) {
  const weekday = date.toLocaleDateString(undefined, { weekday: "short" });
  const month = date.toLocaleDateString(undefined, { month: "short" });
  const day = date.getDate();
  const time = date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  return `Live Clock: ${weekday} ${month} ${day}, ${time}`;
}

function updateLiveClockBadge() {
  const el = document.getElementById("liveClockLabel");
  if (el) el.textContent = formatLiveHeaderClock(new Date());
}

function formatClock(minute) {
  const safeM = safeNum(minute, 0);
  const m = ((Math.round(safeM) % DAY_MINUTES) + DAY_MINUTES) % DAY_MINUTES;
  const h24 = Math.floor(m / 60);
  const mins = m % 60;
  const period = h24 < 12 ? "AM" : "PM";
  const h12 = h24 % 12 || 12;
  return `${h12}:${String(mins).padStart(2, "0")} ${period}`;
}

function formatDayShort(minute) {
  return safeNum(minute, 0) < DAY_MINUTES ? "Wed" : "Thu";
}

function formatFullTime(minute) {
  return `${formatDayShort(minute)} ${formatClock(minute)}`;
}

function showToast(msg) {
  const el = document.getElementById("toast");
  if (!el) return;
  el.textContent = msg;
  el.classList.remove("hidden");
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => el.classList.add("hidden"), 3200);
}

function escapeHtml(str) {
  return String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// ---------------------------------------------------------------------------
// Persistence & Shareable URL Hash (#plan=...)
// ---------------------------------------------------------------------------
function encodePlanHash(req) {
  const payload = { kitchen: req.kitchen, dishes: req.dishes };
  if (state.recipeOverrides && Object.keys(state.recipeOverrides).length > 0) {
    payload.recipeOverrides = state.recipeOverrides;
  }
  const json = JSON.stringify(payload);
  const bytes = new TextEncoder().encode(json);
  let bin = "";
  bytes.forEach((b) => (bin += String.fromCharCode(b)));
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function decodePlanHash() {
  const hash = window.location.hash || "";
  if (!hash.startsWith("#plan=")) return null;
  try {
    const b64 = hash.slice(6).replace(/-/g, "+").replace(/_/g, "/");
    const bin = atob(b64);
    const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
    const parsed = JSON.parse(new TextDecoder().decode(bytes));
    if (parsed && parsed.kitchen && Array.isArray(parsed.dishes)) return parsed;
  } catch {
    return null;
  }
  return null;
}

function saveLocalState() {
  if (!state.request) return;
  try {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ kitchen: state.request.kitchen, dishes: state.request.dishes })
    );
  } catch {
    // Ignore storage quota errors
  }
}

function loadCheckedEvents() {
  try {
    const raw = localStorage.getItem(CHECKED_KEY);
    if (raw) state.checkedEvents = new Set(JSON.parse(raw));
  } catch {
    state.checkedEvents = new Set();
  }
}

function saveCheckedEvents() {
  try {
    localStorage.setItem(CHECKED_KEY, JSON.stringify([...state.checkedEvents]));
  } catch {
    // Ignore
  }
}

function loadCheckedItems() {
  try {
    const raw = localStorage.getItem(ITEMS_CHECKED_KEY);
    if (raw) state.checkedItems = new Set(JSON.parse(raw));
  } catch {
    state.checkedItems = new Set();
  }
}

function saveCheckedItems() {
  try {
    localStorage.setItem(ITEMS_CHECKED_KEY, JSON.stringify([...state.checkedItems]));
  } catch {
    // Ignore
  }
}

function loadRecipeOverrides() {
  try {
    const raw = localStorage.getItem(RECIPE_OVERRIDES_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        state.recipeOverrides = parsed;
        return;
      }
    }
  } catch {
    // Ignore malformed localStorage
  }
  state.recipeOverrides = {};
}

function saveRecipeOverrides() {
  try {
    if (!state.recipeOverrides || Object.keys(state.recipeOverrides).length === 0) {
      localStorage.removeItem(RECIPE_OVERRIDES_KEY);
    } else {
      localStorage.setItem(RECIPE_OVERRIDES_KEY, JSON.stringify(state.recipeOverrides));
    }
  } catch {
    // Ignore storage quota errors
  }
}

function normalizeRecipesMap(rawRecipes) {
  if (!rawRecipes) return {};
  if (Array.isArray(rawRecipes)) {
    const out = {};
    for (const r of rawRecipes) {
      if (!r || typeof r !== "object") continue;
      const key = r.dish_id || r.id;
      if (key) out[key] = r;
    }
    return out;
  }
  if (typeof rawRecipes === "object") {
    return { ...rawRecipes };
  }
  return {};
}

function ingestRecipesPayload(data) {
  if (!data || typeof data !== "object") return;
  const parsedRecipes = normalizeRecipesMap(data.recipes);
  if (Object.keys(parsedRecipes).length > 0) {
    state.recipes = { ...state.recipes, ...parsedRecipes };
  }
  const rawEssentials = data.host_essentials ?? data.hostEssentials;
  if (Array.isArray(rawEssentials) && rawEssentials.length > 0) {
    state.hostEssentials = rawEssentials;
  }
}

async function ensureRecipesLoaded() {
  if (Object.keys(state.recipes).length > 0 || state.useBrowserSolver) return;
  try {
    const res = await fetch("/api/recipes");
    const ct = (res.headers.get("content-type") || "").toLowerCase();
    if (!res.ok || !ct.includes("application/json")) return;
    const data = await res.json();
    ingestRecipesPayload(data);
  } catch {
    // Graceful fallback when /api/recipes is unavailable
  }
}

async function loadDefaultData() {
  try {
    const res = await fetch("/api/default");
    const ct = (res.headers.get("content-type") || "").toLowerCase();
    if (res.ok && ct.includes("application/json")) {
      const data = await res.json();
      if (data && data.request) {
        state.useBrowserSolver = false;
        return data;
      }
    }
  } catch {
    // Fall through to static ./default-data.json
  }
  state.useBrowserSolver = true;
  const staticRes = await fetch("./default-data.json");
  if (!staticRes.ok) {
    throw new Error(`Could not load ./default-data.json (HTTP ${staticRes.status})`);
  }
  return await staticRes.json();
}

async function fetchTurkeyRecommendation(weightLb, method) {
  if (state.useBrowserSolver) {
    return turkeyRecommendationBrowser(Number(weightLb), method);
  }
  try {
    const res = await fetch(
      `/api/turkey-recommendation?weight_lb=${encodeURIComponent(weightLb)}&method=${encodeURIComponent(method)}`
    );
    const ct = (res.headers.get("content-type") || "").toLowerCase();
    if (res.ok && ct.includes("application/json")) {
      return await res.json();
    }
  } catch {
    // Graceful fallback to local culinary calculation
  }
  return turkeyRecommendationBrowser(Number(weightLb), method);
}

// ---------------------------------------------------------------------------
// API Calls (FastAPI OR-Tools CP-SAT with seamless In-Browser Fallback)
// ---------------------------------------------------------------------------
async function apiSolve(repair = false) {
  const badge = document.getElementById("solverBadge");
  badge.className = "pill pill-neutral";
  badge.textContent = repair ? "⚡ Repairing…" : "⚡ Solving…";

  const payload = structuredClone(state.request);
  // Strip computed field before posting back to Pydantic
  delete payload.kitchen.dessert_ready_min;

  if (repair && state.plan?.tasks?.length) {
    payload.repair_mode = true;
    payload.reference_starts = Object.fromEntries(
      state.plan.tasks.map((t) => [t.id, t.start_min])
    );
  } else {
    payload.repair_mode = false;
    payload.reference_starts = {};
  }

  if (state.useBrowserSolver) {
    state.plan = solveScheduleBrowser(payload);
    saveLocalState();
    renderAll();
    return;
  }

  const endpoint = repair ? "/api/repair" : "/api/solve";
  try {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const ct = (res.headers.get("content-type") || "").toLowerCase();
    if (res.ok && ct.includes("application/json")) {
      state.plan = await res.json();
      saveLocalState();
      renderAll();
      return;
    }
    if (res.status !== 404 && ct.includes("application/json")) {
      showToast("Solver error — check your inputs.");
      return;
    }
  } catch {
    // Fall back seamlessly to local in-browser solver if API is unreachable
  }

  state.useBrowserSolver = true;
  state.plan = solveScheduleBrowser(payload);
  saveLocalState();
  renderAll();
}

async function initApp() {
  updateLiveClockBadge();
  setInterval(updateLiveClockBadge, 30000);

  loadCheckedEvents();
  loadCheckedItems();
  loadRecipeOverrides();
  initSousChefState();
  populateDinnerTimeOptions();
  populateStartFromOptions();
  wireGlobalListeners();
  fetchSousChefStatus();

  const data = await loadDefaultData();
  state.quickAddTemplates = data.quick_add_templates || {};
  state.turkeyMethods = data.turkey_methods || {};
  ingestRecipesPayload(data);
  await ensureRecipesLoaded();

  // Priority: 1) Shared URL hash -> 2) LocalStorage -> 3) Default 25 lb Feast anchored to LIVE CLOCK
  const fromHash = decodePlanHash();
  let saved = null;
  if (!fromHash) {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) saved = JSON.parse(raw);
    } catch {
      saved = null;
    }
  }

  const liveMin = computeLiveStartMinute();

  if (fromHash) {
    state.request = {
      ...data.request,
      kitchen: { recipe_scale: 1, ...data.request.kitchen, ...fromHash.kitchen },
      dishes: fromHash.dishes,
    };
    if (
      fromHash.recipeOverrides &&
      typeof fromHash.recipeOverrides === "object" &&
      !Array.isArray(fromHash.recipeOverrides)
    ) {
      state.recipeOverrides = { ...fromHash.recipeOverrides };
      saveRecipeOverrides();
    }
    showToast("Loaded shared Thanksgiving plan from link!");
    await apiSolve(false);
  } else if (saved && saved.kitchen && Array.isArray(saved.dishes)) {
    const mergedKitchen = { recipe_scale: 1, ...data.request.kitchen, ...saved.kitchen };
    // Ensure saved state from before live-clock support does not silently time-travel
    if (mergedKitchen.earliest_start_min === undefined) {
      mergedKitchen.earliest_start_min = liveMin;
    }
    state.request = { ...data.request, kitchen: mergedKitchen, dishes: saved.dishes };
    if (mergedKitchen.earliest_start_min !== null && mergedKitchen.earliest_start_min < DAY_MINUTES) {
      state.dayView = "both";
    }
    await apiSolve(false);
  } else {
    state.request = data.request;
    if (state.request.kitchen.recipe_scale === undefined) {
      state.request.kitchen.recipe_scale = 1;
    }
    // Anchor to REAL current time so we never travel back in time!
    state.request.kitchen.earliest_start_min = liveMin;
    if (liveMin < DAY_MINUTES) {
      state.dayView = "both";
    }
    await apiSolve(false);
  }
}

// ---------------------------------------------------------------------------
// Controls Population & Rendering
// ---------------------------------------------------------------------------
function populateDinnerTimeOptions() {
  const select = document.getElementById("dinnerTimeSelect");
  select.innerHTML = "";
  for (let m = DAY_MINUTES + 12 * 60; m <= DAY_MINUTES + 21 * 60; m += 15) {
    const opt = document.createElement("option");
    opt.value = String(m);
    opt.textContent = `Thu ${formatClock(m)}`;
    select.appendChild(opt);
  }
}

function populateStartFromOptions() {
  const select = document.getElementById("startFromSelect");
  const liveMin = computeLiveStartMinute();
  const presets = [
    { value: String(liveMin), label: `Now (${formatFullTime(liveMin)})` },
  ];

  // Add upcoming evening slots on Day Before if still before 10:00 PM
  const eveningSlots = [20 * 60, 20 * 60 + 30, 21 * 60, 21 * 60 + 30];
  for (const m of eveningSlots) {
    if (m > liveMin && m < DAY_MINUTES) {
      presets.push({ value: String(m), label: `Tonight ${formatClock(m)}` });
    }
  }

  // Add Thanksgiving morning starts (no cooking tonight!)
  presets.push({ value: String(DAY_MINUTES + 6 * 60), label: "Tomorrow 6:00 AM (All Day-Of)" });
  presets.push({ value: String(DAY_MINUTES + 7 * 60), label: "Tomorrow 7:00 AM (No Tonight)" });
  presets.push({ value: String(DAY_MINUTES + 8 * 60), label: "Tomorrow 8:00 AM" });
  presets.push({ value: "none", label: "Anytime (Full 2-Day Planning)" });

  select.innerHTML = presets
    .map((p) => `<option value="${p.value}">${escapeHtml(p.label)}</option>`)
    .join("");
}

function renderAll() {
  renderControls();
  renderTelemetry();
  renderAlertBanner();
  renderRunSheet();
  renderGantt();
  renderDishList();
  renderAddDishDropdown();
  renderRecipesSection();
}

function formatWeightValue(w) {
  const n = Number(w);
  if (!Number.isFinite(n) || n <= 0) return "25";
  return Number.isInteger(n) ? String(n) : String(Math.round(n * 10) / 10);
}

function syncTurkeyDishName(dish, weightLb) {
  if (!dish) return;
  const wLabel = formatWeightValue(weightLb);
  if (/^\d+(?:\.\d+)?\s*lb\b/i.test(dish.name || "")) {
    dish.name = dish.name.replace(/^\d+(?:\.\d+)?\s*lb\b/i, `${wLabel} lb`);
  } else {
    dish.name = `${wLabel} lb Roasted Turkey`;
  }
}

function renderControls() {
  const k = state.request.kitchen;
  document.getElementById("dinnerTimeSelect").value = String(k.dinner_ready_min);
  document.getElementById("dessertOffsetSelect").value = String(k.dessert_offset_min);
  document.getElementById("cookCountSelect").value = String(k.cook_count);

  const startSel = document.getElementById("startFromSelect");
  const startVal =
    k.earliest_start_min === null || k.earliest_start_min === undefined
      ? "none"
      : String(k.earliest_start_min);
  if (![...startSel.options].some((o) => o.value === startVal)) {
    const opt = document.createElement("option");
    opt.value = startVal;
    opt.textContent = `Custom (${formatFullTime(Number(startVal))})`;
    startSel.prepend(opt);
  }
  startSel.value = startVal;

  document.querySelectorAll("#dinnerQuickChips .chip").forEach((btn) => {
    btn.classList.toggle("active", Number(btn.dataset.min) === k.dinner_ready_min);
  });

  document.querySelectorAll("#dayViewTabs .seg-btn").forEach((b) =>
    b.classList.toggle("active", b.dataset.view === state.dayView)
  );

  const upperBtn = document.getElementById("upperConvectToggle");
  upperBtn.classList.toggle("active", Boolean(k.upper_has_convection));
  upperBtn.setAttribute("aria-pressed", String(Boolean(k.upper_has_convection)));
  document.getElementById("upperConvectLabel").textContent = k.upper_has_convection
    ? "Convect + Air Fry ON"
    : "Microwave Only";

  const turkey = state.request.dishes.find((d) => d.id === "turkey");
  const turkeyWeightSel = document.getElementById("turkeyWeightSelect");
  const feastWeightLabel = document.getElementById("feastWeightLabel");
  const probeSummary = document.getElementById("turkeyProbeSummary");
  if (turkey && turkeyWeightSel) {
    const wVal = formatWeightValue(turkey.turkey_weight_lb || 25);
    if (![...turkeyWeightSel.options].some((o) => Number(o.value) === Number(wVal))) {
      const opt = document.createElement("option");
      opt.value = wVal;
      opt.textContent = `${wVal} lb (Custom)`;
      turkeyWeightSel.appendChild(opt);
    }
    const matchingOpt = [...turkeyWeightSel.options].find((o) => Number(o.value) === Number(wVal));
    if (matchingOpt) turkeyWeightSel.value = matchingOpt.value;
    turkeyWeightSel.disabled = !turkey.enabled;
  }
  if (feastWeightLabel) {
    feastWeightLabel.textContent =
      turkey && turkey.enabled
        ? `${formatWeightValue(turkey.turkey_weight_lb || 25)} lb Feast`
        : "Custom Feast";
  }

  const scaleSel = document.getElementById("recipeScaleSelect");
  if (scaleSel) {
    const scaleVal = safeNum(k.recipe_scale, 1);
    const matchingScale = [...scaleSel.options].find((o) => Math.abs(Number(o.value) - scaleVal) < 0.001);
    if (matchingScale) {
      scaleSel.value = matchingScale.value;
    } else {
      const opt = document.createElement("option");
      opt.value = String(scaleVal);
      opt.textContent = `${scaleVal}× (Custom)`;
      scaleSel.appendChild(opt);
      scaleSel.value = opt.value;
    }
  }

  if (turkey && turkey.enabled) {
    const methodLabel =
      turkey.turkey_method === "spatchcock"
        ? "Kenji Spatchcock"
        : turkey.turkey_method === "standard_roast"
        ? "Standard Roast"
        : "Convect Roast";
    probeSummary.textContent = `${formatWeightValue(turkey.turkey_weight_lb || 25)} lb ${methodLabel} · ${turkey.temp_f}°F · ${turkey.cook_min}m · Pull ${turkey.probe_pull_f || 158}°F → ${turkey.probe_target_f || 165}°F`;
  } else {
    probeSummary.textContent = "Turkey disabled in menu";
  }

  const anyLocked = state.request.dishes.some(
    (d) => d.locked_cook_start_min !== null && d.locked_cook_start_min !== undefined
  );
  document.getElementById("clearLocksBtn").classList.toggle("hidden", !anyLocked);
}

function renderTelemetry() {
  const plan = state.plan;
  const solverBadge = document.getElementById("solverBadge");
  const validatorBadge = document.getElementById("validatorBadge");

  if (!plan) return;

  if (plan.status === "optimal" || plan.status === "feasible") {
    const engineTag = state.useBrowserSolver ? "LOCAL-OR" : "CP-SAT";
    const label = plan.status === "optimal" ? `${engineTag} OPTIMAL` : `${engineTag} FEASIBLE`;
    const repairTag =
      plan.repair_summary && plan.repair_summary.tasks_shifted !== undefined
        ? ` · Repaired (${plan.repair_summary.tasks_shifted} shifted)`
        : "";
    solverBadge.className = "pill pill-neutral";
    solverBadge.textContent = `⚡ ${label} · ${plan.solve_ms}ms${repairTag}`;
  } else {
    solverBadge.className = "pill pill-danger";
    solverBadge.textContent = `✕ INFEASIBLE · ${plan.solve_ms}ms`;
  }

  if (plan.validation) {
    const passed = plan.validation.checks.filter((c) => c.passed).length;
    const total = plan.validation.checks.length;
    if (plan.validation.valid) {
      validatorBadge.className = "pill pill-success pill-btn";
      validatorBadge.textContent = `✓ ${passed}/${total} Invariants Verified`;
    } else {
      validatorBadge.className = "pill pill-danger pill-btn";
      validatorBadge.textContent = `⚠ ${passed}/${total} Invariants Passed`;
    }
  } else {
    validatorBadge.className = "pill pill-warning pill-btn";
    validatorBadge.textContent = "⚠ No Feasible Plan";
  }
}

function renderAlertBanner() {
  const banner = document.getElementById("alertBanner");
  const plan = state.plan;
  if (!plan) return;

  if (plan.status === "infeasible" || plan.status === "invalid_input") {
    banner.className = "alert-banner error";
    const items = (plan.diagnostics || []).map((d) => `<li>${escapeHtml(d)}</li>`).join("");
    banner.innerHTML = `
      <div>
        <strong>CP-SAT Proved This Combination Infeasible (Locks Never Silently Relaxed):</strong>
        <ul>${items}</ul>
      </div>
      <button class="btn btn-sm" id="autoFixPiesBtn" type="button">Fix Automatically</button>
    `;
    banner.classList.remove("hidden");
    document.getElementById("autoFixPiesBtn")?.addEventListener("click", async () => {
      state.request.dishes.forEach((d) => {
        d.locked_cook_start_min = null;
        if (d.id === "sweet_potato_pie" || d.id === "pumpkin_pie") d.day_preference = "any";
      });
      if (state.request.kitchen.earliest_start_min >= DAY_MINUTES) {
        state.request.kitchen.day_of_start_min = DAY_MINUTES + 6 * 60;
        state.request.kitchen.earliest_start_min = DAY_MINUTES + 6 * 60;
      }
      await apiSolve(false);
      showToast("Unlocked & restored feasible optimal plan!");
    });
    return;
  }

  if (plan.repair_summary && plan.repair_summary.tasks_shifted !== undefined) {
    banner.className = "alert-banner info";
    banner.innerHTML = `
      <div>
        <strong>Minimal-Disruption CP-SAT Repair Complete:</strong>
        Shifted <strong>${plan.repair_summary.tasks_shifted}</strong> step(s) (${plan.repair_summary.total_shift_min} total min) around your pinned lock(s). Dinner Ready-By still holds at <strong>Thu ${formatClock(state.request.kitchen.dinner_ready_min)}</strong>!
      </div>
      <button class="btn btn-sm" id="dismissRepairBanner" type="button">Dismiss</button>
    `;
    banner.classList.remove("hidden");
    document.getElementById("dismissRepairBanner")?.addEventListener("click", () => {
      banner.classList.add("hidden");
    });
    return;
  }

  banner.classList.add("hidden");
}

// ---------------------------------------------------------------------------
// PRIMARY HERO: What To Do When — Step-by-Step Kitchen Timeline
// ---------------------------------------------------------------------------
function classifyPhase(ev, plan, kitchen) {
  if (ev.day === 0) {
    return { id: "tonight", label: "🌙 Tonight (Wed Evening)" };
  }
  const restStart =
    Array.isArray(plan?.turkey_rest_window) && Number.isFinite(plan.turkey_rest_window[0])
      ? plan.turkey_rest_window[0]
      : safeNum(kitchen?.dinner_ready_min, DAY_MINUTES + 16 * 60) - 75;
  const dinnerMin = safeNum(kitchen?.dinner_ready_min, DAY_MINUTES + 16 * 60);

  if (ev.minute < restStart) {
    return { id: "thu_morning", label: "🌅 Thanksgiving Morning & Turkey Roast" };
  }
  if (ev.minute < dinnerMin) {
    return { id: "rest_crunch", label: "✨ Golden Turkey Rest Window (Sides Crunch Time)" };
  }
  return { id: "dinner_dessert", label: "🍽️ Dinner & Warm Dessert" };
}

function renderAppliancePill(ev) {
  const k = state.request?.kitchen;
  const tempSuffix = ev.temp_f ? ` ${ev.temp_f}°F` : "";

  if (ev.event_type === "serve") {
    return `<span class="res-badge res-badge-serve">🍽️ Serve Table</span>`;
  }
  if (ev.resource === "main_oven") {
    return `<span class="res-badge res-badge-oven">🔥 Main Oven${tempSuffix}</span>`;
  }
  if (ev.resource === "upper_combo") {
    const modeLabel =
      k && !k.upper_has_convection
        ? "Upper Micro"
        : ev.dish_id === "green_beans" || (ev.temp_f && ev.temp_f >= 360)
        ? "Upper Air Fry"
        : "Upper Combo";
    return `<span class="res-badge res-badge-upper">✨ ${modeLabel}${tempSuffix}</span>`;
  }
  if (ev.resource === "stovetop") {
    return `<span class="res-badge res-badge-stove">🍳 Stovetop</span>`;
  }
  if (ev.resource === "fridge") {
    return `<span class="res-badge res-badge-fridge">❄️ Fridge</span>`;
  }
  return `<span class="res-badge res-badge-prep">🔪 Counter</span>`;
}

function eventKey(ev) {
  return `${ev.day}_${ev.event_type}_${ev.dish_id || "milestone"}_${ev.title}`;
}

function renderRunSheet() {
  const feed = document.getElementById("eventFeed");
  const nextCard = document.getElementById("nextUpCard");
  const countPill = document.getElementById("runsheetCountPill");
  const allEvents = state.plan?.events || [];
  const k = state.request.kitchen;

  // Assign global step numbers (#1 .. #N) in strict chronological order
  const numbered = allEvents.map((ev, idx) => ({ ...ev, stepNum: idx + 1, key: eventKey(ev) }));

  const doneCount = numbered.filter((ev) => state.checkedEvents.has(ev.key)).length;
  const pctDone = numbered.length ? Math.round((doneCount / numbered.length) * 100) : 0;
  countPill.textContent = `${numbered.length} steps`;
  document.getElementById("runsheetProgress").textContent =
    numbered.length > 0
      ? `Chronological run sheet · ${doneCount} of ${numbered.length} completed (${pctDone}%)`
      : "No feasible steps yet — adjust constraints above.";
  document.getElementById("progressBarFill").style.width = `${pctDone}%`;

  // DO THIS NEXT Spotlight (first unchecked step!)
  const nextEv = numbered.find((ev) => !state.checkedEvents.has(ev.key));
  if (nextEv) {
    nextCard.className = "next-up-card";
    nextCard.innerHTML = `
      <div class="next-up-main">
        <div class="next-up-meta">
          <span class="next-up-kicker">▶ DO THIS NEXT · Step #${nextEv.stepNum}</span>
          <span class="next-up-time">${nextEv.day === 0 ? "Tonight (Wed)" : "Thanksgiving (Thu)"} · ${escapeHtml(nextEv.clock_label)}</span>
          ${renderAppliancePill(nextEv)}
        </div>
        <div class="next-up-title">${escapeHtml(nextEv.title)}</div>
        <div class="next-up-detail">${escapeHtml(nextEv.detail)}</div>
      </div>
      <button id="markNextDoneBtn" class="btn btn-primary" type="button">✓ Mark Done</button>
    `;
    document.getElementById("markNextDoneBtn")?.addEventListener("click", () => {
      state.checkedEvents.add(nextEv.key);
      saveCheckedEvents();
      renderRunSheet();
    });
  } else if (numbered.length > 0) {
    nextCard.className = "next-up-card is-complete";
    nextCard.innerHTML = `
      <div class="next-up-main">
        <div class="next-up-meta">
          <span class="next-up-kicker">✓ FEAST COMPLETE</span>
        </div>
        <div class="next-up-title">All ${numbered.length} kitchen steps checked off — Happy Thanksgiving!</div>
      </div>
      <button id="resetChecksBtn" class="btn btn-secondary btn-sm" type="button">↺ Reset Checklist</button>
    `;
    document.getElementById("resetChecksBtn")?.addEventListener("click", () => {
      state.checkedEvents.clear();
      saveCheckedEvents();
      renderRunSheet();
    });
  } else {
    nextCard.className = "next-up-card hidden";
  }

  const filtered = numbered.filter((ev) => {
    if (state.eventFilter === "oven") {
      return ev.resource === "main_oven" || ev.resource === "upper_combo" || ev.event_type === "serve";
    }
    if (state.eventFilter === "day_before") return ev.day === 0;
    if (state.eventFilter === "day_of") return ev.day >= 1;
    return true;
  });

  if (!filtered.length) {
    feed.innerHTML = `<li class="muted small" style="padding:18px;text-align:center">No steps match this filter view.</li>`;
    return;
  }

  // Group by phase to show accurate step counts in each phase header
  const groups = [];
  for (const ev of filtered) {
    const phase = classifyPhase(ev, state.plan, k);
    const last = groups[groups.length - 1];
    if (!last || last.id !== phase.id) {
      groups.push({ ...phase, items: [ev] });
    } else {
      last.items.push(ev);
    }
  }

  let html = "";
  for (const group of groups) {
    html += `
      <li class="phase-header phase-${group.id}">
        <span>${escapeHtml(group.label)}</span>
        <span class="phase-count">${group.items.length} ${group.items.length === 1 ? "step" : "steps"}</span>
      </li>`;

    for (const ev of group.items) {
      const checked = state.checkedEvents.has(ev.key);
      const isNext = nextEv && nextEv.key === ev.key;
      html += `
        <li class="event-item ev-${escapeHtml(ev.event_type)} ${checked ? "done" : ""} ${isNext ? "is-next" : ""}">
          <input type="checkbox" class="event-check" data-ev-key="${escapeHtml(ev.key)}" ${checked ? "checked" : ""} aria-label="Mark step ${ev.stepNum} done" />
          <span class="step-num">#${ev.stepNum}</span>
          <div class="event-time">
            ${escapeHtml(ev.clock_label)}
            <span class="event-day-tag">${ev.day === 0 ? "Tonight" : "Thu"}</span>
          </div>
          <div class="event-app-col">${renderAppliancePill(ev)}</div>
          <div class="event-body">
            <div class="event-title">${escapeHtml(ev.title)}</div>
            <div class="event-detail">${escapeHtml(ev.detail)}</div>
          </div>
        </li>`;
    }
  }

  feed.innerHTML = html;

  feed.querySelectorAll(".event-check").forEach((cb) => {
    cb.addEventListener("change", (e) => {
      const key = e.target.dataset.evKey;
      if (e.target.checked) state.checkedEvents.add(key);
      else state.checkedEvents.delete(key);
      saveCheckedEvents();
      renderRunSheet();
    });
  });
}

// ---------------------------------------------------------------------------
// Appliance Swimlane Gantt Chart (NaN-Proof Bounds & Crisp Visible Bars)
// ---------------------------------------------------------------------------
function getTimelineBounds() {
  const k = state.request.kitchen || {};
  const dessertReady = getDessertReadyMin(k);
  const dayBeforeStart = safeNum(k.day_before_start_min, 9 * 60);
  const dayBeforeEnd = safeNum(k.day_before_end_min, 23 * 60 + 30);
  const dayOfStart = safeNum(k.day_of_start_min, DAY_MINUTES + 7 * 60);
  const earliest =
    k.earliest_start_min !== null && k.earliest_start_min !== undefined && Number.isFinite(Number(k.earliest_start_min))
      ? Number(k.earliest_start_min)
      : null;

  const tasks = (state.plan?.tasks || []).filter(
    (t) => Number.isFinite(t.start_min) && Number.isFinite(t.end_min) && t.end_min > t.start_min
  );

  if (state.dayView === "day_before") {
    const wedTasks = tasks.filter((t) => t.start_min < DAY_MINUTES);
    const startCandidates = wedTasks.map((t) => t.start_min);
    if (earliest !== null && earliest < DAY_MINUTES) startCandidates.push(earliest);
    const minS = startCandidates.length ? Math.min(...startCandidates) : dayBeforeStart;

    const endCandidates = wedTasks.map((t) => Math.min(DAY_MINUTES, t.end_min));
    const maxE = endCandidates.length ? Math.max(...endCandidates) : dayBeforeEnd;

    const start = Math.max(0, Math.floor((minS - 30) / 60) * 60);
    const end = Math.min(DAY_MINUTES, Math.max(start + 180, Math.ceil((maxE + 30) / 60) * 60));
    return { start, end: Math.max(start + 60, end), step: 60 };
  }

  if (state.dayView === "day_of") {
    const thuTasks = tasks.filter((t) => t.end_min > DAY_MINUTES && t.resource !== "fridge");
    const minS = thuTasks.length
      ? Math.min(...thuTasks.map((t) => Math.max(DAY_MINUTES, t.start_min)))
      : dayOfStart;
    const maxE = Math.max(dessertReady + 30, ...thuTasks.map((t) => t.end_min));
    const start = Math.max(DAY_MINUTES, Math.floor((minS - 30) / 60) * 60);
    const end = Math.min(2 * DAY_MINUTES, Math.max(start + 300, Math.ceil((maxE + 15) / 60) * 60));
    return { start, end: Math.max(start + 120, end), step: 60 };
  }

  // Both days (48h view starting cleanly near earliest_start_min or first scheduled task)
  const startCandidates = tasks.map((t) => t.start_min);
  if (earliest !== null) startCandidates.push(earliest);
  const minS = startCandidates.length ? Math.min(...startCandidates) : dayBeforeStart;
  const maxE = Math.max(dessertReady + 30, ...tasks.map((t) => t.end_min));
  const start = Math.max(0, Math.floor((minS - 30) / 60) * 60);
  const end = Math.min(2 * DAY_MINUTES, Math.max(start + 360, Math.ceil((maxE + 30) / 60) * 60));
  const spanHrs = (end - start) / 60;
  return { start, end: Math.max(start + 120, end), step: spanHrs > 18 ? 180 : 120 };
}

function packRows(tasks) {
  const rows = [];
  const sorted = [...tasks].sort((a, b) => a.start_min - b.start_min || b.duration_min - a.duration_min);
  for (const t of sorted) {
    let placed = false;
    for (const row of rows) {
      if (row[row.length - 1].end_min <= t.start_min) {
        row.push(t);
        placed = true;
        break;
      }
    }
    if (!placed) rows.push([t]);
  }
  return rows;
}

function renderGantt() {
  const container = document.getElementById("ganttContainer");
  const plan = state.plan;
  if (!plan || !plan.tasks || plan.tasks.length === 0) {
    container.innerHTML = `<div style="padding:28px;text-align:center;color:var(--muted)">No feasible schedule to display. Adjust constraints above or click Fix Automatically.</div>`;
    return;
  }

  const { start, end, step } = getTimelineBounds();
  const span = Math.max(60, end - start);
  const pct = (m) => {
    const val = ((safeNum(m, start) - start) / span) * 100;
    return Number.isFinite(val) ? Math.max(0, Math.min(100, val)) : 0;
  };

  const k = state.request.kitchen;
  const dinnerMin = safeNum(k.dinner_ready_min, DAY_MINUTES + 16 * 60);
  const dessertReady = getDessertReadyMin(k);
  const startFloor =
    k.earliest_start_min !== null && k.earliest_start_min !== undefined && Number.isFinite(Number(k.earliest_start_min))
      ? Number(k.earliest_start_min)
      : null;

  // Axis ticks
  let ticksHtml = "";
  for (let m = start; m <= end; m += step) {
    const left = pct(m);
    if (left > 96) continue;
    const lbl = state.dayView === "both" ? `${formatDayShort(m)} ${formatClock(m)}` : formatClock(m);
    ticksHtml += `<div class="gantt-tick" style="left:${left.toFixed(3)}%">${lbl}</div>`;
  }

  // Anchor flags on axis
  let axisFlags = "";
  if (startFloor !== null && startFloor >= start && startFloor <= end) {
    const flagLeft = Math.max(5, Math.min(93, pct(startFloor)));
    axisFlags += `<div class="anchor-flag now" style="left:${flagLeft.toFixed(3)}%">📍 Start Now ${formatClock(startFloor)}</div>`;
  }
  if (dinnerMin >= start && dinnerMin <= end) {
    const flagLeft = Math.max(5, Math.min(93, pct(dinnerMin)));
    axisFlags += `<div class="anchor-flag dinner" style="left:${flagLeft.toFixed(3)}%">🍽️ Dinner ${formatClock(dinnerMin)}</div>`;
  }
  if (dessertReady >= start && dessertReady <= end) {
    const flagLeft = Math.max(5, Math.min(94, pct(dessertReady)));
    axisFlags += `<div class="anchor-flag dessert" style="left:${flagLeft.toFixed(3)}%">🥧 Dessert ${formatClock(dessertReady)}</div>`;
  }

  const lanes = [
    {
      id: "main_oven",
      title: "🔥 Main Oven",
      sub: `KitchenAid Lower · ${k.main_oven_racks} Racks`,
      match: (t) => t.resource === "main_oven",
    },
    {
      id: "upper_combo",
      title: "✨ Upper Combo",
      sub: k.upper_has_convection ? "Air Fry / Convect / Micro" : "Microwave Only",
      match: (t) => t.resource === "upper_combo",
    },
    {
      id: "stovetop",
      title: "🍳 Stovetop",
      sub: `${k.stovetop_burners} Burners`,
      match: (t) => t.resource === "stovetop",
    },
    {
      id: "prep",
      title: "🔪 Prep, Rest & Chill",
      sub: `${k.cook_count} Cook(s) · Counter & Fridge`,
      match: (t) => t.resource === "counter" || t.resource === "fridge",
    },
  ];

  const restWin =
    Array.isArray(plan.turkey_rest_window) &&
    Number.isFinite(plan.turkey_rest_window[0]) &&
    Number.isFinite(plan.turkey_rest_window[1])
      ? plan.turkey_rest_window
      : null;

  let lanesHtml = "";

  for (const lane of lanes) {
    const laneTasks = plan.tasks.filter(
      (t) =>
        lane.match(t) &&
        Number.isFinite(t.start_min) &&
        Number.isFinite(t.end_min) &&
        t.end_min > start &&
        t.start_min < end
    );
    const rows = packRows(laneTasks);
    const rowHeight = 42;
    const trackHeight = Math.max(60, rows.length * rowHeight + 18);

    let gridlines = "";
    for (let m = start; m <= end; m += step) {
      gridlines += `<div class="lane-gridline" style="left:${pct(m).toFixed(3)}%"></div>`;
    }

    // Golden Turkey Rest Window highlight inside Main Oven lane
    let restBand = "";
    if (lane.id === "main_oven" && restWin && restWin[1] > start && restWin[0] < end) {
      const rLeft = pct(Math.max(start, restWin[0]));
      const rRight = pct(Math.min(end, restWin[1]));
      if (rRight > rLeft + 0.8) {
        restBand = `
          <div class="rest-window-band" style="left:${rLeft.toFixed(3)}%;width:${(rRight - rLeft).toFixed(3)}%">
            <span class="rest-window-tag">✨ Golden Turkey Rest (Oven Free!)</span>
          </div>`;
      }
    }

    let anchorLines = "";
    if (startFloor !== null && startFloor >= start && startFloor <= end) {
      anchorLines += `<div class="anchor-line now" style="left:${pct(startFloor).toFixed(3)}%"></div>`;
    }
    if (dinnerMin >= start && dinnerMin <= end) {
      anchorLines += `<div class="anchor-line dinner" style="left:${pct(dinnerMin).toFixed(3)}%"></div>`;
    }
    if (dessertReady >= start && dessertReady <= end) {
      anchorLines += `<div class="anchor-line dessert" style="left:${pct(dessertReady).toFixed(3)}%"></div>`;
    }

    let barsHtml = "";
    rows.forEach((row, rIdx) => {
      row.forEach((t) => {
        const clampedStart = Math.max(start, t.start_min);
        const clampedEnd = Math.min(end, t.end_min);
        const left = pct(clampedStart);
        const rawWidth = pct(clampedEnd) - left;
        const width = Math.min(Math.max(0.5, 100 - left), Math.max(2.4, rawWidth));
        const top = 11 + rIdx * rowHeight;
        const lockIcon = t.locked ? "🔒 " : "";
        const shiftText = t.shifted_min ? ` (${t.shifted_min > 0 ? "+" : ""}${t.shifted_min}m)` : "";
        const tempBadge = t.temp_f ? `<span class="temp-pill">${t.temp_f}°F</span>` : "";

        barsHtml += `
          <div class="task-bar res-${escapeHtml(t.resource)} kind-${escapeHtml(t.kind)} ${t.locked ? "is-locked" : ""} ${t.shifted_min ? "is-shifted" : ""}"
               style="left:${left.toFixed(3)}%;width:${width.toFixed(3)}%;top:${top}px"
               data-task-id="${escapeHtml(t.id)}"
               data-dish-id="${escapeHtml(t.dish_id)}">
            <span class="task-bar-text">${lockIcon}${escapeHtml(t.emoji)} ${escapeHtml(t.label)}${escapeHtml(shiftText)}</span>
            ${tempBadge}
          </div>`;
      });
    });

    lanesHtml += `
      <div class="gantt-lane">
        <div class="lane-label">
          <div class="lane-title">${lane.title}</div>
          <div class="lane-sub">${lane.sub}</div>
        </div>
        <div class="lane-track" style="height:${trackHeight}px">
          ${gridlines}
          ${restBand}
          ${anchorLines}
          ${barsHtml}
        </div>
      </div>`;
  }

  container.innerHTML = `
    <div class="gantt-inner">
      <div class="gantt-axis">
        <div class="gantt-axis-label">Appliance Lane</div>
        <div class="gantt-ticks">${ticksHtml}${axisFlags}</div>
      </div>
      ${lanesHtml}
    </div>`;

  // Wire bar clicks & hover tooltips
  const tooltip = document.getElementById("ganttTooltip");
  const taskMap = Object.fromEntries(plan.tasks.map((t) => [t.id, t]));

  container.querySelectorAll(".task-bar").forEach((bar) => {
    bar.addEventListener("click", () => openDishDrawer(bar.dataset.dishId));
    bar.addEventListener("mouseenter", (e) => {
      const t = taskMap[bar.dataset.taskId];
      if (!t) return;
      const tempLine = t.temp_f ? ` · <strong>${t.temp_f}°F</strong>` : "";
      const shiftLine = t.shifted_min
        ? `<div style="color:#f5b942;margin-top:4px">Repair shift: ${t.shifted_min > 0 ? "+" : ""}${t.shifted_min} min</div>`
        : "";
      tooltip.innerHTML = `
        <div style="font-weight:700;margin-bottom:3px">${escapeHtml(t.emoji)} ${escapeHtml(t.label)}</div>
        <div style="font-family:var(--mono);font-size:11px;opacity:0.9">${formatFullTime(t.start_min)} → ${formatClock(t.end_min)} (${t.duration_min}m)${tempLine}</div>
        ${shiftLine}
        ${t.tip ? `<div style="margin-top:5px;opacity:0.85;line-height:1.35">${escapeHtml(t.tip)}</div>` : ""}
        <div style="margin-top:5px;font-size:10px;opacity:0.65">Click to edit temp, duration or lock</div>
      `;
      tooltip.classList.remove("hidden");
      positionTooltip(e);
    });
    bar.addEventListener("mousemove", positionTooltip);
    bar.addEventListener("mouseleave", () => tooltip.classList.add("hidden"));
  });
}

function positionTooltip(e) {
  const tt = document.getElementById("ganttTooltip");
  const x = Math.min(window.innerWidth - tt.offsetWidth - 16, e.clientX + 14);
  const y = Math.min(window.innerHeight - tt.offsetHeight - 16, e.clientY + 14);
  tt.style.left = `${Math.max(12, x)}px`;
  tt.style.top = `${Math.max(12, y)}px`;
}

// ---------------------------------------------------------------------------
// Menu & Dish Cards
// ---------------------------------------------------------------------------
function renderDishList() {
  const list = document.getElementById("dishList");
  const tasksByDish = {};
  (state.plan?.tasks || []).forEach((t) => {
    if (t.is_primary_cook) tasksByDish[t.dish_id] = t;
  });

  list.innerHTML = state.request.dishes
    .map((dish) => {
      const solved = tasksByDish[dish.id];
      const res = solved ? solved.resource : dish.appliance;
      const resTagClass =
        res === "main_oven" ? "tag-oven" : res === "upper_combo" ? "tag-upper" : "tag-stove";
      const resLabel =
        res === "main_oven"
          ? `Main Oven${dish.temp_f ? " " + dish.temp_f + "°F" : ""}`
          : res === "upper_combo"
          ? `Upper Combo${dish.temp_f ? " " + dish.temp_f + "°F" : ""}`
          : "Stovetop";
      const whenLabel = solved
        ? `${formatFullTime(solved.start_min)} (${solved.duration_min}m)`
        : dish.enabled
        ? `${dish.cook_min}m`
        : "Disabled";
      const lockBadge =
        dish.locked_cook_start_min !== null && dish.locked_cook_start_min !== undefined
          ? `<span class="tag tag-lock">🔒 Pinned</span>`
          : "";

      return `
        <div class="dish-card ${dish.enabled ? "" : "disabled"}" data-dish-id="${escapeHtml(dish.id)}">
          <div class="dish-left">
            <div class="dish-emoji">${escapeHtml(dish.emoji)}</div>
            <div class="dish-info">
              <div class="dish-name">${escapeHtml(dish.name)} ${lockBadge}</div>
              <div class="dish-meta">
                <span>${escapeHtml(whenLabel)}</span>
                ${dish.rest_min ? `<span>· Rest/Cool ${dish.rest_min}m</span>` : ""}
              </div>
            </div>
          </div>
          <div class="dish-right">
            <span class="tag ${resTagClass}">${escapeHtml(resLabel)}</span>
            <input type="checkbox" class="dish-enable-toggle" data-dish-id="${escapeHtml(dish.id)}" ${dish.enabled ? "checked" : ""} title="Include dish in schedule" />
          </div>
        </div>`;
    })
    .join("");

  list.querySelectorAll(".dish-card").forEach((card) => {
    card.addEventListener("click", (e) => {
      if (e.target.classList.contains("dish-enable-toggle")) return;
      openDishDrawer(card.dataset.dishId);
    });
  });

  list.querySelectorAll(".dish-enable-toggle").forEach((cb) => {
    cb.addEventListener("change", async (e) => {
      const dish = state.request.dishes.find((d) => d.id === e.target.dataset.dishId);
      if (!dish) return;
      dish.enabled = e.target.checked;
      await apiSolve(false);
    });
  });
}

function renderAddDishDropdown() {
  const menu = document.getElementById("addDishMenu");
  const existingIds = new Set(state.request.dishes.map((d) => d.id));
  const items = Object.entries(state.quickAddTemplates)
    .filter(([, tpl]) => !existingIds.has(tpl.id))
    .map(
      ([key, tpl]) =>
        `<button class="dropdown-item" type="button" data-tpl="${escapeHtml(key)}">${escapeHtml(tpl.emoji)} ${escapeHtml(tpl.name)}</button>`
    )
    .join("");

  menu.innerHTML = `
    ${items}
    <button class="dropdown-item" type="button" data-tpl="__custom">➕ Custom Dish…</button>
  `;

  menu.querySelectorAll(".dropdown-item").forEach((btn) => {
    btn.addEventListener("click", async () => {
      menu.classList.add("hidden");
      const key = btn.dataset.tpl;
      if (key === "__custom") {
        const customId = `custom_${Date.now().toString(36)}`;
        const newDish = {
          id: customId,
          name: "Custom Side Dish",
          emoji: "🥘",
          category: "side",
          enabled: true,
          appliance: "main_oven",
          temp_f: 350,
          prep_min: 15,
          cook_min: 30,
          rest_min: 0,
          racks: 1,
          day_preference: "day_of",
          anchor: "dinner",
          max_hold_min: 20,
          requires_chill_min: 0,
          temper_min: 0,
          reheat_min: 0,
          carve_min: 0,
          make_ahead_prep_ok: true,
          technique_note: "Customize oven temp, cook duration, and appliance!",
          locked_cook_start_min: null,
        };
        state.request.dishes.push(newDish);
        await apiSolve(false);
        openDishDrawer(customId);
      } else {
        const tpl = structuredClone(state.quickAddTemplates[key]);
        state.request.dishes.push(tpl);
        await apiSolve(false);
        showToast(`Added ${tpl.emoji} ${tpl.name}!`);
      }
    });
  });
}

// ---------------------------------------------------------------------------
// Recipes, Smart Culinary Scaling & In-App Recipe Editor (#recipesSection)
// ---------------------------------------------------------------------------
const UNICODE_FRAC_MAP = {
  "⅛": 0.125,
  "¼": 0.25,
  "⅓": 1 / 3,
  "⅜": 0.375,
  "½": 0.5,
  "⅝": 0.625,
  "⅔": 2 / 3,
  "¾": 0.75,
  "⅞": 0.875,
};

const CULINARY_NUM_SRC = "(?:\\d+\\s+\\d+\\/\\d+|\\d+\\/\\d+|\\d+\\s*[⅛¼⅓⅜½⅝⅔¾⅞]|[⅛¼⅓⅜½⅝⅔¾⅞]|\\d+(?:\\.\\d+)?)";

function parseCulinaryNumber(token) {
  const s = String(token || "").trim();
  if (!s) return NaN;

  // Mixed ASCII fraction: "1 1/2"
  const mixedAscii = s.match(/^(\d+)\s+(\d+)\/(\d+)$/);
  if (mixedAscii) {
    const denom = Number(mixedAscii[3]);
    return denom ? Number(mixedAscii[1]) + Number(mixedAscii[2]) / denom : NaN;
  }

  // ASCII fraction: "3/4"
  const pureAscii = s.match(/^(\d+)\/(\d+)$/);
  if (pureAscii) {
    const denom = Number(pureAscii[2]);
    return denom ? Number(pureAscii[1]) / denom : NaN;
  }

  // Mixed Unicode fraction: "1½" or "1 ½"
  const mixedUni = s.match(/^(\d+)\s*([⅛¼⅓⅜½⅝⅔¾⅞])$/);
  if (mixedUni) {
    return Number(mixedUni[1]) + (UNICODE_FRAC_MAP[mixedUni[2]] || 0);
  }

  // Pure Unicode fraction: "¾"
  if (Object.prototype.hasOwnProperty.call(UNICODE_FRAC_MAP, s)) {
    return UNICODE_FRAC_MAP[s];
  }

  const num = Number(s);
  return Number.isFinite(num) ? num : NaN;
}

function formatCulinaryNumber(value) {
  if (!Number.isFinite(value) || value <= 0) return "0";
  if (value >= 12) {
    return String(Math.round(value));
  }
  const whole = Math.floor(value);
  const rem = value - whole;
  const candidates =
    whole >= 1
      ? [
          [0, ""],
          [0.25, "¼"],
          [1 / 3, "⅓"],
          [0.5, "½"],
          [2 / 3, "⅔"],
          [0.75, "¾"],
          [1, "__UP__"],
        ]
      : [
          [0, ""],
          [0.125, "⅛"],
          [0.25, "¼"],
          [1 / 3, "⅓"],
          [0.5, "½"],
          [2 / 3, "⅔"],
          [0.75, "¾"],
          [1, "__UP__"],
        ];

  let best = candidates[0];
  let bestDiff = Infinity;
  for (const cand of candidates) {
    const diff = Math.abs(rem - cand[0]);
    if (diff < bestDiff) {
      bestDiff = diff;
      best = cand;
    }
  }

  let outWhole = whole;
  let frac = best[1];
  if (frac === "__UP__") {
    outWhole += 1;
    frac = "";
  }
  if (outWhole === 0 && !frac) {
    return "⅛";
  }
  if (outWhole > 0 && frac) {
    return `${outWhole}${frac}`;
  }
  return outWhole > 0 ? String(outWhole) : frac;
}

function formatScaleMultiplier(scale) {
  const s = safeNum(scale, 1);
  if (Math.abs(s - 0.5) < 0.01) return "0.5×";
  if (Math.abs(s - 0.75) < 0.01) return "0.75×";
  if (Math.abs(s - 1.5) < 0.01) return "1.5×";
  if (Math.abs(s - 2) < 0.01) return "2×";
  return `${Math.round(s * 100) / 100}×`;
}

function fixLeadingUnitPlural(scaledVal, rest) {
  const isSingular = Math.abs(scaledVal - 1) < 0.01 || scaledVal < 1;
  const pluralPairs = [
    ["cups", "cup"],
    ["cans", "can"],
    ["bags", "bag"],
    ["sticks", "stick"],
    ["cloves", "clove"],
    ["stalks", "stalk"],
    ["sprigs", "sprig"],
    ["leaves", "leaf"],
    ["heads", "head"],
  ];
  for (const [pl, sg] of pluralPairs) {
    const rePl = new RegExp(`^(\\s+(?:\\([^)]*\\)\\s+)?)${pl}\\b`, "i");
    const reSg = new RegExp(`^(\\s+(?:\\([^)]*\\)\\s+)?)${sg}\\b`, "i");
    if (isSingular && rePl.test(rest)) {
      return rest.replace(rePl, `$1${sg}`);
    }
    if (!isSingular && scaledVal > 1.05 && reSg.test(rest)) {
      return rest.replace(reSg, `$1${pl}`);
    }
  }
  return rest;
}

function scaleCulinaryToken(token, factor) {
  const n = parseCulinaryNumber(token);
  if (!Number.isFinite(n) || n <= 0) return token;
  return formatCulinaryNumber(n * factor);
}

export function scaleIngredientLine(line, scale = 1, turkeyWeightLb = 25, dishId = "") {
  const raw = String(line || "").trim();
  if (!raw) return "";

  const w = Number.isFinite(Number(turkeyWeightLb)) && Number(turkeyWeightLb) > 0 ? Number(turkeyWeightLb) : 25;
  const wStr = formatWeightValue(w);

  // Special turkey handling: dynamically reflect bird weight & dry-brine kosher salt (weight / 4 tbsp)
  if (dishId === "turkey") {
    if (/whole\s+turkey/i.test(raw)) {
      if (/^1\s+whole\s+turkey\s*\([^)]*lb[^)]*\)/i.test(raw)) {
        return raw.replace(/^1\s+whole\s+turkey\s*\([^)]*lb[^)]*\)/i, `${wStr} lb whole turkey`);
      }
      if (/^\d+(?:\.\d+)?\s*lb\s+whole\s+turkey/i.test(raw)) {
        return raw.replace(/^\d+(?:\.\d+)?\s*lb\s+whole\s+turkey/i, `${wStr} lb whole turkey`);
      }
      return `${wStr} lb whole turkey (thawed, giblets & neck reserved for gravy)`;
    }
    if (/kosher\s+salt/i.test(raw) && /(dry\s*brine|seasoning)/i.test(raw)) {
      const dcTbsp = formatCulinaryNumber(w / 4);
      const mortonTbsp = formatCulinaryNumber(w / 8);
      return `${dcTbsp} tbsp Diamond Crystal kosher salt (or ${mortonTbsp} tbsp Morton kosher salt) for dry brine/seasoning`;
    }
  }

  const effectiveScale = dishId === "turkey" ? w / 25 : safeNum(scale, 1);
  if (Math.abs(effectiveScale - 1) < 0.005) {
    return raw;
  }

  let out = raw;

  // 1) Scale leading quantity or range (optionally preceded by "Zest of " / "Zest and juice of ")
  const leadRe = new RegExp(
    `^((?:Zest(?:\\s+and\\s+juice)?\\s+of\\s+)?)(${CULINARY_NUM_SRC})(?:(\\s*(?:–|-|to)\\s*)(${CULINARY_NUM_SRC}))?(?=\\s|$)`,
    "i"
  );
  const leadMatch = out.match(leadRe);
  if (leadMatch) {
    const prefix = leadMatch[1] || "";
    const n1 = parseCulinaryNumber(leadMatch[2]);
    const sep = leadMatch[3] || "";
    const n2 = leadMatch[4] ? parseCulinaryNumber(leadMatch[4]) : NaN;
    let rest = out.slice(leadMatch[0].length);
    if (Number.isFinite(n1) && n1 > 0) {
      const s1 = formatCulinaryNumber(n1 * effectiveScale);
      if (sep && Number.isFinite(n2) && n2 > 0) {
        const s2 = formatCulinaryNumber(n2 * effectiveScale);
        out = `${prefix}${s1}${sep}${s2}${rest}`;
      } else {
        rest = fixLeadingUnitPlural(n1 * effectiveScale, rest);
        out = `${prefix}${s1}${rest}`;
      }
    }
  }

  // 2) Scale secondary "+ <qty>" clauses (e.g. "+ 1 cup dry white wine", "+ ¾ tsp black pepper")
  const plusRe = new RegExp(
    `(\\+\\s*)(${CULINARY_NUM_SRC})(?:(\\s*(?:–|-|to)\\s*)(${CULINARY_NUM_SRC}))?(?=\\s|$)`,
    "gi"
  );
  out = out.replace(plusRe, (full, plus, q1, sep, q2) => {
    const n1 = parseCulinaryNumber(q1);
    if (!Number.isFinite(n1) || n1 <= 0) return full;
    const s1 = formatCulinaryNumber(n1 * effectiveScale);
    if (sep && q2) {
      const n2 = parseCulinaryNumber(q2);
      if (Number.isFinite(n2) && n2 > 0) {
        return `${plus}${s1}${sep}${formatCulinaryNumber(n2 * effectiveScale)}`;
      }
    }
    return `${plus}${s1}`;
  });

  // 3) Scale comma-separated ingredient quantities followed by a culinary unit (never "9-inch" or "100%")
  const commaUnitRe = new RegExp(
    `(,\\s*)(${CULINARY_NUM_SRC})(\\s+(?:tsp|tbsp|cups?|lbs?|oz|cloves?|stalks?|carrots?|onions?|lemons?|sprigs?|leaves?|eggs?|sticks?|bags?|cans?|halved|quartered))\\b`,
    "gi"
  );
  out = out.replace(commaUnitRe, (full, comma, qty, unit) => {
    const n = parseCulinaryNumber(qty);
    if (!Number.isFinite(n) || n <= 0) return full;
    return `${comma}${formatCulinaryNumber(n * effectiveScale)}${unit}`;
  });

  // 4) Scale parenthetical total equivalents like "(4 sticks)", "(12 tbsp)", "(1 cup)", "(24 oz total)"
  // while leaving container sizes like "(15 oz)" or "(12 oz)" untouched!
  const parenTotalRe = new RegExp(
    `\\((${CULINARY_NUM_SRC})(\\s+(?:sticks?|tbsp|tsp|cups?|lbs?|oz\\s+total))\\)`,
    "gi"
  );
  out = out.replace(parenTotalRe, (full, qty, unit) => {
    const n = parseCulinaryNumber(qty);
    if (!Number.isFinite(n) || n <= 0) return full;
    const scaled = n * effectiveScale;
    const adjustedUnit = fixLeadingUnitPlural(scaled, unit);
    return `(${formatCulinaryNumber(scaled)}${adjustedUnit})`;
  });

  return out;
}

function getCurrentRecipeScale() {
  return safeNum(state.request?.kitchen?.recipe_scale, 1);
}

function getCurrentTurkeyWeightLb() {
  const turkey = (state.request?.dishes || []).find((d) => d.id === "turkey");
  return safeNum(turkey?.turkey_weight_lb, 25);
}

function getEffectiveRecipe(dish) {
  if (!dish) return null;
  const base = state.recipes[dish.id] || null;
  const override = state.recipeOverrides[dish.id] || null;
  if (!base && !override) return null;
  if (!override) return base;
  return {
    ...(base || {}),
    ...override,
    dish_id: dish.id,
    emoji: override.emoji || base?.emoji || dish.emoji || "🍽️",
  };
}

function normalizeChecklistKey(str) {
  return String(str || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 72);
}

function formatIngredientLine(entry) {
  if (typeof entry === "string") return entry.trim();
  if (!entry || typeof entry !== "object") return "";
  const qty = entry.qty ?? entry.amount ?? entry.quantity ?? "";
  const unit = entry.unit ?? "";
  const name = entry.item ?? entry.name ?? entry.ingredient ?? entry.label ?? "";
  const note = entry.note ?? entry.prep ?? "";
  const prefix = [qty, unit].filter(Boolean).join(" ").trim();
  const base = prefix ? `${prefix} ${name}`.trim() : String(name).trim();
  return note ? `${base} (${note})` : base;
}

function formatEquipmentEntry(entry) {
  if (typeof entry === "string") {
    return { label: entry.trim(), note: "" };
  }
  if (!entry || typeof entry !== "object") return { label: "", note: "" };
  const label = String(entry.item ?? entry.name ?? entry.label ?? entry.title ?? "").trim();
  const note = String(entry.note ?? entry.detail ?? entry.why ?? entry.tip ?? "").trim();
  return { label, note };
}

function getRecipeOvenBadge(dish, recipe) {
  const solvedCook = (state.plan?.tasks || []).find((t) => t.dish_id === dish.id && t.is_primary_cook);
  const res = solvedCook ? solvedCook.resource : dish.appliance;
  const temp = solvedCook?.temp_f ?? dish.temp_f ?? recipe?.temp_f ?? null;

  let cls = "recipe-badge";
  let text = "";
  if (res === "main_oven") {
    cls += " recipe-badge-oven";
    text = `🔥 Main Oven${temp ? ` ${temp}°F` : ""}`;
  } else if (res === "upper_combo") {
    cls += " recipe-badge-upper";
    const upperLabel = dish.id === "green_beans" || (temp && temp >= 360) ? "Upper Air Fry" : "Upper Combo";
    text = `✨ ${upperLabel}${temp ? ` ${temp}°F` : ""}`;
  } else {
    cls += " recipe-badge-stove";
    text = "🍳 Stovetop";
  }

  if (dish.probe_pull_f) {
    text += ` · Pull ${dish.probe_pull_f}°F → ${dish.probe_target_f || 165}°F`;
  } else if (recipe?.probe_note || recipe?.oven_badge) {
    const extra = String(recipe.probe_note || recipe.oven_badge).trim();
    if (extra && !text.toLowerCase().includes(extra.toLowerCase())) {
      text += ` · ${extra}`;
    }
  }
  return { cls, text };
}

function getEnabledDishes() {
  return (state.request?.dishes || []).filter((d) => d.enabled);
}

function setRecipesTab(tab) {
  state.recipesTab = tab === "gear" ? "gear" : "recipes";
  document.querySelectorAll("#recipesSectionTabs .seg-btn").forEach((btn) => {
    const active = btn.dataset.tab === state.recipesTab;
    btn.classList.toggle("active", active);
    btn.setAttribute("aria-selected", String(active));
  });
  document.getElementById("recipesTabPanel")?.classList.toggle("hidden", state.recipesTab !== "recipes");
  document.getElementById("gearTabPanel")?.classList.toggle("hidden", state.recipesTab !== "gear");
}

function jumpToDishRecipe(dishId) {
  closeDishDrawer();
  setRecipesTab("recipes");
  renderRecipesSection();
  const target =
    document.getElementById(`recipe-card-${dishId}`) || document.getElementById("recipesSection");
  if (!target) return;
  target.scrollIntoView({ behavior: "smooth", block: "center" });
  if (target.classList.contains("recipe-card")) {
    target.classList.remove("recipe-card-highlight");
    void target.offsetWidth;
    target.classList.add("recipe-card-highlight");
    clearTimeout(jumpToDishRecipe._t);
    jumpToDishRecipe._t = setTimeout(() => {
      target.classList.remove("recipe-card-highlight");
    }, 2000);
  }
}

function renderRecipesSection() {
  if (!state.request) return;
  const enabledDishes = getEnabledDishes();
  const scale = getCurrentRecipeScale();
  const countPill = document.getElementById("recipesCountPill");
  if (countPill) {
    countPill.textContent = `${enabledDishes.length} enabled ${enabledDishes.length === 1 ? "dish" : "dishes"}`;
  }
  const scalePill = document.getElementById("recipeScalePill");
  if (scalePill) {
    const isScaled = Math.abs(scale - 1) > 0.005;
    scalePill.classList.toggle("hidden", !isScaled);
    if (isScaled) {
      scalePill.textContent = `Scaled ${formatScaleMultiplier(scale)}`;
    }
  }
  const scaleSel = document.getElementById("recipeScaleSelect");
  if (scaleSel) {
    const match = [...scaleSel.options].find((o) => Math.abs(Number(o.value) - scale) < 0.001);
    if (match) scaleSel.value = match.value;
  }
  setRecipesTab(state.recipesTab);
  renderRecipeCards(enabledDishes);
  renderGearChecklists(enabledDishes);
}

function renderRecipeCards(enabledDishes) {
  const grid = document.getElementById("recipeCardsGrid");
  if (!grid) return;

  if (!enabledDishes.length) {
    grid.innerHTML = `<div class="muted small" style="padding:18px;text-align:center;grid-column:1/-1">Enable at least one dish in Menu &amp; Dish Controls above to view recipes.</div>`;
    return;
  }

  const scale = getCurrentRecipeScale();
  const isScaled = Math.abs(scale - 1) > 0.005;
  const turkeyWeightLb = getCurrentTurkeyWeightLb();
  const turkeyWStr = formatWeightValue(turkeyWeightLb);

  grid.innerHTML = enabledDishes
    .map((dish) => {
      const recipe = getEffectiveRecipe(dish);
      const isCustomOverride = Boolean(state.recipeOverrides[dish.id]);
      const emoji = recipe?.emoji || dish.emoji || "🍽️";
      let title = recipe?.title || recipe?.name || dish.name;
      if (dish.id === "turkey" && !isCustomOverride && /^\d+(?:\.\d+)?\s*lb\b/i.test(title)) {
        title = title.replace(/^\d+(?:\.\d+)?\s*lb\b/i, `${turkeyWStr} lb`);
      }

      const servingsRaw = recipe?.servings ?? recipe?.yield ?? null;
      let servingsText =
        servingsRaw !== null && servingsRaw !== undefined && String(servingsRaw).trim()
          ? typeof servingsRaw === "number"
            ? `Serves ${servingsRaw}`
            : String(servingsRaw).toLowerCase().includes("serv") ||
              String(servingsRaw).toLowerCase().includes("pie") ||
              String(servingsRaw).toLowerCase().includes("guest") ||
              String(servingsRaw).toLowerCase().includes("roll") ||
              String(servingsRaw).toLowerCase().includes("slice")
            ? String(servingsRaw)
            : `Serves ${servingsRaw}`
          : "Feast portion";

      if (dish.id === "turkey" && !isCustomOverride && Math.abs(turkeyWeightLb - 25) > 0.05) {
        const rec = turkeyRecommendationBrowser(turkeyWeightLb, dish.turkey_method || "convection_roast");
        servingsText = `${rec.suggested_guests} guests (${turkeyWStr} lb bird)`;
      }

      const activeRaw = recipe?.active_min ?? recipe?.active_time ?? dish.prep_min;
      const activeText =
        typeof activeRaw === "number"
          ? `Active ${activeRaw}m · Cook ${dish.cook_min}m`
          : activeRaw
          ? String(activeRaw)
          : `Prep ${dish.prep_min}m · Cook ${dish.cook_min}m`;
      const ovenBadge = getRecipeOvenBadge(dish, recipe);

      const scaleBadgeHtml =
        dish.id === "turkey"
          ? Math.abs(turkeyWeightLb - 25) > 0.05
            ? `<span class="recipe-badge recipe-badge-scale">🦃 Scaled for ${escapeHtml(turkeyWStr)} lb</span>`
            : ""
          : isScaled
          ? `<span class="recipe-badge recipe-badge-scale">⚖️ Scaled ${escapeHtml(formatScaleMultiplier(scale))}</span>`
          : "";

      const customBadgeHtml = isCustomOverride
        ? `<span class="recipe-badge recipe-badge-custom">✏️ Custom</span>`
        : "";

      const rawIngredients = Array.isArray(recipe?.ingredients) ? recipe.ingredients : [];
      const ingredients = rawIngredients
        .map(formatIngredientLine)
        .filter(Boolean)
        .map((line) => scaleIngredientLine(line, scale, turkeyWeightLb, dish.id));

      const rawSteps = Array.isArray(recipe?.steps)
        ? recipe.steps
        : Array.isArray(recipe?.method)
        ? recipe.method
        : Array.isArray(recipe?.instructions)
        ? recipe.instructions
        : [];
      const steps = rawSteps.map((s) => String(s || "").trim()).filter(Boolean);

      const makeAheadTip = String(
        recipe?.make_ahead_tip ?? recipe?.make_ahead ?? recipe?.tip ?? dish.technique_note ?? ""
      ).trim();

      const ingredientsHtml = ingredients.length
        ? `
          <details class="recipe-details" open>
            <summary>
              <span>Ingredients (${ingredients.length})</span>
            </summary>
            <ul class="recipe-ingredients-list">
              ${ingredients.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}
            </ul>
          </details>`
        : "";

      const stepsHtml = steps.length
        ? `
          <div>
            <div class="recipe-method-label">Method</div>
            <ol class="recipe-steps">
              ${steps.map((step) => `<li>${escapeHtml(step)}</li>`).join("")}
            </ol>
          </div>`
        : `<p class="muted small" style="margin:0">No custom recipe steps yet — click <strong>✏️ Edit Recipe</strong> to add ingredients, equipment, and steps.</p>`;

      const tipHtml = makeAheadTip
        ? `<div class="recipe-tip-box"><strong>Make-Ahead &amp; Chef Tip:</strong> ${escapeHtml(makeAheadTip)}</div>`
        : "";

      return `
        <article id="recipe-card-${escapeHtml(dish.id)}" class="recipe-card" data-recipe-dish-id="${escapeHtml(dish.id)}">
          <div class="recipe-card-head">
            <div class="recipe-card-title-row">
              <div class="recipe-emoji">${escapeHtml(emoji)}</div>
              <div class="recipe-title-block">
                <h3>${escapeHtml(title)}</h3>
                <div class="recipe-badges">
                  <span class="recipe-badge">🍽️ ${escapeHtml(servingsText)}</span>
                  <span class="recipe-badge">⏱️ ${escapeHtml(activeText)}</span>
                  <span class="${ovenBadge.cls}">${escapeHtml(ovenBadge.text)}</span>
                  ${scaleBadgeHtml}
                  ${customBadgeHtml}
                </div>
              </div>
            </div>
            <button type="button" class="btn btn-secondary btn-sm recipe-edit-btn" data-edit-recipe-id="${escapeHtml(dish.id)}" title="Edit ingredients, equipment, and steps">
              ✏️ Edit Recipe
            </button>
          </div>
          ${ingredientsHtml}
          ${stepsHtml}
          ${tipHtml}
        </article>`;
    })
    .join("");

  grid.querySelectorAll(".recipe-edit-btn").forEach((btn) => {
    btn.addEventListener("click", () => openRecipeEditorModal(btn.dataset.editRecipeId));
  });
}

function renderGearChecklists(enabledDishes) {
  const shoppingEl = document.getElementById("shoppingChecklist");
  const equipmentEl = document.getElementById("equipmentChecklist");
  if (!shoppingEl || !equipmentEl) return;

  const scale = getCurrentRecipeScale();
  const isScaled = Math.abs(scale - 1) > 0.005;
  const turkeyWeightLb = getCurrentTurkeyWeightLb();

  const shopScaleBadge = document.getElementById("shoppingScaleBadge");
  if (shopScaleBadge) {
    shopScaleBadge.classList.toggle("hidden", !isScaled);
    if (isScaled) {
      shopScaleBadge.textContent = `Scaled ${formatScaleMultiplier(scale)}`;
    }
  }

  // 1) Build Shopping & Pantry Ingredients grouped by enabled dish (scaled live!)
  const shoppingGroups = [];
  let shoppingTotal = 0;
  let shoppingChecked = 0;

  for (const dish of enabledDishes) {
    const recipe = getEffectiveRecipe(dish);
    const rawIngredients = Array.isArray(recipe?.ingredients) ? recipe.ingredients : [];
    const items = rawIngredients
      .map(formatIngredientLine)
      .filter(Boolean)
      .map((baseText, idx) => {
        const key = `ing::${dish.id}::${normalizeChecklistKey(baseText) || idx}`;
        const displayText = scaleIngredientLine(baseText, scale, turkeyWeightLb, dish.id);
        const checked = state.checkedItems.has(key);
        shoppingTotal += 1;
        if (checked) shoppingChecked += 1;
        return { key, text: displayText, checked };
      });
    if (items.length > 0) {
      shoppingGroups.push({
        dishId: dish.id,
        title: `${dish.emoji} ${dish.name}`,
        items,
      });
    }
  }

  // 2) Build Deduplicated Dish Equipment + Universal Host Essentials
  const equipmentMap = new Map(); // normalized label -> { key, label, dishes: Set, notes: [] }
  for (const dish of enabledDishes) {
    const recipe = getEffectiveRecipe(dish);
    const rawGear = Array.isArray(recipe?.equipment)
      ? recipe.equipment
      : Array.isArray(recipe?.gear)
      ? recipe.gear
      : Array.isArray(recipe?.tools)
      ? recipe.tools
      : [];
    for (const raw of rawGear) {
      const { label, note } = formatEquipmentEntry(raw);
      if (!label) continue;
      const norm = normalizeChecklistKey(label);
      if (!norm) continue;
      if (!equipmentMap.has(norm)) {
        equipmentMap.set(norm, {
          key: `eq::${norm}`,
          label,
          dishes: new Set(),
          note,
        });
      }
      const entry = equipmentMap.get(norm);
      entry.dishes.add(`${dish.emoji} ${dish.name}`);
      if (!entry.note && note) entry.note = note;
    }
  }

  const dishGearItems = [...equipmentMap.values()].map((e) => ({
    key: e.key,
    label: e.label,
    sub: e.note ? `${e.note} · For: ${[...e.dishes].join(", ")}` : `For: ${[...e.dishes].join(", ")}`,
    checked: state.checkedItems.has(e.key),
  }));

  const rawHostList =
    Array.isArray(state.hostEssentials) && state.hostEssentials.length > 0
      ? state.hostEssentials
      : DEFAULT_HOST_ESSENTIALS;

  const hostSeen = new Set(equipmentMap.keys());
  const hostItems = [];
  for (const raw of rawHostList) {
    const { label, note } = formatEquipmentEntry(raw);
    if (!label) continue;
    const norm = normalizeChecklistKey(label);
    if (!norm || hostSeen.has(norm)) continue;
    hostSeen.add(norm);
    const key = `host::${norm}`;
    hostItems.push({
      key,
      label,
      sub: note || "Universal Thanksgiving host essential",
      checked: state.checkedItems.has(key),
    });
  }

  const equipTotal = dishGearItems.length + hostItems.length;
  const equipChecked =
    dishGearItems.filter((i) => i.checked).length + hostItems.filter((i) => i.checked).length;

  const totalItems = shoppingTotal + equipTotal;
  const totalChecked = shoppingChecked + equipChecked;
  const pct = totalItems ? Math.round((totalChecked / totalItems) * 100) : 0;

  const progressPill = document.getElementById("gearProgressPill");
  if (progressPill) {
    progressPill.textContent = `${totalChecked} of ${totalItems} checked`;
    progressPill.className =
      totalItems > 0 && totalChecked === totalItems
        ? "pill pill-success pill-compact"
        : "pill pill-neutral pill-compact";
  }
  const progressLabel = document.getElementById("gearProgressLabel");
  if (progressLabel) {
    progressLabel.textContent = `${totalChecked} of ${totalItems} checked (${pct}%)`;
  }
  const progressFill = document.getElementById("gearProgressFill");
  if (progressFill) {
    progressFill.style.width = `${pct}%`;
  }
  const shopBadge = document.getElementById("shoppingCountBadge");
  if (shopBadge) shopBadge.textContent = `${shoppingChecked} / ${shoppingTotal}`;
  const equipBadge = document.getElementById("equipmentCountBadge");
  if (equipBadge) equipBadge.textContent = `${equipChecked} / ${equipTotal}`;

  if (!shoppingGroups.length) {
    shoppingEl.innerHTML = `<div class="muted small" style="padding:12px;text-align:center">No shopping ingredients yet — enable dishes with recipes above.</div>`;
  } else {
    shoppingEl.innerHTML = shoppingGroups
      .map((grp) => {
        const grpDone = grp.items.filter((i) => i.checked).length;
        return `
          <div class="checklist-group">
            <h4 class="checklist-group-title">
              <span>${escapeHtml(grp.title)}</span>
              <span class="checklist-group-count">${grpDone}/${grp.items.length}</span>
            </h4>
            <ul class="checklist-items">
              ${grp.items
                .map(
                  (item) => `
                  <li>
                    <label class="checklist-item ${item.checked ? "is-checked" : ""}">
                      <input type="checkbox" class="checklist-checkbox" data-item-key="${escapeHtml(item.key)}" ${item.checked ? "checked" : ""} />
                      <span class="checklist-text-wrap">
                        <span class="checklist-text">${escapeHtml(item.text)}</span>
                      </span>
                    </label>
                  </li>`
                )
                .join("")}
            </ul>
          </div>`;
      })
      .join("");
  }

  const equipGroupsHtml = [];
  if (dishGearItems.length) {
    const done = dishGearItems.filter((i) => i.checked).length;
    equipGroupsHtml.push(`
      <div class="checklist-group">
        <h4 class="checklist-group-title">
          <span>🍳 Enabled Dish Equipment (Deduplicated)</span>
          <span class="checklist-group-count">${done}/${dishGearItems.length}</span>
        </h4>
        <ul class="checklist-items">
          ${dishGearItems
            .map(
              (item) => `
              <li>
                <label class="checklist-item ${item.checked ? "is-checked" : ""}">
                  <input type="checkbox" class="checklist-checkbox" data-item-key="${escapeHtml(item.key)}" ${item.checked ? "checked" : ""} />
                  <span class="checklist-text-wrap">
                    <span class="checklist-text">${escapeHtml(item.label)}</span>
                    ${item.sub ? `<span class="checklist-sub">${escapeHtml(item.sub)}</span>` : ""}
                  </span>
                </label>
              </li>`
            )
            .join("")}
        </ul>
      </div>`);
  }

  if (hostItems.length) {
    const done = hostItems.filter((i) => i.checked).length;
    equipGroupsHtml.push(`
      <div class="checklist-group">
        <h4 class="checklist-group-title">
          <span>🏠 Universal Host Essentials</span>
          <span class="checklist-group-count">${done}/${hostItems.length}</span>
        </h4>
        <ul class="checklist-items">
          ${hostItems
            .map(
              (item) => `
              <li>
                <label class="checklist-item ${item.checked ? "is-checked" : ""}">
                  <input type="checkbox" class="checklist-checkbox" data-item-key="${escapeHtml(item.key)}" ${item.checked ? "checked" : ""} />
                  <span class="checklist-text-wrap">
                    <span class="checklist-text">${escapeHtml(item.label)}</span>
                    ${item.sub ? `<span class="checklist-sub">${escapeHtml(item.sub)}</span>` : ""}
                  </span>
                </label>
              </li>`
            )
            .join("")}
        </ul>
      </div>`);
  }

  equipmentEl.innerHTML = equipGroupsHtml.join("");

  // Bind check-off handlers across both checklist columns
  const section = document.getElementById("gearTabPanel");
  section?.querySelectorAll(".checklist-checkbox").forEach((cb) => {
    cb.addEventListener("change", (e) => {
      const key = e.target.dataset.itemKey;
      if (!key) return;
      if (e.target.checked) state.checkedItems.add(key);
      else state.checkedItems.delete(key);
      saveCheckedItems();
      renderGearChecklists(getEnabledDishes());
    });
  });
}

// ---------------------------------------------------------------------------
// In-App Recipe Editor Modal (#recipeEditorModal)
// ---------------------------------------------------------------------------
function openRecipeEditorModal(dishId) {
  const dish = (state.request?.dishes || []).find((d) => d.id === dishId);
  if (!dish) return;
  state.editingRecipeDishId = dishId;

  const base = state.recipes[dishId] || null;
  const effective = getEffectiveRecipe(dish);
  const hasOverride = Boolean(state.recipeOverrides[dishId]);

  const titleEl = document.getElementById("recipeEditorTitle");
  const subtitleEl = document.getElementById("recipeEditorSubtitle");
  if (titleEl) titleEl.textContent = `✏️ Edit Recipe — ${dish.emoji} ${dish.name}`;
  if (subtitleEl) {
    subtitleEl.textContent = base
      ? "Edit ingredients, equipment, or steps — updates Recipes & Shopping List live. Reset restores the built-in recipe."
      : "Create or customize your own recipe — automatically feeds Recipes & Things You Might Need!";
  }

  document.getElementById("reTitleInput").value = effective?.title || effective?.name || dish.name;
  document.getElementById("reServingsInput").value =
    effective?.servings || effective?.yield || "12–16 guests";
  document.getElementById("reActiveTimeInput").value =
    effective?.active_time ||
    (typeof effective?.active_min === "number"
      ? `${effective.active_min} min prep · ${dish.cook_min} min cook`
      : `${dish.prep_min} min prep · ${dish.cook_min} min cook`);

  const rawIngredients = Array.isArray(effective?.ingredients) ? effective.ingredients : [];
  document.getElementById("reIngredientsInput").value = rawIngredients
    .map(formatIngredientLine)
    .filter(Boolean)
    .join("\n");

  const rawEquipment = Array.isArray(effective?.equipment)
    ? effective.equipment
    : Array.isArray(effective?.gear)
    ? effective.gear
    : [];
  document.getElementById("reEquipmentInput").value = rawEquipment
    .map((e) => formatEquipmentEntry(e).label)
    .filter(Boolean)
    .join("\n");

  const rawSteps = Array.isArray(effective?.steps)
    ? effective.steps
    : Array.isArray(effective?.method)
    ? effective.method
    : [];
  document.getElementById("reStepsInput").value = rawSteps
    .map((s) => String(s || "").trim())
    .filter(Boolean)
    .join("\n");

  document.getElementById("reTipInput").value = String(
    effective?.make_ahead_tip ?? effective?.make_ahead ?? effective?.tip ?? dish.technique_note ?? ""
  ).trim();

  const resetBtn = document.getElementById("resetRecipeEditorBtn");
  if (resetBtn) {
    resetBtn.classList.toggle("hidden", !hasOverride);
  }

  document.getElementById("recipeEditorModal").classList.remove("hidden");
  setTimeout(() => document.getElementById("reTitleInput")?.focus(), 30);
}

function closeRecipeEditorModal() {
  state.editingRecipeDishId = null;
  document.getElementById("recipeEditorModal")?.classList.add("hidden");
}

function saveRecipeEditorModal() {
  const dishId = state.editingRecipeDishId;
  if (!dishId) return;
  const dish = (state.request?.dishes || []).find((d) => d.id === dishId);
  if (!dish) return;

  const splitLines = (val) =>
    String(val || "")
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter(Boolean);

  const title = document.getElementById("reTitleInput").value.trim() || dish.name;
  const servings = document.getElementById("reServingsInput").value.trim() || "Feast portion";
  const active_time =
    document.getElementById("reActiveTimeInput").value.trim() ||
    `${dish.prep_min} min prep · ${dish.cook_min} min cook`;
  const ingredients = splitLines(document.getElementById("reIngredientsInput").value);
  const equipment = splitLines(document.getElementById("reEquipmentInput").value);
  const steps = splitLines(document.getElementById("reStepsInput").value);
  const make_ahead_tip = document.getElementById("reTipInput").value.trim();

  state.recipeOverrides[dishId] = {
    dish_id: dishId,
    emoji: dish.emoji || "🍽️",
    title,
    servings,
    active_time,
    ingredients,
    equipment,
    steps,
    make_ahead_tip,
  };

  saveRecipeOverrides();
  closeRecipeEditorModal();
  renderRecipesSection();
  showToast(`💾 Saved custom recipe for ${dish.emoji} ${title}!`);
}

function resetRecipeEditorModal() {
  const dishId = state.editingRecipeDishId;
  if (!dishId) return;
  const dish = (state.request?.dishes || []).find((d) => d.id === dishId);
  delete state.recipeOverrides[dishId];
  saveRecipeOverrides();
  closeRecipeEditorModal();
  renderRecipesSection();
  showToast(`↺ Restored default recipe for ${dish ? `${dish.emoji} ${dish.name}` : dishId}.`);
}

// ---------------------------------------------------------------------------
// Tune My Feast (All Dishes) Quick-Alignment Modal
// ---------------------------------------------------------------------------
function renderTuneStrategyCell(dish) {
  if (dish.id === "turkey" || dish.turkey_method) {
    return `
      <div class="tune-strat-flex">
        <select class="tune-input tune-turkey-method" data-dish-id="${escapeHtml(dish.id)}">
          <option value="convection_roast" ${dish.turkey_method === "convection_roast" ? "selected" : ""}>Convect Roast (325°F)</option>
          <option value="standard_roast" ${dish.turkey_method === "standard_roast" ? "selected" : ""}>Standard Roast (325°F)</option>
          <option value="spatchcock" ${dish.turkey_method === "spatchcock" ? "selected" : ""}>Kenji Spatchcock (450°F)</option>
        </select>
        <span class="tune-weight-wrap">
          <input type="number" class="tune-input tune-weight-input tune-turkey-weight" data-dish-id="${escapeHtml(dish.id)}" min="10" max="32" step="1" value="${dish.turkey_weight_lb || 25}" title="Turkey weight in lbs" />
          <span class="small muted">lb</span>
        </span>
      </div>`;
  }
  if (dish.bread_dry_method) {
    return `
      <select class="tune-input tune-bread-dry" data-dish-id="${escapeHtml(dish.id)}">
        <option value="oven_dry" ${dish.bread_dry_method === "oven_dry" ? "selected" : ""}>Oven-Dry Cubes (300°F · 20m)</option>
        <option value="air_dry" ${dish.bread_dry_method === "air_dry" ? "selected" : ""}>Air-Dry Overnight (0 Oven)</option>
      </select>`;
  }
  if (dish.bread_pudding_mode) {
    return `
      <select class="tune-input tune-bp-mode" data-dish-id="${escapeHtml(dish.id)}">
        <option value="fresh_warm_bake" ${dish.bread_pudding_mode === "fresh_warm_bake" ? "selected" : ""}>Overnight Soak → Bake Fresh</option>
        <option value="bake_ahead_reheat" ${dish.bread_pudding_mode === "bake_ahead_reheat" ? "selected" : ""}>Bake Ahead → Warm Reheat</option>
      </select>`;
  }
  if (dish.pie_bake_mode) {
    return `
      <select class="tune-input tune-pie-mode" data-dish-id="${escapeHtml(dish.id)}">
        <option value="steady_350" ${dish.pie_bake_mode === "steady_350" ? "selected" : ""}>Steady 350°F (Smooth Custard)</option>
        <option value="high_to_low" ${dish.pie_bake_mode === "high_to_low" ? "selected" : ""}>High-to-Low (425°F → 350°F)</option>
      </select>`;
  }
  const metaParts = [];
  if (dish.prep_min) metaParts.push(`Prep ${dish.prep_min}m`);
  if (dish.rest_min) metaParts.push(`Rest ${dish.rest_min}m`);
  return `<span class="small muted">${metaParts.length ? metaParts.join(" · ") : "Standard recipe"}</span>`;
}

function updateTuneSummary() {
  const rows = document.querySelectorAll("#tuneFeastBody tr");
  let active = 0;
  rows.forEach((tr) => {
    const cb = tr.querySelector(".tune-enabled");
    const isOn = cb?.checked;
    tr.classList.toggle("row-disabled", !isOn);
    if (isOn) active += 1;
  });
  document.getElementById("tuneFeastSummary").textContent = `${active} of ${rows.length} dishes enabled`;
}

function openTuneFeastModal() {
  const tbody = document.getElementById("tuneFeastBody");
  tbody.innerHTML = state.request.dishes
    .map((dish) => {
      const isStoveOnly = dish.appliance === "stovetop" && !dish.bread_dry_method;
      return `
        <tr data-dish-id="${escapeHtml(dish.id)}" class="${dish.enabled ? "" : "row-disabled"}">
          <td class="col-on">
            <input type="checkbox" class="tune-check tune-enabled" ${dish.enabled ? "checked" : ""} aria-label="Enable ${escapeHtml(dish.name)}" />
          </td>
          <td class="col-dish">
            <div class="tune-dish-cell">
              <span class="tune-dish-emoji">${escapeHtml(dish.emoji)}</span>
              <div>
                <div class="tune-dish-name">${escapeHtml(dish.name)}</div>
                <div class="tune-dish-cat">${escapeHtml(dish.category)}</div>
              </div>
            </div>
          </td>
          <td class="col-app">
            <select class="tune-input tune-appliance">
              <option value="auto" ${dish.appliance === "auto" ? "selected" : ""}>Auto (CP-SAT)</option>
              <option value="main_oven" ${dish.appliance === "main_oven" ? "selected" : ""}>Main Oven</option>
              <option value="upper_combo" ${dish.appliance === "upper_combo" ? "selected" : ""}>Upper Combo</option>
              <option value="stovetop" ${dish.appliance === "stovetop" ? "selected" : ""}>Stovetop</option>
            </select>
          </td>
          <td class="col-temp">
            <input type="number" class="tune-input tune-temp" min="150" max="500" step="5" value="${isStoveOnly ? "" : dish.temp_f || 350}" placeholder="—" ${isStoveOnly ? "disabled" : ""} />
          </td>
          <td class="col-min">
            <input type="number" class="tune-input tune-cook" min="5" max="420" step="5" value="${dish.cook_min}" />
          </td>
          <td class="col-day">
            <select class="tune-input tune-day">
              <option value="any" ${dish.day_preference === "any" ? "selected" : ""}>Auto (Wed/Thu)</option>
              <option value="day_before" ${dish.day_preference === "day_before" ? "selected" : ""}>Tonight (Wed)</option>
              <option value="day_of" ${dish.day_preference === "day_of" ? "selected" : ""}>Thanksgiving (Thu)</option>
            </select>
          </td>
          <td class="col-strat">${renderTuneStrategyCell(dish)}</td>
        </tr>`;
    })
    .join("");

  // Wire per-row interactions
  tbody.querySelectorAll("tr").forEach((tr) => {
    const dishId = tr.dataset.dishId;
    const dish = state.request.dishes.find((d) => d.id === dishId);
    const appSel = tr.querySelector(".tune-appliance");
    const tempInput = tr.querySelector(".tune-temp");
    const enabledCb = tr.querySelector(".tune-enabled");

    enabledCb.addEventListener("change", updateTuneSummary);

    appSel.addEventListener("change", () => {
      const stoveOnly = appSel.value === "stovetop" && !dish?.bread_dry_method;
      tempInput.disabled = stoveOnly;
      if (stoveOnly) {
        tempInput.value = "";
      } else if (!tempInput.value) {
        tempInput.value = String(dish?.temp_f || 350);
      }
    });

    const tMethod = tr.querySelector(".tune-turkey-method");
    const tWeight = tr.querySelector(".tune-turkey-weight");
    if (tMethod && tWeight) {
      const refreshTurkeyRow = async () => {
        const rec = await fetchTurkeyRecommendation(tWeight.value, tMethod.value);
        if (!rec) return;
        tr.querySelector(".tune-temp").value = rec.temp_f;
        tr.querySelector(".tune-cook").value = rec.cook_min;
      };
      tMethod.addEventListener("change", refreshTurkeyRow);
      tWeight.addEventListener("change", refreshTurkeyRow);
    }
  });

  updateTuneSummary();
  document.getElementById("tuneFeastModal").classList.remove("hidden");
}

function closeTuneFeastModal() {
  document.getElementById("tuneFeastModal").classList.add("hidden");
}

async function applyTuneFeastModal() {
  const rows = document.querySelectorAll("#tuneFeastBody tr");
  rows.forEach((tr) => {
    const dish = state.request.dishes.find((d) => d.id === tr.dataset.dishId);
    if (!dish) return;

    dish.enabled = tr.querySelector(".tune-enabled").checked;
    dish.appliance = tr.querySelector(".tune-appliance").value;
    dish.day_preference = tr.querySelector(".tune-day").value;
    dish.cook_min = Math.max(5, Number(tr.querySelector(".tune-cook").value) || dish.cook_min);

    const tempVal = Number(tr.querySelector(".tune-temp").value);
    if (dish.appliance === "stovetop" && !dish.bread_dry_method) {
      dish.temp_f = null;
    } else {
      dish.temp_f = Number.isFinite(tempVal) && tempVal >= 150 ? tempVal : dish.temp_f || 350;
    }

    const tMethod = tr.querySelector(".tune-turkey-method");
    if (tMethod) {
      dish.turkey_method = tMethod.value;
      dish.turkey_weight_lb = Number(tr.querySelector(".tune-turkey-weight").value) || dish.turkey_weight_lb || 25;
      syncTurkeyDishName(dish, dish.turkey_weight_lb);
      const localRec = turkeyRecommendationBrowser(dish.turkey_weight_lb, dish.turkey_method);
      dish.rest_min = localRec.rest_min;
      if (state.turkeyMethods[dish.turkey_method]) {
        dish.technique_note = state.turkeyMethods[dish.turkey_method].note;
      }
    }
    const dryEl = tr.querySelector(".tune-bread-dry");
    if (dryEl) dish.bread_dry_method = dryEl.value;

    const bpEl = tr.querySelector(".tune-bp-mode");
    if (bpEl) dish.bread_pudding_mode = bpEl.value;

    const pieEl = tr.querySelector(".tune-pie-mode");
    if (pieEl) dish.pie_bake_mode = pieEl.value;
  });

  closeTuneFeastModal();
  await apiSolve(false);
  showToast("🎯 Tuned feast solved! Your step-by-step timeline is updated.");
}

// ---------------------------------------------------------------------------
// Dish Editor Slide-Over Drawer
// ---------------------------------------------------------------------------
function openDishDrawer(dishId) {
  const dish = state.request.dishes.find((d) => d.id === dishId);
  if (!dish) return;
  state.editingDishId = dishId;

  document.getElementById("drawerEmoji").textContent = dish.emoji;
  document.getElementById("drawerTitle").textContent = dish.name;
  document.getElementById("drawerMeta").textContent = `${dish.category.toUpperCase()} · Click Apply to re-solve with OR-Tools CP-SAT`;

  const isCore = [
    "turkey",
    "dressing",
    "sweet_potato_pie",
    "pumpkin_pie",
    "bread_pudding",
    "mac_and_cheese",
    "mashed_potatoes",
    "green_beans",
    "pan_gravy",
  ].includes(dish.id);
  document.getElementById("drawerDeleteBtn").classList.toggle("hidden", isCore);

  const solvedCook = (state.plan?.tasks || []).find((t) => t.dish_id === dish.id && t.is_primary_cook);
  const currentCookStart = dish.locked_cook_start_min ?? solvedCook?.start_min ?? (DAY_MINUTES + 12 * 60);

  let specializedHtml = "";

  if (dish.id === "turkey" || dish.turkey_method) {
    specializedHtml = `
      <div class="form-grid-2">
        <div class="form-row">
          <label for="edTurkeyMethod">Roasting Method</label>
          <select id="edTurkeyMethod" class="input-field">
            <option value="convection_roast" ${dish.turkey_method === "convection_roast" ? "selected" : ""}>Convect Roast (325°F)</option>
            <option value="standard_roast" ${dish.turkey_method === "standard_roast" ? "selected" : ""}>Standard Roast (325°F)</option>
            <option value="spatchcock" ${dish.turkey_method === "spatchcock" ? "selected" : ""}>Kenji Spatchcock (450°F)</option>
          </select>
        </div>
        <div class="form-row">
          <label for="edTurkeyWeight">Weight (lb)</label>
          <input id="edTurkeyWeight" type="number" class="input-field" min="10" max="32" step="1" value="${dish.turkey_weight_lb || 25}" />
        </div>
      </div>
      <div class="form-grid-2">
        <div class="form-row">
          <label for="edProbePull">Probe Pull Temp (°F)</label>
          <input id="edProbePull" type="number" class="input-field" min="148" max="170" value="${dish.probe_pull_f || 158}" />
        </div>
        <div class="form-row">
          <label for="edProbeTarget">Carryover Target (°F)</label>
          <input id="edProbeTarget" type="number" class="input-field" min="160" max="175" value="${dish.probe_target_f || 165}" />
        </div>
      </div>`;
  } else if (dish.bread_dry_method) {
    specializedHtml = `
      <div class="form-row">
        <label for="edBreadDry">Bread Drying Strategy</label>
        <select id="edBreadDry" class="input-field">
          <option value="oven_dry" ${dish.bread_dry_method === "oven_dry" ? "selected" : ""}>Oven-Dry Cubes (300°F · 20m)</option>
          <option value="air_dry" ${dish.bread_dry_method === "air_dry" ? "selected" : ""}>Air-Dry Overnight (0 Oven Time!)</option>
        </select>
      </div>`;
  } else if (dish.bread_pudding_mode) {
    specializedHtml = `
      <div class="form-row">
        <label for="edBpMode">Bread Pudding Bake Strategy</label>
        <select id="edBpMode" class="input-field">
          <option value="fresh_warm_bake" ${dish.bread_pudding_mode === "fresh_warm_bake" ? "selected" : ""}>Overnight Soak → Bake Fresh During Dinner</option>
          <option value="bake_ahead_reheat" ${dish.bread_pudding_mode === "bake_ahead_reheat" ? "selected" : ""}>Bake Ahead → Warm Reheat</option>
        </select>
      </div>`;
  } else if (dish.pie_bake_mode) {
    specializedHtml = `
      <div class="form-row">
        <label for="edPieMode">Custard Pie Bake Curve</label>
        <select id="edPieMode" class="input-field">
          <option value="steady_350" ${dish.pie_bake_mode === "steady_350" ? "selected" : ""}>Steady 350°F (Smooth Custard)</option>
          <option value="high_to_low" ${dish.pie_bake_mode === "high_to_low" ? "selected" : ""}>High-to-Low (425°F 15m → 350°F)</option>
        </select>
      </div>`;
  }

  const hasRecipe = Boolean(getEffectiveRecipe(dish));
  const recipeJumpHtml = `
      <div class="drawer-recipe-jump-row">
        <span class="drawer-recipe-jump-meta">${
          hasRecipe
            ? "Ingredients, method &amp; gear synced live in Recipes."
            : "Add your own ingredients, equipment &amp; method steps."
        }</span>
        <div style="display:flex;gap:6px;flex-shrink:0">
          ${hasRecipe ? `<button id="drawerJumpRecipeBtn" class="btn btn-secondary btn-sm" type="button">📖 Recipe</button>` : ""}
          <button id="drawerEditRecipeBtn" class="btn btn-secondary btn-sm" type="button">✏️ Edit</button>
        </div>
      </div>`;

  const body = document.getElementById("drawerBody");
  body.innerHTML = `
    ${recipeJumpHtml}
    <div class="form-row">
      <label for="edName">Dish Name</label>
      <input id="edName" class="input-field" value="${escapeHtml(dish.name)}" />
    </div>

    ${specializedHtml}

    <div class="form-grid-2">
      <div class="form-row">
        <label for="edAppliance">Appliance</label>
        <select id="edAppliance" class="input-field">
          <option value="auto" ${dish.appliance === "auto" ? "selected" : ""}>Auto (CP-SAT)</option>
          <option value="main_oven" ${dish.appliance === "main_oven" ? "selected" : ""}>Main Oven</option>
          <option value="upper_combo" ${dish.appliance === "upper_combo" ? "selected" : ""}>Upper Combo</option>
          <option value="stovetop" ${dish.appliance === "stovetop" ? "selected" : ""}>Stovetop</option>
        </select>
      </div>
      <div class="form-row">
        <label for="edDayPref">Day Preference</label>
        <select id="edDayPref" class="input-field">
          <option value="any" ${dish.day_preference === "any" ? "selected" : ""}>Auto (Wed or Thu)</option>
          <option value="day_before" ${dish.day_preference === "day_before" ? "selected" : ""}>Tonight (Wed)</option>
          <option value="day_of" ${dish.day_preference === "day_of" ? "selected" : ""}>Thanksgiving (Thu)</option>
        </select>
      </div>
    </div>

    <div class="form-row">
      <label for="edCookMin">Cook / Bake Duration <span class="muted">minutes</span></label>
      <div class="range-row">
        <input id="edCookRange" type="range" min="5" max="330" step="5" value="${dish.cook_min}" />
        <input id="edCookMin" type="number" class="input-field" min="5" max="420" value="${dish.cook_min}" />
      </div>
    </div>

    <div class="form-row">
      <label for="edTempF">Oven / Air-Fry Temp <span class="muted">°F (ignored on stovetop)</span></label>
      <div class="range-row">
        <input id="edTempRange" type="range" min="250" max="475" step="5" value="${dish.temp_f || 350}" />
        <input id="edTempF" type="number" class="input-field" min="150" max="500" value="${dish.temp_f || 350}" />
      </div>
    </div>

    <div class="form-grid-2">
      <div class="form-row">
        <label for="edPrepMin">Prep Time (min)</label>
        <input id="edPrepMin" type="number" class="input-field" min="0" max="180" value="${dish.prep_min}" />
      </div>
      <div class="form-row">
        <label for="edRestMin">Rest / Cool Time (min)</label>
        <input id="edRestMin" type="number" class="input-field" min="0" max="180" value="${dish.rest_min}" />
      </div>
    </div>

    <div class="form-row lock-box">
      <label>
        <span>🔒 Hard-Pin Cook Start Time</span>
        <input id="edLockToggle" class="lock-box-toggle" type="checkbox" ${dish.locked_cook_start_min !== null && dish.locked_cook_start_min !== undefined ? "checked" : ""} />
      </label>
      <div id="edLockTimeWrap" class="${dish.locked_cook_start_min !== null && dish.locked_cook_start_min !== undefined ? "" : "hidden"}" style="margin-top:6px">
        <select id="edLockMinute" class="input-field">
          ${buildLockTimeOptions(currentCookStart)}
        </select>
      </div>
    </div>

    ${dish.technique_note ? `<div class="tip-box"><strong>Chef &amp; Oven Note:</strong> ${escapeHtml(dish.technique_note)}</div>` : ""}
  `;

  // Sync range <-> numeric inputs
  const syncPair = (rangeId, numId) => {
    const r = document.getElementById(rangeId);
    const n = document.getElementById(numId);
    r.addEventListener("input", () => (n.value = r.value));
    n.addEventListener("input", () => (r.value = n.value));
  };
  syncPair("edCookRange", "edCookMin");
  syncPair("edTempRange", "edTempF");

  // Auto-update turkey cook time & temp when switching turkey method/weight
  const methodEl = document.getElementById("edTurkeyMethod");
  const weightEl = document.getElementById("edTurkeyWeight");
  const updateTurkeyRec = async () => {
    if (!methodEl || !weightEl) return;
    const rec = await fetchTurkeyRecommendation(weightEl.value, methodEl.value);
    if (!rec) return;
    document.getElementById("edTempF").value = rec.temp_f;
    document.getElementById("edTempRange").value = rec.temp_f;
    document.getElementById("edCookMin").value = rec.cook_min;
    document.getElementById("edCookRange").value = rec.cook_min;
    document.getElementById("edRestMin").value = rec.rest_min;
  };
  methodEl?.addEventListener("change", updateTurkeyRec);
  weightEl?.addEventListener("change", updateTurkeyRec);

  document.getElementById("edLockToggle").addEventListener("change", (e) => {
    document.getElementById("edLockTimeWrap").classList.toggle("hidden", !e.target.checked);
  });

  document.getElementById("drawerJumpRecipeBtn")?.addEventListener("click", () => {
    jumpToDishRecipe(dish.id);
  });
  document.getElementById("drawerEditRecipeBtn")?.addEventListener("click", () => {
    closeDishDrawer();
    openRecipeEditorModal(dish.id);
  });

  if (state.sousChef.open) {
    state.sousChef.open = false;
    document.getElementById("sousChefDrawer").classList.add("hidden");
    document.getElementById("sousChefFab").classList.remove("hidden");
  }
  document.getElementById("drawerBackdrop").classList.remove("hidden");
  document.getElementById("dishDrawer").classList.remove("hidden");
}

function buildLockTimeOptions(selectedMin) {
  const opts = [];
  const k = state.request.kitchen;
  const floor = k.earliest_start_min ?? k.day_before_start_min;
  const dessertReady = getDessertReadyMin(k);

  if (floor < DAY_MINUTES) {
    for (let m = Math.max(k.day_before_start_min, floor); m <= k.day_before_end_min - 30; m += 15) {
      opts.push(`<option value="${m}" ${m === selectedMin ? "selected" : ""}>Tonight · ${formatClock(m)}</option>`);
    }
  }
  for (let m = Math.max(k.day_of_start_min, floor); m <= dessertReady; m += 15) {
    opts.push(`<option value="${m}" ${m === selectedMin ? "selected" : ""}>Thanksgiving · ${formatClock(m)}</option>`);
  }
  if (!opts.some((o) => o.includes("selected"))) {
    opts.unshift(`<option value="${selectedMin}" selected>${formatFullTime(selectedMin)} (Current)</option>`);
  }
  return opts.join("");
}

function closeDishDrawer() {
  state.editingDishId = null;
  document.getElementById("drawerBackdrop").classList.add("hidden");
  document.getElementById("dishDrawer").classList.add("hidden");
}

async function applyDishDrawer(repair = false) {
  const dish = state.request.dishes.find((d) => d.id === state.editingDishId);
  if (!dish) return;

  dish.name = document.getElementById("edName").value.trim() || dish.name;
  dish.appliance = document.getElementById("edAppliance").value;
  dish.day_preference = document.getElementById("edDayPref").value;
  dish.cook_min = Math.max(5, Number(document.getElementById("edCookMin").value) || dish.cook_min);
  dish.temp_f = dish.appliance === "stovetop" && !dish.bread_dry_method ? null : Number(document.getElementById("edTempF").value) || 350;
  dish.prep_min = Math.max(0, Number(document.getElementById("edPrepMin").value) || 0);
  dish.rest_min = Math.max(0, Number(document.getElementById("edRestMin").value) || 0);

  if (document.getElementById("edTurkeyMethod")) {
    const prevWeight = dish.turkey_weight_lb;
    dish.turkey_method = document.getElementById("edTurkeyMethod").value;
    dish.turkey_weight_lb = Number(document.getElementById("edTurkeyWeight").value) || 25;
    if (prevWeight !== dish.turkey_weight_lb) {
      syncTurkeyDishName(dish, dish.turkey_weight_lb);
    }
    dish.probe_pull_f = Number(document.getElementById("edProbePull").value) || 158;
    dish.probe_target_f = Number(document.getElementById("edProbeTarget").value) || 165;
    if (state.turkeyMethods[dish.turkey_method]) {
      dish.technique_note = state.turkeyMethods[dish.turkey_method].note;
    }
  }
  if (document.getElementById("edBreadDry")) {
    dish.bread_dry_method = document.getElementById("edBreadDry").value;
  }
  if (document.getElementById("edBpMode")) {
    dish.bread_pudding_mode = document.getElementById("edBpMode").value;
  }
  if (document.getElementById("edPieMode")) {
    dish.pie_bake_mode = document.getElementById("edPieMode").value;
  }

  const locked = document.getElementById("edLockToggle").checked;
  dish.locked_cook_start_min = locked ? Number(document.getElementById("edLockMinute").value) : null;

  closeDishDrawer();
  await apiSolve(repair);
  showToast(repair ? "Applied with minimal-disruption repair!" : `Re-solved schedule for ${dish.emoji} ${dish.name}!`);
}

// ---------------------------------------------------------------------------
// Validator Modal
// ---------------------------------------------------------------------------
function openValidatorModal() {
  const list = document.getElementById("validatorChecksList");
  const val = state.plan?.validation;
  if (!val) {
    list.innerHTML = `<div class="v-row fail"><div><strong>No feasible schedule to verify.</strong><div class="small muted">${escapeHtml((state.plan?.diagnostics || []).join(" "))}</div></div></div>`;
  } else {
    list.innerHTML = val.checks
      .map(
        (c) => `
        <div class="v-row ${c.passed ? "pass" : "fail"}">
          <div style="font-size:16px">${c.passed ? "✅" : "❌"}</div>
          <div>
            <div><span class="v-code">${escapeHtml(c.id)}</span> · <strong>${escapeHtml(c.name)}</strong></div>
            <div class="small muted" style="margin-top:2px">${escapeHtml(c.detail)}</div>
          </div>
        </div>`
      )
      .join("");
  }
  document.getElementById("validatorModal").classList.remove("hidden");
}

// ---------------------------------------------------------------------------
// Global Event Listeners & Fun Scenarios
// ---------------------------------------------------------------------------
function wireGlobalListeners() {
  document.getElementById("dinnerTimeSelect").addEventListener("change", async (e) => {
    state.request.kitchen.dinner_ready_min = Number(e.target.value);
    await apiSolve(false);
  });

  document.getElementById("turkeyWeightSelect").addEventListener("change", async (e) => {
    const turkey = state.request.dishes.find((d) => d.id === "turkey");
    if (!turkey) return;
    const weightLb = Number(e.target.value);
    if (!Number.isFinite(weightLb) || weightLb < 8) return;
    const method = turkey.turkey_method || "convection_roast";
    const rec = await fetchTurkeyRecommendation(weightLb, method);
    const localRec = turkeyRecommendationBrowser(weightLb, method);
    turkey.turkey_weight_lb = weightLb;
    syncTurkeyDishName(turkey, weightLb);
    turkey.cook_min = rec?.cook_min ?? localRec.cook_min;
    // Use weight-scaled rest_min even if older backend returns static 55m
    turkey.rest_min =
      rec?.kosher_salt_tbsp !== undefined && rec?.rest_min ? rec.rest_min : localRec.rest_min;
    if (rec?.temp_f) turkey.temp_f = rec.temp_f;
    turkey.locked_cook_start_min = null;
    await apiSolve(false);
    showToast(
      `🦃 Updated to ${formatWeightValue(weightLb)} lb turkey (${turkey.cook_min}m cook · ${turkey.rest_min}m rest) — schedule re-solved!`
    );
  });

  document.getElementById("recipeScaleSelect").addEventListener("change", (e) => {
    const scale = safeNum(e.target.value, 1);
    state.request.kitchen.recipe_scale = scale;
    saveLocalState();
    renderRecipesSection();
    showToast(
      Math.abs(scale - 1) < 0.005
        ? "🍽️ Recipes & shopping list reset to 1× default scale."
        : `🍽️ Recipes & shopping list scaled to ${formatScaleMultiplier(scale)}!`
    );
  });

  document.getElementById("startFromSelect").addEventListener("change", async (e) => {
    const val = e.target.value;
    state.request.kitchen.earliest_start_min = val === "none" ? null : Number(val);
    if (val !== "none" && Number(val) >= DAY_MINUTES) {
      state.request.kitchen.day_of_start_min = Math.min(state.request.kitchen.day_of_start_min, Number(val));
      state.dayView = "day_of";
    }
    await apiSolve(false);
    showToast(
      val === "none"
        ? "Full 2-day planning enabled!"
        : `No time travel! Solving from ${formatFullTime(Number(val))} forward.`
    );
  });

  document.querySelectorAll("#dinnerQuickChips .chip").forEach((btn) => {
    btn.addEventListener("click", async () => {
      state.request.kitchen.dinner_ready_min = Number(btn.dataset.min);
      await apiSolve(false);
    });
  });

  document.getElementById("dessertOffsetSelect").addEventListener("change", async (e) => {
    state.request.kitchen.dessert_offset_min = Number(e.target.value);
    await apiSolve(false);
  });

  document.getElementById("cookCountSelect").addEventListener("change", async (e) => {
    state.request.kitchen.cook_count = Number(e.target.value);
    await apiSolve(false);
  });

  document.getElementById("upperConvectToggle").addEventListener("click", async () => {
    state.request.kitchen.upper_has_convection = !state.request.kitchen.upper_has_convection;
    await apiSolve(false);
    showToast(
      state.request.kitchen.upper_has_convection
        ? "Upper KitchenAid Convect/Air Fry ON — watch green beans jump up!"
        : "Upper unit set to Microwave Only — CP-SAT rerouted sides!"
    );
  });

  // Tune My Feast modal triggers
  document.getElementById("tuneFeastBtn").addEventListener("click", openTuneFeastModal);
  document.getElementById("openTuneFromMenuBtn").addEventListener("click", openTuneFeastModal);
  document.getElementById("closeTuneFeastBtn").addEventListener("click", closeTuneFeastModal);
  document.getElementById("cancelTuneFeastBtn").addEventListener("click", closeTuneFeastModal);
  document.getElementById("applyTuneFeastBtn").addEventListener("click", applyTuneFeastModal);
  document.getElementById("tuneFeastModal").addEventListener("click", (e) => {
    if (e.target.id === "tuneFeastModal") closeTuneFeastModal();
  });

  // Jump to Swimlane Gantt + Collapse toggle
  document.getElementById("jumpToGanttBtn").addEventListener("click", () => {
    if (state.ganttCollapsed) {
      state.ganttCollapsed = false;
      document.getElementById("ganttCollapsible").classList.remove("hidden");
      const toggleBtn = document.getElementById("toggleGanttBtn");
      toggleBtn.textContent = "Collapse ▲";
      toggleBtn.setAttribute("aria-expanded", "true");
    }
    document.getElementById("swimlaneSection").scrollIntoView({ behavior: "smooth", block: "start" });
  });

  document.getElementById("toggleGanttBtn").addEventListener("click", (e) => {
    state.ganttCollapsed = !state.ganttCollapsed;
    document.getElementById("ganttCollapsible").classList.toggle("hidden", state.ganttCollapsed);
    e.currentTarget.textContent = state.ganttCollapsed ? "Expand ▼" : "Collapse ▲";
    e.currentTarget.setAttribute("aria-expanded", String(!state.ganttCollapsed));
  });

  // Day view tabs
  document.querySelectorAll("#dayViewTabs .seg-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll("#dayViewTabs .seg-btn").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      state.dayView = btn.dataset.view;
      renderGantt();
    });
  });

  // Run sheet filter tabs
  document.querySelectorAll("#eventFilterTabs .seg-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll("#eventFilterTabs .seg-btn").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      state.eventFilter = btn.dataset.filter;
      renderRunSheet();
    });
  });

  // Fun Live Probe & Crisis Scenarios
  document.getElementById("scenarioFastBtn").addEventListener("click", async () => {
    const turkey = state.request.dishes.find((d) => d.id === "turkey");
    const solved = (state.plan?.tasks || []).find((t) => t.id === "turkey__cook");
    if (!turkey || !solved) return;
    turkey.locked_cook_start_min = solved.start_min;
    turkey.cook_min = Math.max(90, turkey.cook_min - 20);
    await apiSolve(true);
    showToast("⚡ Turkey probe 20m fast! Locked start & repaired schedule.");
  });

  document.getElementById("scenarioSlowBtn").addEventListener("click", async () => {
    const turkey = state.request.dishes.find((d) => d.id === "turkey");
    const solved = (state.plan?.tasks || []).find((t) => t.id === "turkey__cook");
    if (!turkey || !solved) return;
    turkey.locked_cook_start_min = solved.start_min;
    turkey.cook_min = Math.min(360, turkey.cook_min + 20);
    await apiSolve(true);
    showToast("🐢 Turkey running 20m slow! Locked start & ran CP-SAT repair.");
  });

  document.getElementById("scenarioSpatchcockBtn").addEventListener("click", async () => {
    const turkey = state.request.dishes.find((d) => d.id === "turkey");
    if (!turkey) return;
    const w = safeNum(turkey.turkey_weight_lb, 25);
    const rec = await fetchTurkeyRecommendation(w, "spatchcock");
    const localRec = turkeyRecommendationBrowser(w, "spatchcock");
    turkey.locked_cook_start_min = null;
    turkey.turkey_method = "spatchcock";
    turkey.temp_f = rec?.temp_f || 450;
    turkey.cook_min = rec?.cook_min || localRec.cook_min;
    turkey.rest_min =
      rec?.kosher_salt_tbsp !== undefined && rec?.rest_min ? rec.rest_min : localRec.rest_min;
    turkey.probe_pull_f = 155;
    if (state.turkeyMethods.spatchcock) turkey.technique_note = state.turkeyMethods.spatchcock.note;
    await apiSolve(false);
    showToast(`🍗 Switched ${formatWeightValue(w)} lb turkey to Kenji 450°F Spatchcock (${turkey.cook_min}m roast)!`);
  });

  document.getElementById("scenarioDayOfPiesBtn").addEventListener("click", async () => {
    state.request.dishes.forEach((d) => {
      if (d.id === "sweet_potato_pie" || d.id === "pumpkin_pie") {
        d.day_preference = "day_of";
      }
    });
    state.dayView = "day_of";
    await apiSolve(false);
    showToast("🥧 Pinned both pies to Thanksgiving Day — check how CP-SAT handles the morning oven!");
  });

  document.getElementById("clearLocksBtn").addEventListener("click", async () => {
    state.request.dishes.forEach((d) => (d.locked_cook_start_min = null));
    await apiSolve(false);
    showToast("🔓 All dish locks cleared!");
  });

  // Add dish dropdown
  const addBtn = document.getElementById("addDishBtn");
  const addMenu = document.getElementById("addDishMenu");
  addBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    addMenu.classList.toggle("hidden");
  });
  document.addEventListener("click", () => addMenu.classList.add("hidden"));

  // Drawer buttons
  document.getElementById("closeDrawerBtn").addEventListener("click", closeDishDrawer);
  document.getElementById("drawerBackdrop").addEventListener("click", closeAllDrawers);
  document.getElementById("drawerApplyBtn").addEventListener("click", () => applyDishDrawer(false));
  document.getElementById("drawerRepairBtn").addEventListener("click", () => applyDishDrawer(true));
  document.getElementById("drawerDeleteBtn").addEventListener("click", async () => {
    state.request.dishes = state.request.dishes.filter((d) => d.id !== state.editingDishId);
    closeDishDrawer();
    await apiSolve(false);
    showToast("Dish removed from feast.");
  });

  // Sous-Chef Drawer & Tinker Controls
  wireSousChefListeners();

  // Validator modal
  document.getElementById("validatorBadge").addEventListener("click", openValidatorModal);
  document.getElementById("closeValidatorBtn").addEventListener("click", () =>
    document.getElementById("validatorModal").classList.add("hidden")
  );
  document.getElementById("validatorModal").addEventListener("click", (e) => {
    if (e.target.id === "validatorModal") e.target.classList.add("hidden");
  });

  // Recipe Editor modal
  document.getElementById("closeRecipeEditorBtn").addEventListener("click", closeRecipeEditorModal);
  document.getElementById("cancelRecipeEditorBtn").addEventListener("click", closeRecipeEditorModal);
  document.getElementById("saveRecipeEditorBtn").addEventListener("click", saveRecipeEditorModal);
  document.getElementById("resetRecipeEditorBtn").addEventListener("click", resetRecipeEditorModal);
  document.getElementById("recipeEditorModal").addEventListener("click", (e) => {
    if (e.target.id === "recipeEditorModal") closeRecipeEditorModal();
  });

  // Escape key closes modals / drawers
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    closeAllDrawers();
    closeTuneFeastModal();
    closeRecipeEditorModal();
    document.getElementById("validatorModal").classList.add("hidden");
  });

  // Topbar smooth-scroll to Recipes & Gear
  document.getElementById("recipesJumpBtn").addEventListener("click", () => {
    document.getElementById("recipesSection").scrollIntoView({ behavior: "smooth", block: "start" });
  });

  // Recipes & Things You Might Need segmented tabs
  document.querySelectorAll("#recipesSectionTabs .seg-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      setRecipesTab(btn.dataset.tab);
    });
  });

  // Reset Gear / Shopping checklist
  document.getElementById("resetGearChecksBtn").addEventListener("click", () => {
    state.checkedItems.clear();
    saveCheckedItems();
    renderGearChecklists(getEnabledDishes());
    showToast("↺ Cleared shopping & gear checkmarks.");
  });

  // Share / Print / Reset
  document.getElementById("shareBtn").addEventListener("click", async () => {
    const encoded = encodePlanHash(state.request);
    const url = `${window.location.origin}${window.location.pathname}#plan=${encoded}`;
    window.history.replaceState(null, "", `#plan=${encoded}`);
    try {
      await navigator.clipboard.writeText(url);
      showToast("🔗 Shareable feast link copied to clipboard!");
    } catch {
      showToast("🔗 Shareable link updated in your browser address bar!");
    }
  });

  document.getElementById("printBtn").addEventListener("click", () => window.print());

  document.getElementById("resetBtn").addEventListener("click", async () => {
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem(CHECKED_KEY);
    localStorage.removeItem(RECIPE_OVERRIDES_KEY);
    state.checkedEvents.clear();
    state.recipeOverrides = {};
    window.history.replaceState(null, "", window.location.pathname);
    const data = await loadDefaultData();
    state.request = data.request;
    if (state.request.kitchen.recipe_scale === undefined) {
      state.request.kitchen.recipe_scale = 1;
    }
    ingestRecipesPayload(data);
    await ensureRecipesLoaded();
    const liveMin = computeLiveStartMinute();
    state.request.kitchen.earliest_start_min = liveMin;
    if (liveMin < DAY_MINUTES) state.dayView = "both";
    await apiSolve(false);
    showToast("↺ Reset to live-clock 25 lb KitchenAid Thanksgiving Feast!");
  });
}

// ---------------------------------------------------------------------------
// Inkling 2 Mini Sous-Chef (Thinking Machines · Tinker API)
// ---------------------------------------------------------------------------
function getSessionTinkerKey() {
  try {
    return (sessionStorage.getItem(TINKER_SESSION_KEY) || "").trim();
  } catch {
    return "";
  }
}

function setSessionTinkerKey(val) {
  try {
    const cleaned = String(val || "").trim();
    if (cleaned) {
      sessionStorage.setItem(TINKER_SESSION_KEY, cleaned);
    } else {
      sessionStorage.removeItem(TINKER_SESSION_KEY);
    }
  } catch {
    // Ignore sessionStorage restrictions
  }
}

function getSessionSousChefPin() {
  try {
    return (sessionStorage.getItem(TINKER_PIN_SESSION_KEY) || "").trim();
  } catch {
    return "";
  }
}

function setSessionSousChefPin(val) {
  try {
    const cleaned = String(val || "").trim();
    if (cleaned) {
      sessionStorage.setItem(TINKER_PIN_SESSION_KEY, cleaned);
    } else {
      sessionStorage.removeItem(TINKER_PIN_SESSION_KEY);
    }
  } catch {
    // Ignore sessionStorage restrictions
  }
}

function isSousChefConfigured() {
  const mode = state.sousChef.mode || "local";
  const hasKey = Boolean(getSessionTinkerKey());
  const hasPin = Boolean(getSessionSousChefPin());

  if (mode === "byok") return hasKey;
  if (mode === "pin_protected") return hasKey || (hasPin && state.sousChef.serverConfigured);
  if (mode === "public_free") return Boolean(state.sousChef.serverConfigured || hasKey);
  return Boolean(state.sousChef.serverConfigured || hasKey);
}

function initSousChefState() {
  try {
    const savedModel = sessionStorage.getItem(TINKER_MODEL_SESSION_KEY);
    if (savedModel) state.sousChef.model = savedModel;
  } catch {
    // Ignore
  }
  const modelSel = document.getElementById("sousChefModelSelect");
  if (modelSel) {
    if ([...modelSel.options].some((o) => o.value === state.sousChef.model)) {
      modelSel.value = state.sousChef.model;
    } else {
      state.sousChef.model = modelSel.value || DEFAULT_TINKER_MODEL;
    }
  }
  const keyInput = document.getElementById("sousChefApiKeyInput");
  if (keyInput) {
    keyInput.value = getSessionTinkerKey();
  }
  const pinInput = document.getElementById("sousChefPinInput");
  if (pinInput) {
    pinInput.value = getSessionSousChefPin();
  }
  updateSousChefStatusUI();
  renderSousChefMessages();
}

function setSousChefSettingsOpen(open) {
  state.sousChef.settingsOpen = Boolean(open);
  const panel = document.getElementById("sousChefSettingsPanel");
  const btn = document.getElementById("sousChefSettingsBtn");
  if (panel) panel.classList.toggle("hidden", !state.sousChef.settingsOpen);
  if (btn) btn.setAttribute("aria-expanded", String(state.sousChef.settingsOpen));
}

function updateSousChefStatusUI() {
  const mode = state.sousChef.mode || "local";
  const configured = isSousChefConfigured();
  const hasSessionKey = Boolean(getSessionTinkerKey());
  const hasSessionPin = Boolean(getSessionSousChefPin());
  const topDot = document.getElementById("sousChefStatusDot");
  const fabDot = document.getElementById("sousChefFabDot");
  const pill = document.getElementById("sousChefConnPill");
  const hint = document.getElementById("sousChefKeyHint");
  const pinRow = document.getElementById("sousChefPinRow");
  const pinHint = document.getElementById("sousChefPinHint");
  const modeBanner = document.getElementById("sousChefModeBanner");
  const apiKeyLabel = document.getElementById("sousChefApiKeyLabel");

  const dotClass = !state.sousChef.statusChecked && !hasSessionKey && !hasSessionPin
    ? "sc-dot sc-dot-pending"
    : configured
    ? "sc-dot sc-dot-connected"
    : "sc-dot sc-dot-key";

  if (topDot) topDot.className = dotClass;
  if (fabDot) fabDot.className = dotClass;

  // Toggle Host Access PIN row strictly for pin_protected mode
  if (pinRow) {
    pinRow.classList.toggle("hidden", mode !== "pin_protected");
  }

  if (apiKeyLabel) {
    if (mode === "byok") {
      apiKeyLabel.innerHTML = `Your Session TINKER_API_KEY <span class="muted">(BYOK · tab session only)</span>`;
    } else if (mode === "pin_protected") {
      apiKeyLabel.innerHTML = `Or Bring Your Own TINKER_API_KEY <span class="muted">(optional alternative to PIN)</span>`;
    } else {
      apiKeyLabel.innerHTML = `Session TINKER_API_KEY <span class="muted">(optional if set in .env)</span>`;
    }
  }

  if (modeBanner) {
    if (mode === "byok") {
      modeBanner.className = "sc-mode-banner";
      modeBanner.textContent =
        "Public graybeam.tech mode: your Tinker key stays in browser session memory only and is never stored on the server.";
    } else if (mode === "pin_protected") {
      modeBanner.className = "sc-mode-banner mode-pin";
      modeBanner.textContent =
        "Host-protected public mode: enter the Host Access PIN or paste your own Tinker API key (both stay in sessionStorage only).";
    } else if (mode === "public_free") {
      modeBanner.className = "sc-mode-banner mode-public-free";
      modeBanner.textContent =
        "Public Free-Tier Connected: ready to chat right away! You can optionally enter your own Tinker key for higher limits.";
    } else {
      modeBanner.className = "sc-mode-banner hidden";
      modeBanner.textContent = "";
    }
  }

  if (pill) {
    if (!state.sousChef.statusChecked && !hasSessionKey && !hasSessionPin) {
      pill.className = "pill pill-neutral pill-compact pill-btn";
      pill.textContent = "⏳ Checking…";
    } else if (mode === "public_free") {
      if (hasSessionKey) {
        pill.className = "pill pill-success pill-compact pill-btn";
        pill.textContent = "🟢 Connected (BYOK)";
      } else if (state.sousChef.serverConfigured) {
        pill.className = "pill pill-success pill-compact pill-btn";
        pill.textContent = "🟢 Free-Tier Connected";
      } else {
        pill.className = "pill pill-warning pill-compact pill-btn";
        pill.textContent = "🔑 Add Tinker Key";
      }
    } else if (mode === "pin_protected") {
      if (hasSessionKey) {
        pill.className = "pill pill-success pill-compact pill-btn";
        pill.textContent = "🟢 BYOK Connected";
      } else if (hasSessionPin) {
        pill.className = "pill pill-success pill-compact pill-btn";
        pill.textContent = "🟢 PIN Unlocked";
      } else {
        pill.className = "pill pill-warning pill-compact pill-btn";
        pill.textContent = "🔐 PIN or Tinker Key";
      }
    } else if (mode === "byok") {
      if (hasSessionKey) {
        pill.className = "pill pill-success pill-compact pill-btn";
        pill.textContent = "🟢 BYOK Connected";
      } else {
        pill.className = "pill pill-warning pill-compact pill-btn";
        pill.textContent = "🔑 Bring Your Own Tinker Key";
      }
    } else if (configured) {
      pill.className = "pill pill-success pill-compact pill-btn";
      pill.textContent = "🟢 Connected";
    } else {
      pill.className = "pill pill-warning pill-compact pill-btn";
      pill.textContent = "🔑 Add Tinker Key";
    }
    pill.title = `${pill.textContent} — click to configure`;
  }

  if (pinHint) {
    pinHint.textContent = hasSessionPin
      ? "Host PIN active for this browser tab (sessionStorage only · sent via X-Sous-Chef-Pin; never saved to localStorage or #plan= links)."
      : "Kept only in this browser tab's sessionStorage and sent via X-Sous-Chef-Pin — never saved to localStorage or #plan= links.";
  }

  if (hint) {
    if (mode === "byok") {
      hint.textContent = hasSessionKey
        ? "Public graybeam.tech mode: your Tinker key is active in browser session memory only (X-Tinker-Api-Key) and is never stored on the server."
        : "Public graybeam.tech mode: your Tinker key stays in browser session memory only and is never stored on the server.";
    } else if (hasSessionKey) {
      hint.textContent =
        "Session key active (stored only in sessionStorage; sent via X-Tinker-Api-Key header; never included in #plan= links or localStorage).";
    } else if (mode === "pin_protected") {
      hint.textContent =
        "Optionally paste your own Tinker API key (sessionStorage only) to bypass the Host Access PIN.";
    } else if (mode === "public_free") {
      hint.textContent =
        "Free-tier public access is active. Optionally paste your own Tinker key above (sessionStorage only).";
    } else if (state.sousChef.serverConfigured) {
      hint.textContent =
        "Connected via server TINKER_API_KEY (.env). You can optionally override it for this browser tab above.";
    } else {
      hint.textContent =
        "No TINKER_API_KEY found on server yet — paste a key above (sessionStorage only) or set TINKER_API_KEY in your .env file.";
    }
  }
}

async function fetchSousChefStatus() {
  try {
    const res = await fetch("/api/sous-chef/status");
    const ct = (res.headers.get("content-type") || "").toLowerCase();
    if (res.ok && ct.includes("application/json")) {
      const data = await res.json();
      state.sousChef.serverConfigured = Boolean(data.configured);
      if (typeof data.mode === "string" && data.mode.trim()) {
        state.sousChef.mode = data.mode.trim();
      } else {
        state.sousChef.mode = "local";
      }
      state.sousChef.pinRequired = Boolean(
        data.pin_required ?? data.requires_pin ?? state.sousChef.mode === "pin_protected"
      );
      if (data.default_model) {
        let savedModel = null;
        try {
          savedModel = sessionStorage.getItem(TINKER_MODEL_SESSION_KEY);
        } catch {
          savedModel = null;
        }
        const modelSel = document.getElementById("sousChefModelSelect");
        if (!savedModel && modelSel && [...modelSel.options].some((o) => o.value === data.default_model)) {
          state.sousChef.model = data.default_model;
          modelSel.value = data.default_model;
        }
      }
    } else {
      state.sousChef.serverConfigured = false;
    }
  } catch {
    state.sousChef.serverConfigured = false;
  } finally {
    state.sousChef.statusChecked = true;
    updateSousChefStatusUI();
    if (state.sousChef.open && !isSousChefConfigured()) {
      setSousChefSettingsOpen(true);
    }
  }
}

function openSousChefDrawer() {
  if (state.editingDishId !== null) {
    state.editingDishId = null;
    document.getElementById("dishDrawer").classList.add("hidden");
  }
  state.sousChef.open = true;
  document.getElementById("drawerBackdrop").classList.remove("hidden");
  document.getElementById("sousChefDrawer").classList.remove("hidden");
  document.getElementById("sousChefFab").classList.add("hidden");

  if (!state.sousChef.statusChecked) {
    fetchSousChefStatus();
  } else if (!isSousChefConfigured()) {
    setSousChefSettingsOpen(true);
  }
  renderSousChefMessages();
  setTimeout(() => document.getElementById("sousChefInput")?.focus(), 40);
}

function closeSousChefDrawer() {
  if (!state.sousChef.open) return;
  state.sousChef.open = false;
  document.getElementById("sousChefDrawer").classList.add("hidden");
  document.getElementById("sousChefFab").classList.remove("hidden");
  if (state.editingDishId === null) {
    document.getElementById("drawerBackdrop").classList.add("hidden");
  }
}

function closeAllDrawers() {
  closeDishDrawer();
  closeSousChefDrawer();
  document.getElementById("drawerBackdrop").classList.add("hidden");
}

function renderMarkdownLite(rawText) {
  const text = String(rawText ?? "").replace(/\r\n/g, "\n").trim();
  if (!text) return "";

  const formatInline = (line) => {
    let s = escapeHtml(line);
    s = s.replace(/`([^`]+)`/g, "<code>$1</code>");
    s = s.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
    s = s.replace(/(^|[\s(])\*([^*\n]+)\*(?=[\s).,!?:;]|$)/g, "$1<em>$2</em>");
    return s;
  };

  const lines = text.split("\n");
  const out = [];
  let inUl = false;
  let inOl = false;
  let paraLines = [];

  const flushPara = () => {
    if (!paraLines.length) return;
    out.push(`<p>${paraLines.map(formatInline).join("<br />")}</p>`);
    paraLines = [];
  };
  const closeLists = () => {
    if (inUl) {
      out.push("</ul>");
      inUl = false;
    }
    if (inOl) {
      out.push("</ol>");
      inOl = false;
    }
  };

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) {
      flushPara();
      closeLists();
      continue;
    }
    const hMatch = line.match(/^#{1,4}\s+(.+)$/);
    if (hMatch) {
      flushPara();
      closeLists();
      out.push(`<h4>${formatInline(hMatch[1])}</h4>`);
      continue;
    }
    const ulMatch = line.match(/^[-*•]\s+(.+)$/);
    if (ulMatch) {
      flushPara();
      if (inOl) {
        out.push("</ol>");
        inOl = false;
      }
      if (!inUl) {
        out.push("<ul>");
        inUl = true;
      }
      out.push(`<li>${formatInline(ulMatch[1])}</li>`);
      continue;
    }
    const olMatch = line.match(/^\d+[.)]\s+(.+)$/);
    if (olMatch) {
      flushPara();
      if (inUl) {
        out.push("</ul>");
        inUl = false;
      }
      if (!inOl) {
        out.push("<ol>");
        inOl = true;
      }
      out.push(`<li>${formatInline(olMatch[1])}</li>`);
      continue;
    }
    closeLists();
    paraLines.push(line);
  }
  flushPara();
  closeLists();
  return out.join("");
}

function parseClockToThuMinute(val) {
  if (typeof val === "number" && Number.isFinite(val)) {
    return val < DAY_MINUTES ? DAY_MINUTES + Math.round(val) : Math.round(val);
  }
  const s = String(val || "").trim();
  const numOnly = Number(s);
  if (s && Number.isFinite(numOnly)) {
    return numOnly < DAY_MINUTES ? DAY_MINUTES + Math.round(numOnly) : Math.round(numOnly);
  }
  const m = s.match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i);
  if (!m) return null;
  let h = Number(m[1]);
  const mins = Number(m[2] || 0);
  const ampm = (m[3] || "").toLowerCase();
  if (ampm === "pm" && h < 12) h += 12;
  if (ampm === "am" && h === 12) h = 0;
  if (!ampm && h >= 1 && h <= 9) h += 12; // Assume afternoon/evening Thanksgiving dinner
  return DAY_MINUTES + h * 60 + mins;
}

function normalizeProposedAction(raw) {
  if (!raw || typeof raw !== "object") return { op: "unknown", data: {} };
  const op = String(raw.op || raw.type || raw.action || "").trim();
  const nested = raw.params || raw.args || {};
  return { op, data: { ...nested, ...raw } };
}

function findDishByIdOrName(dishRef) {
  if (!dishRef || !state.request?.dishes) return null;
  const ref = String(dishRef).trim();
  return (
    state.request.dishes.find((d) => d.id === ref) ||
    state.request.dishes.find((d) => d.name.toLowerCase() === ref.toLowerCase()) ||
    state.request.dishes.find((d) => d.id.toLowerCase().includes(ref.toLowerCase()))
  );
}

function describeProposedAction(raw) {
  const { op, data } = normalizeProposedAction(raw);
  if (data.summary && typeof data.summary === "string") return data.summary;
  if (data.label && typeof data.label === "string") return data.label;

  if (op === "set_dinner_time") {
    const target = parseClockToThuMinute(
      data.dinner_ready_min ?? data.minute ?? data.time ?? data.value
    );
    return target !== null
      ? `Set Dinner Ready-By to Thu ${formatClock(target)}`
      : "Update Dinner Ready-By time";
  }

  if (op === "update_dish") {
    const dish = findDishByIdOrName(data.dish_id || data.id);
    const dishName = dish ? `${dish.emoji} ${dish.name}` : data.dish_id || data.id || "dish";
    const updates = data.updates || data.fields || data.changes || data;
    const parts = [];
    if (updates.cook_min !== undefined) parts.push(`cook ${updates.cook_min}m`);
    if (updates.temp_f !== undefined) parts.push(`${updates.temp_f}°F`);
    if (updates.appliance !== undefined) parts.push(`appliance → ${updates.appliance}`);
    if (updates.day_preference !== undefined) parts.push(`day → ${updates.day_preference}`);
    if (updates.prep_min !== undefined) parts.push(`prep ${updates.prep_min}m`);
    if (updates.rest_min !== undefined) parts.push(`rest ${updates.rest_min}m`);
    if (updates.turkey_method !== undefined) parts.push(`method → ${updates.turkey_method}`);
    if (updates.turkey_weight_lb !== undefined) parts.push(`${updates.turkey_weight_lb} lb`);
    if (updates.bread_dry_method !== undefined) parts.push(`bread dry → ${updates.bread_dry_method}`);
    if (updates.bread_pudding_mode !== undefined) parts.push(`mode → ${updates.bread_pudding_mode}`);
    if (updates.pie_bake_mode !== undefined) parts.push(`bake → ${updates.pie_bake_mode}`);
    if (updates.locked_cook_start_min !== undefined) {
      parts.push(
        updates.locked_cook_start_min === null
          ? "unlock start"
          : `pin ${formatFullTime(updates.locked_cook_start_min)}`
      );
    }
    return `Update ${dishName}${parts.length ? `: ${parts.join(", ")}` : ""}`;
  }

  if (op === "add_template") {
    const key = data.template_id || data.template_key || data.template || data.id;
    const tpl =
      state.quickAddTemplates[key] ||
      Object.values(state.quickAddTemplates).find((t) => t.id === key);
    return tpl ? `Add ${tpl.emoji} ${tpl.name} to menu` : `Add template "${key}" to menu`;
  }

  if (op === "toggle_dish") {
    const dish = findDishByIdOrName(data.dish_id || data.id);
    const dishName = dish ? `${dish.emoji} ${dish.name}` : data.dish_id || data.id || "dish";
    if (typeof data.enabled === "boolean") {
      return `${data.enabled ? "Enable" : "Disable"} ${dishName}`;
    }
    return `Toggle ${dishName}`;
  }

  if (op === "set_upper_convection") {
    const on = data.enabled ?? data.upper_has_convection ?? data.value;
    if (typeof on === "boolean") {
      return `Set KitchenAid Upper Unit to ${on ? "Convect + Air Fry ON" : "Microwave Only"}`;
    }
    return "Toggle KitchenAid Upper Convection mode";
  }

  return `Apply ${op || "schedule update"}`;
}

async function applyProposedActions(actions, forceRepair = null) {
  if (!Array.isArray(actions) || !actions.length || !state.request) {
    return { appliedCount: 0, status: "noop" };
  }

  const ALLOWED_DISH_FIELDS = new Set([
    "name",
    "appliance",
    "temp_f",
    "prep_min",
    "cook_min",
    "rest_min",
    "racks",
    "day_preference",
    "anchor",
    "max_hold_min",
    "requires_chill_min",
    "temper_min",
    "reheat_min",
    "carve_min",
    "enabled",
    "turkey_method",
    "turkey_weight_lb",
    "probe_pull_f",
    "probe_target_f",
    "bread_dry_method",
    "bread_pudding_mode",
    "pie_bake_mode",
    "locked_cook_start_min",
    "technique_note",
  ]);

  let appliedCount = 0;
  let structuralChange = false;

  for (const raw of actions) {
    const { op, data } = normalizeProposedAction(raw);

    if (op === "set_dinner_time") {
      const target = parseClockToThuMinute(
        data.dinner_ready_min ?? data.minute ?? data.time ?? data.value
      );
      if (target !== null) {
        const clamped = Math.max(DAY_MINUTES + 12 * 60, Math.min(DAY_MINUTES + 21 * 60, target));
        state.request.kitchen.dinner_ready_min = clamped;
        if (typeof data.dessert_offset_min === "number" && Number.isFinite(data.dessert_offset_min)) {
          state.request.kitchen.dessert_offset_min = data.dessert_offset_min;
        }
        appliedCount += 1;
        structuralChange = true;
      }
    } else if (op === "update_dish") {
      const dish = findDishByIdOrName(data.dish_id || data.id);
      if (dish) {
        const patch = data.updates || data.fields || data.changes || data;
        let touched = false;
        for (const [k, v] of Object.entries(patch)) {
          if (!ALLOWED_DISH_FIELDS.has(k) || v === undefined) continue;
          dish[k] = v;
          touched = true;
        }
        if (patch.turkey_method && state.turkeyMethods[patch.turkey_method] && !patch.technique_note) {
          dish.technique_note = state.turkeyMethods[patch.turkey_method].note;
        }
        if (dish.appliance === "stovetop" && !dish.bread_dry_method) {
          dish.temp_f = null;
        }
        if (touched) appliedCount += 1;
      }
    } else if (op === "add_template") {
      const key = data.template_id || data.template_key || data.template || data.id;
      const tpl =
        state.quickAddTemplates[key] ||
        Object.values(state.quickAddTemplates).find(
          (t) => t.id === key || t.name.toLowerCase() === String(key || "").toLowerCase()
        );
      if (tpl) {
        const existing = state.request.dishes.find((d) => d.id === tpl.id);
        if (existing) {
          existing.enabled = true;
        } else {
          state.request.dishes.push(structuredClone(tpl));
        }
        appliedCount += 1;
        structuralChange = true;
      }
    } else if (op === "toggle_dish") {
      const dish = findDishByIdOrName(data.dish_id || data.id);
      if (dish) {
        dish.enabled = typeof data.enabled === "boolean" ? data.enabled : !dish.enabled;
        appliedCount += 1;
      }
    } else if (op === "set_upper_convection") {
      const val = data.enabled ?? data.upper_has_convection ?? data.value;
      state.request.kitchen.upper_has_convection =
        typeof val === "boolean" ? val : !state.request.kitchen.upper_has_convection;
      appliedCount += 1;
      structuralChange = true;
    }
  }

  const useRepair =
    forceRepair !== null
      ? Boolean(forceRepair)
      : Boolean(state.plan?.tasks?.length && !structuralChange);

  await apiSolve(useRepair);

  const plan = state.plan;
  const ok = plan && (plan.status === "optimal" || plan.status === "feasible");
  if (ok) {
    const modeLabel = useRepair ? "Minimal Repair" : "Full Solve";
    const checks = plan.validation?.checks || [];
    const passed = checks.filter((c) => c.passed).length;
    showToast(`⚡ Applied ${appliedCount} update(s) · CP-SAT ${plan.status.toUpperCase()} (${passed}/${checks.length} verified)!`);
    return {
      appliedCount,
      ok: true,
      summary: `${modeLabel} · CP-SAT ${plan.status.toUpperCase()} (${passed}/${checks.length} invariants ✓)`,
    };
  }
  showToast("⚠ Applied update — CP-SAT flagged an infeasibility. Check the top banner.");
  return {
    appliedCount,
    ok: false,
    summary: "Applied · CP-SAT flagged constraint conflict (see banner)",
  };
}

function renderSousChefMessages() {
  const container = document.getElementById("sousChefMessages");
  const clearBtn = document.getElementById("sousChefClearChatBtn");
  if (!container) return;

  const msgs = state.sousChef.messages;
  if (clearBtn) clearBtn.classList.toggle("hidden", msgs.length === 0);

  if (!msgs.length && !state.sousChef.busy) {
    container.innerHTML = `
      <div class="sc-welcome-card">
        <div class="sc-welcome-title">✨ Meet Your Inkling 2 Mini Sous-Chef</div>
        <p>
          Powered by Thinking Machines' <strong>Tinker API</strong>. I automatically see your live KitchenAid schedule, oven temps, and CP-SAT run sheet — ask a question, tap a starter chip above, or snap a photo 📷 of your turkey, pan, or oven racks.
        </p>
      </div>`;
    return;
  }

  let html = "";
  for (const m of msgs) {
    const roleClass = m.role === "user" ? "sc-msg-user" : "sc-msg-assistant";
    const errClass = m.isError ? "sc-msg-error" : "";
    const imgHtml = m.imageDataUrl
      ? `<img src="${m.imageDataUrl}" class="sc-msg-img" alt="Attached kitchen photo" />`
      : "";
    const contentHtml =
      m.role === "user"
        ? `${imgHtml}${m.text ? `<div>${escapeHtml(m.text).replace(/\n/g, "<br />")}</div>` : ""}`
        : renderMarkdownLite(m.text);

    let actionsHtml = "";
    if (m.role === "assistant" && Array.isArray(m.proposedActions) && m.proposedActions.length > 0) {
      const bullets = m.proposedActions
        .map((a) => `<li>${escapeHtml(describeProposedAction(a))}</li>`)
        .join("");
      const appliedBadge = m.applied
        ? `<span class="small">${escapeHtml(m.appliedSummary || "Applied & Verified ✓")}</span>`
        : "";
      actionsHtml = `
        <div class="sc-actions-card ${m.applied ? "is-applied" : ""}" data-msg-id="${escapeHtml(m.id)}">
          <div class="sc-actions-title">
            <span>${m.applied ? "✅ Schedule Update Applied" : "⚡ Proposed Schedule Update"}</span>
            ${appliedBadge}
          </div>
          <ul class="sc-actions-list">${bullets}</ul>
          <div class="sc-actions-btns">
            <button type="button" class="btn btn-primary btn-sm sc-apply-actions-btn" data-msg-id="${escapeHtml(m.id)}" ${m.applied ? "disabled" : ""}>
              ${m.applied ? "✓ Applied & Verified" : "⚡ Apply & Verify with CP-SAT"}
            </button>
          </div>
        </div>`;
    }

    const metaHtml = m.meta ? `<div class="sc-msg-meta">${escapeHtml(m.meta)}</div>` : "";

    html += `
      <div class="sc-msg ${roleClass} ${errClass}">
        <div class="sc-bubble">${contentHtml}</div>
        ${actionsHtml}
        ${metaHtml}
      </div>`;
  }

  if (state.sousChef.busy) {
    html += `
      <div class="sc-msg sc-msg-assistant">
        <div class="sc-bubble">
          <div class="sc-typing">
            <span>✨ Inkling 2 Mini is thinking</span>
            <span class="sc-typing-dots" aria-hidden="true"><span></span><span></span><span></span></span>
          </div>
        </div>
      </div>`;
  }

  container.innerHTML = html;

  container.querySelectorAll(".sc-apply-actions-btn").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const msg = state.sousChef.messages.find((item) => item.id === btn.dataset.msgId);
      if (!msg || !msg.proposedActions?.length || msg.applied) return;
      btn.disabled = true;
      btn.textContent = "⚡ Verifying with CP-SAT…";
      const result = await applyProposedActions(msg.proposedActions);
      msg.applied = true;
      msg.appliedSummary = result.summary;
      renderSousChefMessages();
    });
  });

  container.scrollTop = container.scrollHeight;
}

function clearPendingSousChefImage() {
  state.sousChef.pendingImageDataUrl = null;
  state.sousChef.pendingImageLabel = "";
  const preview = document.getElementById("sousChefImagePreview");
  const thumb = document.getElementById("sousChefImageThumb");
  const fileInput = document.getElementById("sousChefPhotoInput");
  if (preview) preview.classList.add("hidden");
  if (thumb) thumb.removeAttribute("src");
  if (fileInput) fileInput.value = "";
}

function resizeImageFileToDataUrl(file, maxEdge = 1024) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Could not read image file."));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error("Unsupported image format."));
      img.onload = () => {
        const origW = img.naturalWidth || img.width;
        const origH = img.naturalHeight || img.height;
        const scale = Math.min(1, maxEdge / Math.max(origW, origH, 1));
        const targetW = Math.max(1, Math.round(origW * scale));
        const targetH = Math.max(1, Math.round(origH * scale));
        const canvas = document.createElement("canvas");
        canvas.width = targetW;
        canvas.height = targetH;
        const ctx = canvas.getContext("2d");
        ctx.drawImage(img, 0, 0, targetW, targetH);
        const dataUrl = canvas.toDataURL("image/jpeg", 0.85);
        const approxKb = Math.round((dataUrl.length * 3) / 4 / 1024);
        resolve({ dataUrl, width: targetW, height: targetH, kb: approxKb });
      };
      img.src = String(reader.result || "");
    };
    reader.readAsDataURL(file);
  });
}

async function handleSousChefPhotoFile(file) {
  if (!file || !file.type.startsWith("image/")) {
    showToast("Please choose an image file.");
    return;
  }
  try {
    const resized = await resizeImageFileToDataUrl(file, 1024);
    state.sousChef.pendingImageDataUrl = resized.dataUrl;
    state.sousChef.pendingImageLabel = `${resized.width}×${resized.height} · ~${resized.kb} KB`;
    document.getElementById("sousChefImageThumb").src = resized.dataUrl;
    document.getElementById("sousChefImageMeta").textContent = `Photo ready (${state.sousChef.pendingImageLabel})`;
    document.getElementById("sousChefImagePreview").classList.remove("hidden");
    document.getElementById("sousChefInput")?.focus();
  } catch (err) {
    showToast(err?.message || "Could not process photo.");
  }
}

async function sendSousChefMessage(promptOverride = null) {
  if (state.sousChef.busy) return;

  const inputEl = document.getElementById("sousChefInput");
  const rawText = promptOverride !== null ? promptOverride : inputEl.value;
  const messageText = String(rawText || "").trim();
  const imageDataUrl = state.sousChef.pendingImageDataUrl;

  if (!messageText && !imageDataUrl) return;

  const effectiveMessage =
    messageText || "Please inspect this kitchen photo and tell me how it affects my Thanksgiving schedule.";

  const recentTurns = state.sousChef.messages
    .filter((m) => !m.isError && m.text)
    .slice(-10)
    .map((m) => ({ role: m.role, content: m.text }));

  state.sousChef.messages.push({
    id: `u_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
    role: "user",
    text: effectiveMessage,
    imageDataUrl: imageDataUrl || null,
  });

  if (promptOverride === null && inputEl) {
    inputEl.value = "";
    inputEl.style.height = "auto";
  }
  clearPendingSousChefImage();

  state.sousChef.busy = true;
  const sendBtn = document.getElementById("sousChefSendBtn");
  if (sendBtn) sendBtn.disabled = true;
  renderSousChefMessages();

  const headers = { "Content-Type": "application/json" };
  const sessionKey = getSessionTinkerKey();
  if (sessionKey) {
    headers["X-Tinker-Api-Key"] = sessionKey;
  }
  const sessionPin = getSessionSousChefPin();
  if (sessionPin) {
    headers["X-Sous-Chef-Pin"] = sessionPin;
  }

  try {
    const res = await fetch("/api/sous-chef/ask", {
      method: "POST",
      headers,
      body: JSON.stringify({
        message: effectiveMessage,
        request: state.request,
        plan: state.plan,
        image_data_url: imageDataUrl || null,
        model: state.sousChef.model,
        history: recentTurns,
      }),
    });

    let data = {};
    try {
      data = await res.json();
    } catch {
      data = {};
    }

    if (res.status === 401 || res.status === 403) {
      setSousChefSettingsOpen(true);
      updateSousChefStatusUI();
      const authDetail =
        data.detail ||
        data.error ||
        data.reply ||
        (state.sousChef.mode === "pin_protected"
          ? "Enter a valid Host Access PIN or your own Tinker API key in the settings panel above."
          : "Enter your Tinker API key in the settings panel above.");
      state.sousChef.messages.push({
        id: `a_${Date.now().toString(36)}`,
        role: "assistant",
        text: `**Access required:** ${authDetail}`,
        proposedActions: [],
        isError: true,
      });
    } else if (data && data.configured === false) {
      state.sousChef.serverConfigured = false;
      state.sousChef.statusChecked = true;
      updateSousChefStatusUI();
      setSousChefSettingsOpen(true);
      state.sousChef.messages.push({
        id: `a_${Date.now().toString(36)}`,
        role: "assistant",
        text:
          data.reply ||
          data.message ||
          (state.sousChef.mode === "pin_protected"
            ? "**Host Access PIN or Tinker API key needed:** Enter the Host PIN or paste your own `TINKER_API_KEY` in the settings panel above (stored only in this tab's `sessionStorage`)."
            : "**Tinker API key needed:** Paste your `TINKER_API_KEY` in the settings panel above (stored only in this tab's `sessionStorage`) or add `TINKER_API_KEY=...` to your project `.env` file and restart the server. You can create a key at `tinker-console.thinkingmachines.ai/keys`."),
        proposedActions: [],
        isError: false,
      });
    } else if (!res.ok) {
      const detail = data.detail || data.error || data.reply || `Server returned HTTP ${res.status}`;
      state.sousChef.messages.push({
        id: `e_${Date.now().toString(36)}`,
        role: "assistant",
        text: `**Sous-Chef request error:** ${detail}`,
        proposedActions: [],
        isError: true,
      });
    } else {
      const replyText =
        data.reply || data.answer || data.message || data.text || "I reviewed your Thanksgiving plan!";
      const actions = Array.isArray(data.proposed_actions) ? data.proposed_actions : [];
      const metaParts = [];
      if (data.model) metaParts.push(String(data.model).replace("thinkingmachines/", ""));
      if (typeof data.latency_ms === "number") metaParts.push(`${Math.round(data.latency_ms)}ms`);
      state.sousChef.messages.push({
        id: `a_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
        role: "assistant",
        text: replyText,
        proposedActions: actions,
        applied: false,
        meta: metaParts.join(" · "),
      });
    }
  } catch (err) {
    state.sousChef.messages.push({
      id: `e_${Date.now().toString(36)}`,
      role: "assistant",
      text: `**Connection error:** Could not reach \`/api/sous-chef/ask\`. ${err?.message || ""}`,
      proposedActions: [],
      isError: true,
    });
  } finally {
    state.sousChef.busy = false;
    if (sendBtn) sendBtn.disabled = false;
    renderSousChefMessages();
  }
}

function wireSousChefListeners() {
  document.getElementById("sousChefBtn").addEventListener("click", openSousChefDrawer);
  document.getElementById("sousChefFab").addEventListener("click", openSousChefDrawer);
  document.getElementById("closeSousChefBtn").addEventListener("click", closeSousChefDrawer);

  document.getElementById("sousChefConnPill").addEventListener("click", () => {
    setSousChefSettingsOpen(!state.sousChef.settingsOpen);
  });
  document.getElementById("sousChefSettingsBtn").addEventListener("click", () => {
    setSousChefSettingsOpen(!state.sousChef.settingsOpen);
  });

  document.getElementById("sousChefModelSelect").addEventListener("change", (e) => {
    state.sousChef.model = e.target.value || DEFAULT_TINKER_MODEL;
    try {
      sessionStorage.setItem(TINKER_MODEL_SESSION_KEY, state.sousChef.model);
    } catch {
      // Ignore
    }
    showToast(`Model set to ${state.sousChef.model.replace("thinkingmachines/", "")}`);
  });

  document.getElementById("sousChefSaveKeyBtn").addEventListener("click", () => {
    const val = document.getElementById("sousChefApiKeyInput").value.trim();
    setSessionTinkerKey(val);
    updateSousChefStatusUI();
    if (val) {
      setSousChefSettingsOpen(false);
      showToast("🔑 Tinker session key saved for this tab!");
    } else {
      showToast("Cleared empty session key.");
    }
  });

  document.getElementById("sousChefClearKeyBtn").addEventListener("click", () => {
    document.getElementById("sousChefApiKeyInput").value = "";
    setSessionTinkerKey("");
    updateSousChefStatusUI();
    showToast("Session Tinker key cleared.");
  });

  const savePinAction = () => {
    const pinEl = document.getElementById("sousChefPinInput");
    const val = (pinEl?.value || "").trim();
    setSessionSousChefPin(val);
    updateSousChefStatusUI();
    if (val) {
      setSousChefSettingsOpen(false);
      showToast("🔐 Host Access PIN saved for this browser tab!");
    } else {
      showToast("Cleared empty Host Access PIN.");
    }
  };
  document.getElementById("sousChefSavePinBtn").addEventListener("click", savePinAction);
  document.getElementById("sousChefPinInput").addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      savePinAction();
    }
  });
  document.getElementById("sousChefClearPinBtn").addEventListener("click", () => {
    document.getElementById("sousChefPinInput").value = "";
    setSessionSousChefPin("");
    updateSousChefStatusUI();
    showToast("Host Access PIN cleared.");
  });

  document.getElementById("sousChefClearChatBtn").addEventListener("click", () => {
    state.sousChef.messages = [];
    renderSousChefMessages();
  });

  document.querySelectorAll("#sousChefStarterChips .sc-starter-chip").forEach((chip) => {
    chip.addEventListener("click", () => {
      const prompt = chip.dataset.prompt || chip.textContent.trim();
      sendSousChefMessage(prompt);
    });
  });

  const photoBtn = document.getElementById("sousChefPhotoBtn");
  const photoInput = document.getElementById("sousChefPhotoInput");
  photoBtn.addEventListener("click", () => photoInput.click());
  photoInput.addEventListener("change", (e) => {
    const file = e.target.files?.[0];
    if (file) handleSousChefPhotoFile(file);
  });
  document.getElementById("sousChefRemoveImageBtn").addEventListener("click", clearPendingSousChefImage);

  const textarea = document.getElementById("sousChefInput");
  textarea.addEventListener("input", () => {
    textarea.style.height = "auto";
    textarea.style.height = `${Math.min(115, textarea.scrollHeight)}px`;
  });
  textarea.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendSousChefMessage();
    }
  });
  textarea.addEventListener("paste", (e) => {
    const items = e.clipboardData?.items || [];
    for (const item of items) {
      if (item.type && item.type.startsWith("image/")) {
        const file = item.getAsFile();
        if (file) {
          e.preventDefault();
          handleSousChefPhotoFile(file);
          break;
        }
      }
    }
  });

  document.getElementById("sousChefSendBtn").addEventListener("click", () => sendSousChefMessage());
}

initApp();
