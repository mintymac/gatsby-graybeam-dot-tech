/* Graybeam Thanksgiving OR Planner — Zero-Dependency In-Browser Constraint Solver
 * + Independent 8/8 Invariant Validator.
 *
 * Mirrors domain.py, solver.py, and validator.py so the planner runs 100% natively
 * on static hosts (Netlify / graybeam.tech/thanksgiving/) with zero Python backend.
 */

export const DAY_MINUTES = 1440;
export const HORIZON_MINUTES = 2 * DAY_MINUTES; // 2880

export const TURKEY_METHOD_DEFAULTS = {
  convection_roast: {
    temp_f: 325,
    min_per_lb: 8.4,
    rest_min: 55,
    note: "KitchenAid Convect Roast at 325°F (~20–25% faster). Plug probe into upper-left jack, deepest breast; tent foil around 2h mark; pull at 158°F breast for 165°F carryover.",
  },
  standard_roast: {
    temp_f: 325,
    min_per_lb: 10.2,
    rest_min: 55,
    note: "Traditional 325°F unstuffed roast. Insert probe into thickest breast avoiding bone; tent with foil if skin browns early; pull at 158°F breast for juicy carryover.",
  },
  spatchcock: {
    temp_f: 450,
    min_per_lb: 5.4,
    rest_min: 45,
    note: "Serious Eats / Kenji high-heat spatchcock at 450°F (425°F convect) on extra-large rimmed sheet pan. Fastest, crispiest skin & juiciest white meat; pull at 155°F breast / 165°F thigh.",
  },
};

// ---------------------------------------------------------------------------
// Time & Transition Helpers
// ---------------------------------------------------------------------------
export function formatMinute(minute) {
  const day = Math.floor(minute / DAY_MINUTES);
  const dayLabel = day === 0 ? "Day Before" : day === 1 ? "Thanksgiving" : `Day ${day + 1}`;
  const m = ((minute % DAY_MINUTES) + DAY_MINUTES) % DAY_MINUTES;
  const hour24 = Math.floor(m / 60);
  const mins = m % 60;
  const period = hour24 < 12 ? "AM" : "PM";
  const hour12 = hour24 % 12 || 12;
  return `${dayLabel} ${hour12}:${String(mins).padStart(2, "0")} ${period}`;
}

export function formatClock(minute) {
  const m = ((minute % DAY_MINUTES) + DAY_MINUTES) % DAY_MINUTES;
  const hour24 = Math.floor(m / 60);
  const mins = m % 60;
  const period = hour24 < 12 ? "AM" : "PM";
  const hour12 = hour24 % 12 || 12;
  return `${hour12}:${String(mins).padStart(2, "0")} ${period}`;
}

export function ovenTransitionBuffer(tempA, tempB, _toleranceF = 25) {
  if (tempA === null || tempA === undefined || tempB === null || tempB === undefined) {
    return 0;
  }
  const diff = tempB - tempA;
  if (Math.abs(diff) <= 10) return 0;
  if (diff > 0) {
    return diff <= 75 ? 10 : 15; // Heating up
  }
  return Math.abs(diff) <= 75 ? 15 : 20; // Cooling down
}

export function turkeyRecommendationBrowser(weightLb = 25.0, method = "convection_roast") {
  const safeMethod = TURKEY_METHOD_DEFAULTS[method] ? method : "convection_roast";
  const cfg = TURKEY_METHOD_DEFAULTS[safeMethod];
  const w = Number.isFinite(Number(weightLb)) ? Number(weightLb) : 25.0;
  const raw = w * cfg.min_per_lb;
  const cookMin = Math.max(60, Math.round(raw / 5.0) * 5);
  return {
    weight_lb: w,
    method: safeMethod,
    temp_f: cfg.temp_f,
    cook_min: cookMin,
    rest_min: cfg.rest_min,
    note: cfg.note,
  };
}

function normalizeKitchen(rawKitchen = {}) {
  const dinner = Number.isFinite(Number(rawKitchen.dinner_ready_min))
    ? Math.round(Number(rawKitchen.dinner_ready_min))
    : DAY_MINUTES + 16 * 60;
  const dessertOffset = Number.isFinite(Number(rawKitchen.dessert_offset_min))
    ? Math.round(Number(rawKitchen.dessert_offset_min))
    : 60;
  const dessertReady = Math.min(HORIZON_MINUTES - 5, dinner + dessertOffset);
  const earliestRaw = rawKitchen.earliest_start_min;
  const earliest =
    earliestRaw === null || earliestRaw === undefined || earliestRaw === ""
      ? null
      : Math.round(Number(earliestRaw));

  return {
    dinner_ready_min: dinner,
    dessert_offset_min: dessertOffset,
    dessert_ready_min: dessertReady,
    day_before_start_min: Number.isFinite(Number(rawKitchen.day_before_start_min))
      ? Math.round(Number(rawKitchen.day_before_start_min))
      : 9 * 60,
    day_before_end_min: Number.isFinite(Number(rawKitchen.day_before_end_min))
      ? Math.round(Number(rawKitchen.day_before_end_min))
      : 23 * 60 + 30,
    day_of_start_min: Number.isFinite(Number(rawKitchen.day_of_start_min))
      ? Math.round(Number(rawKitchen.day_of_start_min))
      : DAY_MINUTES + 7 * 60,
    day_of_end_min: Number.isFinite(Number(rawKitchen.day_of_end_min))
      ? Math.round(Number(rawKitchen.day_of_end_min))
      : DAY_MINUTES + 22 * 60,
    earliest_start_min: Number.isFinite(earliest) ? earliest : null,
    main_oven_racks: Number.isFinite(Number(rawKitchen.main_oven_racks))
      ? Math.max(1, Math.round(Number(rawKitchen.main_oven_racks)))
      : 2,
    temp_tolerance_f: Number.isFinite(Number(rawKitchen.temp_tolerance_f))
      ? Math.max(0, Math.round(Number(rawKitchen.temp_tolerance_f)))
      : 25,
    upper_has_convection:
      rawKitchen.upper_has_convection === undefined ? true : Boolean(rawKitchen.upper_has_convection),
    stovetop_burners: Number.isFinite(Number(rawKitchen.stovetop_burners))
      ? Math.max(1, Math.round(Number(rawKitchen.stovetop_burners)))
      : 4,
    cook_count: Number.isFinite(Number(rawKitchen.cook_count))
      ? Math.max(1, Math.round(Number(rawKitchen.cook_count)))
      : 2,
    enforce_chef_hands:
      rawKitchen.enforce_chef_hands === undefined ? true : Boolean(rawKitchen.enforce_chef_hands),
  };
}

function normalizeRequest(rawRequest = {}) {
  return {
    kitchen: normalizeKitchen(rawRequest.kitchen || {}),
    dishes: Array.isArray(rawRequest.dishes) ? rawRequest.dishes : [],
    locked_task_starts:
      rawRequest.locked_task_starts && typeof rawRequest.locked_task_starts === "object"
        ? rawRequest.locked_task_starts
        : {},
    completed_task_ids: Array.isArray(rawRequest.completed_task_ids) ? rawRequest.completed_task_ids : [],
    reference_starts:
      rawRequest.reference_starts && typeof rawRequest.reference_starts === "object"
        ? rawRequest.reference_starts
        : {},
    repair_mode: Boolean(rawRequest.repair_mode),
    time_limit_sec: Number(rawRequest.time_limit_sec) || 3.0,
  };
}

// ---------------------------------------------------------------------------
// Task-Graph Expansion (Mirrors domain.py:expand_plan_tasks)
// ---------------------------------------------------------------------------
function resolveCookResources(dish, kitchen) {
  if (dish.appliance === "stovetop") return ["stovetop"];
  if (dish.appliance === "main_oven") return ["main_oven"];
  if (dish.appliance === "upper_combo") {
    if (kitchen.upper_has_convection || dish.temp_f === null || dish.temp_f === undefined) {
      return ["upper_combo"];
    }
    return ["main_oven"];
  }
  // "auto"
  if (dish.category === "main" || (dish.racks || 1) > 1) {
    return ["main_oven"];
  }
  if (dish.id === "green_beans") {
    return kitchen.upper_has_convection ? ["upper_combo", "stovetop"] : ["stovetop", "main_oven"];
  }
  if (dish.temp_f !== null && dish.temp_f !== undefined) {
    return kitchen.upper_has_convection ? ["upper_combo", "main_oven"] : ["main_oven"];
  }
  return ["stovetop"];
}

function makeTaskSpec(fields) {
  return {
    id: fields.id,
    dish_id: fields.dish_id,
    dish_name: fields.dish_name,
    emoji: fields.emoji || "🍽️",
    category: fields.category || "side",
    label: fields.label,
    kind: fields.kind,
    allowed_resources: fields.allowed_resources,
    duration_min: Math.max(1, Math.round(Number(fields.duration_min))),
    temp_f: fields.temp_f ?? null,
    racks: fields.racks ?? 1,
    active_hands: fields.active_hands ?? 0,
    passive_overnight_ok: Boolean(fields.passive_overnight_ok),
    day_preference: fields.day_preference || "any",
    after_task_id: fields.after_task_id ?? null,
    extra_after_task_ids: Array.isArray(fields.extra_after_task_ids) ? fields.extra_after_task_ids : [],
    min_gap_min: fields.min_gap_min ?? 0,
    max_gap_min: fields.max_gap_min ?? null,
    anchor: fields.anchor || "none",
    max_hold_min: fields.max_hold_min ?? 30,
    prefer_day_before_bonus: fields.prefer_day_before_bonus ?? 0,
    locked_start_min:
      fields.locked_start_min === null || fields.locked_start_min === undefined
        ? null
        : Math.round(Number(fields.locked_start_min)),
    tip: fields.tip || "",
    is_primary_cook: Boolean(fields.is_primary_cook),
  };
}

export function expandPlanTasks(rawRequest) {
  const request = normalizeRequest(rawRequest);
  const kitchen = request.kitchen;
  const lockedStarts = request.locked_task_starts || {};
  const tasks = [];

  const getLock = (tid, fallback = null) => {
    if (Object.prototype.hasOwnProperty.call(lockedStarts, tid) && lockedStarts[tid] !== null && lockedStarts[tid] !== undefined) {
      return Math.round(Number(lockedStarts[tid]));
    }
    if (fallback !== null && fallback !== undefined) {
      return Math.round(Number(fallback));
    }
    return null;
  };

  const enabledTurkey = request.dishes.find(
    (d) => d.enabled !== false && (d.id === "turkey" || (d.turkey_method !== null && d.turkey_method !== undefined))
  );
  const turkeyCookId = enabledTurkey ? `${enabledTurkey.id}__cook` : null;

  for (const rawDish of request.dishes) {
    if (rawDish.enabled === false) continue;
    const dish = {
      emoji: "🍽️",
      category: "side",
      appliance: "main_oven",
      temp_f: 350,
      prep_min: 0,
      cook_min: 40,
      rest_min: 0,
      racks: 1,
      day_preference: "any",
      anchor: "dinner",
      max_hold_min: 30,
      requires_chill_min: 0,
      temper_min: 0,
      reheat_min: 0,
      carve_min: 0,
      make_ahead_prep_ok: true,
      gravy_two_stage: false,
      technique_note: "",
      locked_cook_start_min: null,
      ...rawDish,
    };

    const dishLock = dish.locked_cook_start_min ?? null;
    let prevId = null;

    // --- 1. Special Multi-Stage Expansion: 25 lb Turkey ---
    if (dish.id === "turkey" || (dish.turkey_method !== null && dish.turkey_method !== undefined)) {
      if (dish.prep_min > 0) {
        const tid = `${dish.id}__prep`;
        tasks.push(
          makeTaskSpec({
            id: tid,
            dish_id: dish.id,
            dish_name: dish.name,
            emoji: dish.emoji,
            category: dish.category,
            label: "Temper, Pat Dry & Season Turkey",
            kind: "temper",
            allowed_resources: ["counter"],
            duration_min: dish.prep_min,
            active_hands: 1,
            day_preference: "day_of",
            locked_start_min: getLock(tid),
            tip: "Pat skin bone-dry, season with herb butter, and insert KitchenAid meat probe into thickest breast (avoiding bone).",
          })
        );
        prevId = tid;
      }

      const roastId = `${dish.id}__cook`;
      tasks.push(
        makeTaskSpec({
          id: roastId,
          dish_id: dish.id,
          dish_name: dish.name,
          emoji: dish.emoji,
          category: dish.category,
          label: `Roast Turkey (${dish.temp_f || 325}°F)`,
          kind: "roast",
          allowed_resources: ["main_oven"],
          duration_min: dish.cook_min,
          temp_f: dish.temp_f || 325,
          racks: Math.min(dish.racks || 2, kitchen.main_oven_racks),
          active_hands: 0,
          day_preference: "day_of",
          after_task_id: prevId,
          min_gap_min: 0,
          max_gap_min: prevId ? 20 : null,
          locked_start_min: getLock(roastId, dishLock),
          tip: dish.technique_note,
          is_primary_cook: true,
        })
      );
      prevId = roastId;

      if (dish.rest_min > 0) {
        const restId = `${dish.id}__rest`;
        tasks.push(
          makeTaskSpec({
            id: restId,
            dish_id: dish.id,
            dish_name: dish.name,
            emoji: dish.emoji,
            category: dish.category,
            label: "Rest Turkey (Tent Loosely · Frees Oven!)",
            kind: "rest",
            allowed_resources: ["counter"],
            duration_min: dish.rest_min,
            active_hands: 0,
            passive_overnight_ok: true,
            day_preference: "day_of",
            after_task_id: prevId,
            min_gap_min: 0,
            max_gap_min: 5,
            anchor: dish.carve_min === 0 ? "dinner" : "none",
            max_hold_min: dish.max_hold_min,
            locked_start_min: getLock(restId),
            tip: "Pull at probe target (158°F breast → 165°F carryover). Tent loosely with foil; immediately slide Mac & Cheese into the free oven!",
          })
        );
        prevId = restId;
      }

      if (dish.carve_min > 0) {
        const carveId = `${dish.id}__carve`;
        tasks.push(
          makeTaskSpec({
            id: carveId,
            dish_id: dish.id,
            dish_name: dish.name,
            emoji: dish.emoji,
            category: dish.category,
            label: "Carve & Platter Turkey",
            kind: "carve",
            allowed_resources: ["counter"],
            duration_min: dish.carve_min,
            active_hands: 1,
            day_preference: "day_of",
            after_task_id: prevId,
            min_gap_min: 0,
            max_gap_min: 15,
            anchor: "dinner",
            max_hold_min: dish.max_hold_min,
            locked_start_min: getLock(carveId),
            tip: "Carve while sides finish in the oven; spoon warm pan juices over sliced breast meat.",
          })
        );
      }
      continue;
    }

    // --- 2. Special Multi-Stage Expansion: Bread Dressing ---
    if (dish.bread_dry_method !== null && dish.bread_dry_method !== undefined) {
      const dryId = `${dish.id}__dry`;
      if (dish.bread_dry_method === "oven_dry") {
        tasks.push(
          makeTaskSpec({
            id: dryId,
            dish_id: dish.id,
            dish_name: dish.name,
            emoji: dish.emoji,
            category: dish.category,
            label: `Oven-Dry Bread Cubes (${dish.temp_f || 300}°F)`,
            kind: "dry",
            allowed_resources: ["main_oven"],
            duration_min: 20,
            temp_f: dish.temp_f || 300,
            racks: 1,
            active_hands: 0,
            day_preference: "any",
            prefer_day_before_bonus: 80,
            locked_start_min: getLock(dryId),
            tip: "Cube bread into 3/4-inch pieces on sheet pans; dry at 300°F for 20m tossing halfway until crisp but not browned.",
          })
        );
      } else {
        tasks.push(
          makeTaskSpec({
            id: dryId,
            dish_id: dish.id,
            dish_name: dish.name,
            emoji: dish.emoji,
            category: dish.category,
            label: "Air-Dry Cubed Bread Overnight (0 Oven)",
            kind: "dry",
            allowed_resources: ["counter"],
            duration_min: 360,
            active_hands: 0,
            passive_overnight_ok: true,
            day_preference: "day_before",
            locked_start_min: getLock(dryId),
            tip: "Spread cubed bread uncovered on sheet pans overnight so it drinks up warm stock without turning mushy.",
          })
        );
      }
      prevId = dryId;

      if (dish.prep_min > 0) {
        const prepId = `${dish.id}__prep`;
        tasks.push(
          makeTaskSpec({
            id: prepId,
            dish_id: dish.id,
            dish_name: dish.name,
            emoji: dish.emoji,
            category: dish.category,
            label: "Chop Aromatics & Herbs for Dressing",
            kind: "prep",
            allowed_resources: ["counter"],
            duration_min: dish.prep_min,
            active_hands: 1,
            day_preference: dish.make_ahead_prep_ok ? "any" : "day_of",
            prefer_day_before_bonus: dish.make_ahead_prep_ok ? 30 : 0,
            after_task_id: prevId,
            locked_start_min: getLock(prepId),
            tip: "Dice celery, onion, garlic, sage & parsley; store in fridge if prepped Day Before.",
          })
        );
        prevId = prepId;
      }

      const cookId = `${dish.id}__cook`;
      tasks.push(
        makeTaskSpec({
          id: cookId,
          dish_id: dish.id,
          dish_name: dish.name,
          emoji: dish.emoji,
          category: dish.category,
          label: "Cook Stovetop Dressing (Dutch Oven)",
          kind: "stovetop",
          allowed_resources: resolveCookResources(dish, kitchen),
          duration_min: dish.cook_min,
          temp_f: dish.appliance === "stovetop" ? null : dish.temp_f,
          racks: 1,
          active_hands: 1,
          day_preference: "day_of",
          after_task_id: prevId,
          anchor: dish.anchor,
          max_hold_min: dish.max_hold_min,
          locked_start_min: getLock(cookId, dishLock),
          tip: dish.technique_note,
          is_primary_cook: true,
        })
      );
      continue;
    }

    // --- 3. Special Multi-Stage Expansion: Banana Cardamom Bread Pudding ---
    if (dish.bread_pudding_mode !== null && dish.bread_pudding_mode !== undefined) {
      if (dish.prep_min > 0) {
        const prepId = `${dish.id}__prep`;
        tasks.push(
          makeTaskSpec({
            id: prepId,
            dish_id: dish.id,
            dish_name: dish.name,
            emoji: dish.emoji,
            category: dish.category,
            label: "Assemble Banana Cardamom Custard & Bread",
            kind: "prep",
            allowed_resources: ["counter"],
            duration_min: dish.prep_min,
            active_hands: 1,
            day_preference: dish.day_preference === "day_before" ? "day_before" : "any",
            prefer_day_before_bonus: 70,
            locked_start_min: getLock(prepId),
            tip: "Cube bread, whisk cardamom-spiced custard, layer with sliced ripe bananas in baking dish.",
          })
        );
        prevId = prepId;
      }

      if (dish.bread_pudding_mode === "fresh_warm_bake") {
        const soakId = `${dish.id}__soak`;
        tasks.push(
          makeTaskSpec({
            id: soakId,
            dish_id: dish.id,
            dish_name: dish.name,
            emoji: dish.emoji,
            category: dish.category,
            label: "Custard Soak (Fridge)",
            kind: "soak",
            allowed_resources: ["fridge"],
            duration_min: 60,
            active_hands: 0,
            passive_overnight_ok: true,
            day_preference: "any",
            after_task_id: prevId,
            min_gap_min: 0,
            max_gap_min: 15,
            locked_start_min: getLock(soakId),
            tip: "At least 60m (or overnight in fridge) so bread fully absorbs the banana cardamom custard.",
          })
        );
        prevId = soakId;

        if (dish.temper_min > 0) {
          const tempId = `${dish.id}__temper`;
          tasks.push(
            makeTaskSpec({
              id: tempId,
              dish_id: dish.id,
              dish_name: dish.name,
              emoji: dish.emoji,
              category: dish.category,
              label: "Counter Temper Baking Dish",
              kind: "temper",
              allowed_resources: ["counter"],
              duration_min: dish.temper_min,
              active_hands: 0,
              passive_overnight_ok: true,
              day_preference: "day_of",
              after_task_id: prevId,
              min_gap_min: 0,
              locked_start_min: getLock(tempId),
              tip: "Take dish out of fridge 35m before baking so glass/ceramic doesn't thermal-shock.",
            })
          );
          prevId = tempId;
        }

        const bakeId = `${dish.id}__cook`;
        tasks.push(
          makeTaskSpec({
            id: bakeId,
            dish_id: dish.id,
            dish_name: dish.name,
            emoji: dish.emoji,
            category: dish.category,
            label: `Bake Bread Pudding (${dish.temp_f || 350}°F)`,
            kind: "bake",
            allowed_resources: resolveCookResources(dish, kitchen),
            duration_min: dish.cook_min,
            temp_f: dish.temp_f || 350,
            racks: dish.racks || 1,
            active_hands: 0,
            day_preference: "day_of",
            after_task_id: prevId,
            min_gap_min: 0,
            max_gap_min: dish.temper_min > 0 ? 20 : null,
            anchor: dish.rest_min === 0 ? "dessert" : "none",
            max_hold_min: dish.max_hold_min,
            locked_start_min: getLock(bakeId, dishLock),
            tip: "Bake 25m covered with foil, then 25m uncovered until puffed & center just set. Bakes right while you eat dinner!",
            is_primary_cook: true,
          })
        );
        prevId = bakeId;

        if (dish.rest_min > 0) {
          const restId = `${dish.id}__rest`;
          tasks.push(
            makeTaskSpec({
              id: restId,
              dish_id: dish.id,
              dish_name: dish.name,
              emoji: dish.emoji,
              category: dish.category,
              label: "Brief Set & Serve Warm",
              kind: "rest",
              allowed_resources: ["counter"],
              duration_min: dish.rest_min,
              active_hands: 0,
              day_preference: "day_of",
              after_task_id: prevId,
              min_gap_min: 0,
              max_gap_min: 5,
              anchor: "dessert",
              max_hold_min: dish.max_hold_min,
              locked_start_min: getLock(restId),
              tip: "Let puff settle 10m; serve warm with whipped cream or bourbon caramel.",
            })
          );
        }
      } else {
        // bake_ahead_reheat
        const bakeId = `${dish.id}__cook`;
        tasks.push(
          makeTaskSpec({
            id: bakeId,
            dish_id: dish.id,
            dish_name: dish.name,
            emoji: dish.emoji,
            category: dish.category,
            label: `Bake Bread Pudding Ahead (${dish.temp_f || 350}°F)`,
            kind: "bake",
            allowed_resources: ["main_oven"],
            duration_min: dish.cook_min,
            temp_f: dish.temp_f || 350,
            racks: dish.racks || 1,
            active_hands: 0,
            day_preference: dish.day_preference,
            prefer_day_before_bonus: 120,
            after_task_id: prevId,
            min_gap_min: prevId ? 30 : 0,
            locked_start_min: getLock(bakeId, dishLock),
            tip: "Fully bake ahead, cool completely, cover tightly and refrigerate.",
            is_primary_cook: true,
          })
        );
        prevId = bakeId;

        const reheatId = `${dish.id}__reheat`;
        const reheatRes = kitchen.upper_has_convection ? ["upper_combo", "main_oven"] : ["main_oven"];
        tasks.push(
          makeTaskSpec({
            id: reheatId,
            dish_id: dish.id,
            dish_name: dish.name,
            emoji: dish.emoji,
            category: dish.category,
            label: `Warm Reheat Bread Pudding (${dish.temp_f || 350}°F)`,
            kind: "reheat",
            allowed_resources: reheatRes,
            duration_min: Math.max(15, dish.reheat_min || 25),
            temp_f: dish.temp_f || 350,
            racks: 1,
            active_hands: 0,
            day_preference: "day_of",
            after_task_id: prevId,
            min_gap_min: 60,
            anchor: "dessert",
            max_hold_min: dish.max_hold_min,
            locked_start_min: getLock(reheatId),
            tip: "Splash 2 tbsp cream on top, reheat covered with foil at 350°F (uncover last 5m to re-crisp).",
          })
        );
      }
      continue;
    }

    // --- 4. Special Multi-Stage Expansion: 2-Stage Pan-Dripping Turkey Gravy ---
    if (dish.gravy_two_stage || dish.id === "pan_gravy") {
      if (dish.prep_min > 0) {
        const prepId = `${dish.id}__prep`;
        tasks.push(
          makeTaskSpec({
            id: prepId,
            dish_id: dish.id,
            dish_name: dish.name,
            emoji: dish.emoji,
            category: dish.category,
            label: "Simmer Giblet & Neck Stock Base",
            kind: "stovetop",
            allowed_resources: ["stovetop"],
            duration_min: dish.prep_min,
            temp_f: null,
            racks: 1,
            active_hands: 0,
            day_preference: dish.day_preference === "day_before" ? "day_before" : "any",
            prefer_day_before_bonus: 75,
            locked_start_min: getLock(prepId),
            tip: "Brown turkey neck + giblets (skip liver—bitter) with onion/carrot/celery + broth; whisk golden roux base and chill until turkey pulls.",
          })
        );
        prevId = prepId;
      }

      const cookId = `${dish.id}__cook`;
      const extraDeps = turkeyCookId ? [turkeyCookId] : [];
      tasks.push(
        makeTaskSpec({
          id: cookId,
          dish_id: dish.id,
          dish_name: dish.name,
          emoji: dish.emoji,
          category: dish.category,
          label: "Deglaze Drippings & Finish Gravy",
          kind: "stovetop",
          allowed_resources: ["stovetop"],
          duration_min: dish.cook_min,
          temp_f: null,
          racks: 1,
          active_hands: 1,
          day_preference: "day_of",
          after_task_id: prevId,
          extra_after_task_ids: extraDeps,
          min_gap_min: 0,
          anchor: dish.anchor,
          max_hold_min: dish.max_hold_min,
          locked_start_min: getLock(cookId, dishLock),
          tip: "Pour off excess fat from roasting pan, deglaze fond with dry white wine or stock, whisk in chilled giblet-stock roux base and simmer until glossy.",
          is_primary_cook: true,
        })
      );
      continue;
    }

    // --- 5. General Dish Expansion ---
    if (dish.prep_min > 0) {
      const prepId = `${dish.id}__prep`;
      tasks.push(
        makeTaskSpec({
          id: prepId,
          dish_id: dish.id,
          dish_name: dish.name,
          emoji: dish.emoji,
          category: dish.category,
          label: `Prep ${dish.name}`,
          kind: "prep",
          allowed_resources: ["counter"],
          duration_min: dish.prep_min,
          active_hands: 1,
          day_preference: !dish.make_ahead_prep_ok
            ? dish.day_preference
            : dish.day_preference === "day_before"
            ? "day_before"
            : "any",
          prefer_day_before_bonus:
            dish.make_ahead_prep_ok && dish.requires_chill_min > 0
              ? 60
              : dish.make_ahead_prep_ok
              ? 25
              : 0,
          locked_start_min: getLock(prepId),
          tip: dish.technique_note || `Prep & assemble ${dish.name}.`,
        })
      );
      prevId = prepId;
    }

    if (dish.temper_min > 0) {
      const tempId = `${dish.id}__temper`;
      tasks.push(
        makeTaskSpec({
          id: tempId,
          dish_id: dish.id,
          dish_name: dish.name,
          emoji: dish.emoji,
          category: dish.category,
          label: `Temper ${dish.name} on Counter`,
          kind: "temper",
          allowed_resources: ["counter"],
          duration_min: dish.temper_min,
          active_hands: 0,
          passive_overnight_ok: true,
          day_preference: dish.anchor === "dinner" ? "day_of" : dish.day_preference,
          after_task_id: prevId,
          min_gap_min: 0,
          locked_start_min: getLock(tempId),
          tip: "Take assembled dish out of fridge so it bakes evenly without cracking ceramic/glass.",
        })
      );
      prevId = tempId;
    }

    const cookId = `${dish.id}__cook`;
    const cookResources = resolveCookResources(dish, kitchen);
    const isStoveOnly = cookResources.length === 1 && cookResources[0] === "stovetop";
    const cookKind = isStoveOnly
      ? "stovetop"
      : (dish.id === "green_beans" || dish.id === "brussels_sprouts") && cookResources.includes("upper_combo")
      ? "air_fry"
      : "bake";
    const hasPostCook = dish.rest_min > 0 || dish.requires_chill_min > 0;
    const cookTemp = dish.temp_f;
    let cookLabelTemp = cookTemp && !isStoveOnly ? ` (${cookTemp}°F)` : "";
    if (dish.pie_bake_mode === "high_to_low") {
      cookLabelTemp = ` (425°F→${cookTemp || 350}°F)`;
    }
    const cookVerb = cookKind === "stovetop" ? "Cook" : cookKind === "air_fry" ? "Air Fry / Cook" : "Bake";

    tasks.push(
      makeTaskSpec({
        id: cookId,
        dish_id: dish.id,
        dish_name: dish.name,
        emoji: dish.emoji,
        category: dish.category,
        label: `${cookVerb} ${dish.name}${cookLabelTemp}`,
        kind: cookKind,
        allowed_resources: cookResources,
        duration_min: dish.cook_min,
        temp_f: isStoveOnly ? null : cookTemp || 350,
        racks: Math.min(dish.racks || 1, kitchen.main_oven_racks),
        active_hands: isStoveOnly ? 1 : 0,
        day_preference: dish.day_preference,
        prefer_day_before_bonus: dish.requires_chill_min > 0 ? 140 : 0,
        after_task_id: prevId,
        min_gap_min: 0,
        max_gap_min: dish.temper_min > 0 ? 20 : prevId && !dish.make_ahead_prep_ok ? 30 : null,
        anchor: hasPostCook ? "none" : dish.anchor,
        max_hold_min: dish.max_hold_min,
        locked_start_min: getLock(cookId, dishLock),
        tip: dish.technique_note,
        is_primary_cook: true,
      })
    );
    prevId = cookId;

    if (dish.rest_min > 0) {
      const restId = `${dish.id}__rest`;
      const isCool = dish.requires_chill_min > 0;
      tasks.push(
        makeTaskSpec({
          id: restId,
          dish_id: dish.id,
          dish_name: dish.name,
          emoji: dish.emoji,
          category: dish.category,
          label: isCool ? `Cool ${dish.name} (Wire Rack)` : `Rest / Set ${dish.name}`,
          kind: isCool ? "cool" : "rest",
          allowed_resources: ["counter"],
          duration_min: dish.rest_min,
          active_hands: 0,
          passive_overnight_ok: true,
          day_preference: "any",
          after_task_id: prevId,
          min_gap_min: 0,
          max_gap_min: 10,
          anchor: dish.requires_chill_min > 0 ? "none" : dish.anchor,
          max_hold_min: dish.max_hold_min,
          locked_start_min: getLock(restId),
          tip: "Cool undisturbed on a wire rack so custard/sauce sets cleanly without collapsing.",
        })
      );
      prevId = restId;
    }

    if (dish.requires_chill_min > 0) {
      const chillId = `${dish.id}__chill`;
      tasks.push(
        makeTaskSpec({
          id: chillId,
          dish_id: dish.id,
          dish_name: dish.name,
          emoji: dish.emoji,
          category: dish.category,
          label: `Chill & Set ${dish.name} (Fridge)`,
          kind: "chill",
          allowed_resources: ["fridge"],
          duration_min: dish.requires_chill_min,
          active_hands: 0,
          passive_overnight_ok: true,
          day_preference: "any",
          after_task_id: prevId,
          min_gap_min: 0,
          max_gap_min: 60,
          anchor: dish.anchor,
          max_hold_min: dish.max_hold_min,
          locked_start_min: getLock(chillId),
          tip: "Chill thoroughly in fridge (at least 2–4h, or overnight) for clean slices.",
        })
      );
    }
  }

  return tasks;
}

// ---------------------------------------------------------------------------
// Domain Interval & Propagation Utilities
// ---------------------------------------------------------------------------
function domainIntervals(spec, request) {
  const k = request.kitchen;
  const dur = spec.duration_min;
  const floor = k.earliest_start_min ?? 0;

  if (spec.locked_start_min !== null) {
    return [[spec.locked_start_min, spec.locked_start_min]];
  }

  if (spec.passive_overnight_ok) {
    let lo = floor;
    let hi = HORIZON_MINUTES - dur;
    if (spec.day_preference === "day_before") {
      hi = Math.min(hi, DAY_MINUTES - 1);
    } else if (spec.day_preference === "day_of") {
      lo = Math.max(lo, DAY_MINUTES);
    }
    return lo <= hi ? [[lo, hi]] : [];
  }

  const ranges = [];
  const onlyMainOven = spec.allowed_resources.length === 1 && spec.allowed_resources[0] === "main_oven";
  const ovenPreheatPad = k.earliest_start_min !== null && onlyMainOven ? 15 : 0;
  const effFloor = floor + ovenPreheatPad;

  if (spec.day_preference === "any" || spec.day_preference === "day_before") {
    const lo0 = Math.max(k.day_before_start_min, effFloor);
    const hi0 = k.day_before_end_min - dur;
    if (lo0 <= hi0) ranges.push([lo0, hi0]);
  }
  if (spec.day_preference === "any" || spec.day_preference === "day_of") {
    const lo1 = Math.max(k.day_of_start_min, effFloor);
    const hi1 = k.day_of_end_min - dur;
    if (lo1 <= hi1) ranges.push([lo1, hi1]);
  }
  return ranges;
}

function clampIntervals(ranges, minVal, maxVal) {
  if (minVal > maxVal || ranges.length === 0) return [];
  const out = [];
  for (const [lo, hi] of ranges) {
    const nLo = Math.max(lo, minVal);
    const nHi = Math.min(hi, maxVal);
    if (nLo <= nHi) out.push([nLo, nHi]);
  }
  return out;
}

function intervalMin(ranges) {
  return ranges[0][0];
}

function intervalMax(ranges) {
  return ranges[ranges.length - 1][1];
}

function intervalSpan(ranges) {
  let total = 0;
  for (const [lo, hi] of ranges) total += hi - lo + 1;
  return total;
}

function inIntervals(val, ranges) {
  for (const [lo, hi] of ranges) {
    if (val >= lo && val <= hi) return true;
  }
  return false;
}

function cloneDomains(domains) {
  return domains.map((r) => r.map(([lo, hi]) => [lo, hi]));
}

function domainsEqual(a, b) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i][0] !== b[i][0] || a[i][1] !== b[i][1]) return false;
  }
  return true;
}

function propagateBounds(domains, specs, indexById) {
  let changed = true;
  let iter = 0;
  while (changed && iter < 64) {
    changed = false;
    iter += 1;
    for (let i = 0; i < specs.length; i++) {
      const spec = specs[i];
      if (domains[i].length === 0) return false;

      if (spec.after_task_id && Object.prototype.hasOwnProperty.call(indexById, spec.after_task_id)) {
        const p = indexById[spec.after_task_id];
        if (domains[p].length === 0) return false;
        const pSpec = specs[p];

        const pMin = intervalMin(domains[p]);
        const pMax = intervalMax(domains[p]);
        const cLo = pMin + pSpec.duration_min + spec.min_gap_min;
        const cHi = spec.max_gap_min !== null ? pMax + pSpec.duration_min + spec.max_gap_min : HORIZON_MINUTES;
        const nextC = clampIntervals(domains[i], cLo, cHi);
        if (nextC.length === 0) return false;
        if (!domainsEqual(nextC, domains[i])) {
          domains[i] = nextC;
          changed = true;
        }

        const cMin = intervalMin(domains[i]);
        const cMax = intervalMax(domains[i]);
        const pHi = cMax - pSpec.duration_min - spec.min_gap_min;
        const pLo = spec.max_gap_min !== null ? cMin - pSpec.duration_min - spec.max_gap_min : 0;
        const nextP = clampIntervals(domains[p], pLo, pHi);
        if (nextP.length === 0) return false;
        if (!domainsEqual(nextP, domains[p])) {
          domains[p] = nextP;
          changed = true;
        }
      }

      for (const extraDep of spec.extra_after_task_ids) {
        if (!Object.prototype.hasOwnProperty.call(indexById, extraDep)) continue;
        const p = indexById[extraDep];
        if (domains[p].length === 0) return false;
        const pSpec = specs[p];

        const cLo = intervalMin(domains[p]) + pSpec.duration_min;
        const nextC = clampIntervals(domains[i], cLo, HORIZON_MINUTES);
        if (nextC.length === 0) return false;
        if (!domainsEqual(nextC, domains[i])) {
          domains[i] = nextC;
          changed = true;
        }

        const pHi = intervalMax(domains[i]) - pSpec.duration_min;
        const nextP = clampIntervals(domains[p], 0, pHi);
        if (nextP.length === 0) return false;
        if (!domainsEqual(nextP, domains[p])) {
          domains[p] = nextP;
          changed = true;
        }
      }
    }
  }
  return true;
}

// ---------------------------------------------------------------------------
// Resource Constraint Checker (Hard Physical Invariants)
// ---------------------------------------------------------------------------
function isPlacementValid(spec, res, start, assigned, kitchen, skipId = null) {
  const end = start + spec.duration_min;
  const temp = res === "stovetop" ? null : spec.temp_f;

  if (res === "upper_combo") {
    if (!kitchen.upper_has_convection && temp !== null) return false;
    for (const a of assigned) {
      if (a.id === skipId || a.resource !== "upper_combo") continue;
      if (start < a.end && a.start < end) return false;
    }
  } else if (res === "main_oven") {
    const ovenAssigned = [];
    for (const a of assigned) {
      if (a.id === skipId || a.resource !== "main_oven") continue;
      ovenAssigned.push(a);
      if (start < a.end && a.start < end) {
        if (temp !== null && a.temp !== null && Math.abs(temp - a.temp) > kitchen.temp_tolerance_f) {
          return false;
        }
      } else {
        const first = end <= a.start ? { end, temp } : a;
        const second = end <= a.start ? a : { start, temp };
        if (first.temp !== null && second.temp !== null && Math.abs(first.temp - second.temp) > kitchen.temp_tolerance_f) {
          const buf = ovenTransitionBuffer(first.temp, second.temp, kitchen.temp_tolerance_f);
          if (second.start - first.end < buf) return false;
        }
      }
    }
    // Check rack cumulative capacity at start and at every overlapping task start inside (start, end)
    const checkPoints = [start];
    for (const a of ovenAssigned) {
      if (a.start > start && a.start < end) checkPoints.push(a.start);
    }
    for (const pt of checkPoints) {
      let racks = spec.racks;
      for (const a of ovenAssigned) {
        if (a.start <= pt && pt < a.end) racks += a.racks;
      }
      if (racks > kitchen.main_oven_racks) return false;
    }
  } else if (res === "stovetop") {
    const stoveAssigned = [];
    for (const a of assigned) {
      if (a.id === skipId || a.resource !== "stovetop") continue;
      if (start < a.end && a.start < end) stoveAssigned.push(a);
    }
    if (stoveAssigned.length >= kitchen.stovetop_burners) {
      const checkPoints = [start];
      for (const a of stoveAssigned) {
        if (a.start > start && a.start < end) checkPoints.push(a.start);
      }
      for (const pt of checkPoints) {
        let count = 1;
        for (const a of stoveAssigned) {
          if (a.start <= pt && pt < a.end) count += 1;
        }
        if (count > kitchen.stovetop_burners) return false;
      }
    }
  }

  if (kitchen.enforce_chef_hands && spec.active_hands > 0) {
    const handAssigned = [];
    for (const a of assigned) {
      if (a.id === skipId || a.active_hands <= 0) continue;
      if (start < a.end && a.start < end) handAssigned.push(a);
    }
    if (handAssigned.length > 0) {
      const checkPoints = [start];
      for (const a of handAssigned) {
        if (a.start > start && a.start < end) checkPoints.push(a.start);
      }
      for (const pt of checkPoints) {
        let hands = spec.active_hands;
        for (const a of handAssigned) {
          if (a.start <= pt && pt < a.end) hands += a.active_hands;
        }
        if (hands > kitchen.cook_count) return false;
      }
    } else if (spec.active_hands > kitchen.cook_count) {
      return false;
    }
  }

  return true;
}

// ---------------------------------------------------------------------------
// Objective Function (Mirrors solver.py weighted penalties)
// ---------------------------------------------------------------------------
function computeObjective(specs, placedById, request, canRunDayBefore) {
  const k = request.kitchen;
  let score = 0;
  let wedLo = Infinity;
  let wedHi = -Infinity;
  const specById = {};
  for (const s of specs) specById[s.id] = s;

  for (const spec of specs) {
    const p = placedById[spec.id];
    if (!p) continue;

    if (spec.anchor === "dinner") {
      const hold = k.dinner_ready_min - p.end;
      const weight = spec.category === "main" ? 100 : 56;
      score += hold * weight;
    } else if (spec.anchor === "dessert") {
      const hold = k.dessert_ready_min - p.end;
      if (spec.max_hold_min <= 60) {
        score += hold * 72;
      }
    }

    if (spec.prefer_day_before_bonus > 0 && spec.locked_start_min === null && canRunDayBefore[spec.id]) {
      if (p.start >= DAY_MINUTES) {
        score += spec.prefer_day_before_bonus * 4;
      } else if (spec.is_primary_cook || spec.kind === "dry" || spec.kind === "prep" || spec.kind === "stovetop") {
        if (p.start < wedLo) wedLo = p.start;
        if (p.end > wedHi) wedHi = p.end;
      }
    }

    if (spec.allowed_resources.length > 1 && spec.allowed_resources.includes("upper_combo")) {
      if (p.resource !== "upper_combo") score += 60;
    }

    if (request.repair_mode && Object.prototype.hasOwnProperty.call(request.reference_starts, spec.id)) {
      const shift = Math.abs(p.start - request.reference_starts[spec.id]);
      if (shift > 0) score += 240 + shift * 8;
    }

    if (spec.after_task_id && placedById[spec.after_task_id] && !spec.passive_overnight_ok) {
      const prevSpec = specById[spec.after_task_id];
      if (spec.day_preference === "day_of" && prevSpec && prevSpec.prefer_day_before_bonus < 50) {
        score += (p.start - placedById[spec.after_task_id].end) * 4;
      }
    }
  }

  const pieA = placedById.sweet_potato_pie__cook;
  const pieB = placedById.pumpkin_pie__cook;
  if (pieA && pieB) {
    score += Math.abs(pieA.start - pieB.start) * 8;
  }

  if (wedLo <= wedHi && (k.earliest_start_min ?? 0) < k.day_before_end_min) {
    const wedAnchor = Math.min(
      k.day_before_end_min,
      Math.max(k.day_before_start_min, 1050, k.earliest_start_min ?? 0)
    );
    score += Math.abs(wedLo - wedAnchor) * 2 + (wedHi - wedLo);
  }

  return score;
}

// ---------------------------------------------------------------------------
// Candidate Generation & CSP Backtracking Search
// ---------------------------------------------------------------------------
function orderedResourcesForSpec(spec, kitchen) {
  const resList = [...spec.allowed_resources];
  if (resList.length <= 1) return resList;
  const rank = (r) => {
    if (r === "upper_combo" && kitchen.upper_has_convection) return 0;
    if (r === "stovetop") return 1;
    if (r === "main_oven") return 2;
    return 3;
  };
  resList.sort((a, b) => rank(a) - rank(b));
  return resList;
}

function generateCandidates(spec, res, ranges, assigned, assignedById, specs, request, skipId = null) {
  const k = request.kitchen;
  const dur = spec.duration_min;
  const temp = res === "stovetop" ? null : spec.temp_f;

  if (spec.locked_start_min !== null) {
    const s = spec.locked_start_min;
    if (inIntervals(s, ranges) && isPlacementValid(spec, res, s, assigned, k, skipId)) {
      return [s];
    }
    return [];
  }

  const rawSet = new Set();
  const add = (t) => {
    const r = Math.round(t);
    if (inIntervals(r, ranges)) rawSet.add(r);
  };

  const wedAnchor = Math.min(
    k.day_before_end_min,
    Math.max(k.day_before_start_min, 1050, k.earliest_start_min ?? 0)
  );
  const hasRef = request.repair_mode && Object.prototype.hasOwnProperty.call(request.reference_starts, spec.id);
  const refStart = hasRef ? request.reference_starts[spec.id] : null;

  if (refStart !== null) {
    add(refStart);
    for (let d = 5; d <= 60; d += 5) {
      add(refStart - d);
      add(refStart + d);
    }
  }
  add(wedAnchor);
  add(wedAnchor + 15);
  add(wedAnchor + 25);

  // Exact interval endpoints & smart grid sampling
  for (const [lo, hi] of ranges) {
    add(lo);
    add(hi);
    const span = hi - lo;
    if (span <= 30) {
      for (let t = lo; t <= hi; t += span <= 15 ? 1 : 5) add(t);
    } else {
      // Fine 5-min grid near both edges (60m) + 15-min grid across interior
      const nearLoEnd = Math.min(hi, lo + 60);
      for (let t = Math.ceil(lo / 5) * 5; t <= nearLoEnd; t += 5) add(t);
      const nearHiStart = Math.max(lo, hi - 60);
      for (let t = Math.floor(hi / 5) * 5; t >= nearHiStart; t -= 5) add(t);
      for (let t = Math.ceil(lo / 15) * 15; t <= hi; t += 15) add(t);
    }
  }

  // Exact event-aligned boundary points relative to already-placed tasks
  for (const a of assigned) {
    if (a.id === skipId) continue;
    if (res === "main_oven" && a.resource === "main_oven") {
      const incompatible =
        temp !== null && a.temp !== null && Math.abs(temp - a.temp) > k.temp_tolerance_f;
      if (!incompatible && a.racks + spec.racks <= k.main_oven_racks) {
        add(a.start);
        add(a.end - dur);
      }
      const bufAfter = incompatible ? ovenTransitionBuffer(a.temp, temp, k.temp_tolerance_f) : 0;
      const bufBefore = incompatible ? ovenTransitionBuffer(temp, a.temp, k.temp_tolerance_f) : 0;
      add(a.end + bufAfter);
      add(a.start - dur - bufBefore);
    } else if (res === a.resource && (res === "upper_combo" || res === "stovetop")) {
      add(a.end);
      add(a.start - dur);
    }
    if (k.enforce_chef_hands && spec.active_hands > 0 && a.active_hands > 0) {
      add(a.end);
      add(a.start - dur);
    }
  }

  // Exact precedence-aligned points
  if (spec.after_task_id && assignedById[spec.after_task_id]) {
    const p = assignedById[spec.after_task_id];
    add(p.end + spec.min_gap_min);
    if (spec.max_gap_min !== null) add(p.end + spec.max_gap_min);
  }
  for (const extraDep of spec.extra_after_task_ids) {
    if (assignedById[extraDep]) add(assignedById[extraDep].end);
  }
  for (const s of specs) {
    if (s.after_task_id === spec.id && assignedById[s.id]) {
      const succ = assignedById[s.id];
      add(succ.start - dur - s.min_gap_min);
      if (s.max_gap_min !== null) add(succ.start - dur - s.max_gap_min);
    }
    if (s.extra_after_task_ids.includes(spec.id) && assignedById[s.id]) {
      add(assignedById[s.id].start - dur);
    }
  }

  // Twin pie sync target
  const otherPieId =
    spec.id === "sweet_potato_pie__cook"
      ? "pumpkin_pie__cook"
      : spec.id === "pumpkin_pie__cook"
      ? "sweet_potato_pie__cook"
      : null;
  const otherPie = otherPieId ? assignedById[otherPieId] : null;
  if (otherPie) add(otherPie.start);

  // Filter to resource-valid points
  const valid = [];
  for (const t of rawSet) {
    if (isPlacementValid(spec, res, t, assigned, k, skipId)) {
      valid.push(t);
    }
  }
  if (valid.length <= 1) return valid;

  // Determine directional preference for sorting candidates
  const hasDayBeforeRange = ranges.some(([lo]) => lo < DAY_MINUTES);
  const preferLatest =
    spec.anchor === "dinner" ||
    (spec.anchor === "dessert" && spec.max_hold_min <= 60) ||
    (spec.day_preference === "day_of" &&
      (spec.kind === "roast" || spec.kind === "bake" || spec.kind === "prep" || spec.kind === "temper" || spec.kind === "carve" || spec.kind === "stovetop"));
  const preferEarliest =
    spec.kind === "rest" ||
    spec.kind === "cool" ||
    spec.kind === "chill" ||
    spec.kind === "soak" ||
    (res === "main_oven" && spec.anchor === "none" && spec.day_preference !== "day_of");

  const scoreCandidate = (t) => {
    let sc = 0;
    if (refStart !== null) {
      const d = Math.abs(t - refStart);
      sc += d === 0 ? -50000 : d * 20;
    }
    if (spec.prefer_day_before_bonus > 0 && hasDayBeforeRange) {
      if (t >= DAY_MINUTES) {
        sc += spec.prefer_day_before_bonus * 100;
      } else {
        sc += Math.abs(t - wedAnchor) * 2;
      }
    }
    if (otherPie) {
      sc += Math.abs(t - otherPie.start) * 15;
    }
    if (spec.anchor === "dinner") {
      sc += (k.dinner_ready_min - (t + dur)) * 60;
    } else if (spec.anchor === "dessert" && spec.max_hold_min <= 60) {
      sc += (k.dessert_ready_min - (t + dur)) * 60;
    } else if (t >= DAY_MINUTES && spec.prefer_day_before_bonus > 0 && res === "main_oven") {
      // Pies / bread dry forced onto Day Of: bake early in the morning before turkey!
      sc += (t - DAY_MINUTES) * 3;
    } else if (preferEarliest) {
      sc += t;
    } else if (preferLatest) {
      sc += (HORIZON_MINUTES - t) * 2;
    } else {
      sc += Math.abs(t - wedAnchor);
    }
    return sc;
  };

  valid.sort((a, b) => scoreCandidate(a) - scoreCandidate(b) || a - b);

  // Always preserve top preferred points plus earliest & latest valid points
  if (valid.length > 28) {
    const keep = valid.slice(0, 24);
    const keepSet = new Set(keep);
    let minV = valid[0];
    let maxV = valid[0];
    for (const v of valid) {
      if (v < minV) minV = v;
      if (v > maxV) maxV = v;
    }
    if (!keepSet.has(minV)) keep.push(minV);
    if (!keepSet.has(maxV)) keep.push(maxV);
    return keep;
  }
  return valid;
}

function selectNextUnassignedIndex(specs, domains, assignedById) {
  let bestIdx = -1;
  let bestKey = [Infinity, Infinity, Infinity];

  for (let i = 0; i < specs.length; i++) {
    const spec = specs[i];
    if (assignedById[spec.id]) continue;
    const span = intervalSpan(domains[i]);
    if (span <= 0) return i;

    let tier = 5;
    if (spec.locked_start_min !== null) {
      tier = 0;
    } else if (spec.allowed_resources.length === 1 && spec.allowed_resources[0] === "main_oven") {
      // If one twin pie is already placed, immediately place its twin next!
      if (
        (spec.id === "pumpkin_pie__cook" && assignedById.sweet_potato_pie__cook) ||
        (spec.id === "sweet_potato_pie__cook" && assignedById.pumpkin_pie__cook)
      ) {
        tier = 0.5;
      } else {
        tier = 1;
      }
    } else if (
      spec.allowed_resources.includes("upper_combo") ||
      spec.allowed_resources.includes("stovetop")
    ) {
      tier = 2;
    } else if (spec.active_hands > 0) {
      tier = 3;
    } else {
      tier = 4;
    }

    const anchorPrio = spec.anchor !== "none" && spec.max_hold_min <= 60 ? 0 : 1;
    const key = [tier, span, anchorPrio];
    if (
      key[0] < bestKey[0] ||
      (key[0] === bestKey[0] && key[1] < bestKey[1]) ||
      (key[0] === bestKey[0] && key[1] === bestKey[1] && key[2] < bestKey[2])
    ) {
      bestKey = key;
      bestIdx = i;
    }
  }
  return bestIdx;
}

// ---------------------------------------------------------------------------
// Coordinate-Descent Local Polish (Tightens Objective Without Breaking Hard Rules)
// ---------------------------------------------------------------------------
function localPolish(specs, placedById, baseDomains, indexById, request, canRunDayBefore) {
  const k = request.kitchen;
  const specById = {};
  for (const s of specs) specById[s.id] = s;

  const getDynamicBounds = (spec) => {
    let ranges = baseDomains[indexById[spec.id]];
    if (spec.after_task_id && placedById[spec.after_task_id]) {
      const p = placedById[spec.after_task_id];
      const lo = p.end + spec.min_gap_min;
      const hi = spec.max_gap_min !== null ? p.end + spec.max_gap_min : HORIZON_MINUTES;
      ranges = clampIntervals(ranges, lo, hi);
    }
    for (const dep of spec.extra_after_task_ids) {
      if (placedById[dep]) {
        ranges = clampIntervals(ranges, placedById[dep].end, HORIZON_MINUTES);
      }
    }
    for (const succ of specs) {
      if (succ.after_task_id === spec.id && placedById[succ.id]) {
        const s = placedById[succ.id];
        const hi = s.start - spec.duration_min - succ.min_gap_min;
        const lo = succ.max_gap_min !== null ? s.start - spec.duration_min - succ.max_gap_min : 0;
        ranges = clampIntervals(ranges, lo, hi);
      }
      if (succ.extra_after_task_ids.includes(spec.id) && placedById[succ.id]) {
        ranges = clampIntervals(ranges, 0, placedById[succ.id].start - spec.duration_min);
      }
    }
    return ranges;
  };

  let currentObj = computeObjective(specs, placedById, request, canRunDayBefore);

  for (let pass = 0; pass < 3; pass++) {
    let improved = false;
    for (const spec of specs) {
      if (spec.locked_start_min !== null) continue;
      const cur = placedById[spec.id];
      const ranges = getDynamicBounds(spec);
      if (ranges.length === 0) continue;

      const assignedList = Object.values(placedById);
      const resources = orderedResourcesForSpec(spec, k);
      let bestChoice = null;
      let bestObj = currentObj;

      for (const res of resources) {
        const cands = generateCandidates(spec, res, ranges, assignedList, placedById, specs, request, spec.id);
        for (const t of cands) {
          if (t === cur.start && res === cur.resource) continue;
          const prev = placedById[spec.id];
          placedById[spec.id] = {
            ...prev,
            resource: res,
            start: t,
            end: t + spec.duration_min,
            temp: res === "stovetop" ? null : spec.temp_f,
          };
          const obj = computeObjective(specs, placedById, request, canRunDayBefore);
          if (obj < bestObj) {
            bestObj = obj;
            bestChoice = { resource: res, start: t };
          }
          placedById[spec.id] = prev;
        }
      }

      if (bestChoice) {
        placedById[spec.id] = {
          ...cur,
          resource: bestChoice.resource,
          start: bestChoice.start,
          end: bestChoice.start + spec.duration_min,
          temp: bestChoice.resource === "stovetop" ? null : spec.temp_f,
        };
        currentObj = bestObj;
        improved = true;
      }
    }
    if (!improved) break;
  }

  return currentObj;
}

// ---------------------------------------------------------------------------
// Chronological Kitchen Run-Sheet Events (Mirrors solver.py:_derive_kitchen_events)
// ---------------------------------------------------------------------------
function deriveKitchenEvents(tasks, request) {
  const events = [];
  const k = request.kitchen;

  // 1. Main Oven preheat & temp-transition events
  const mainOven = tasks
    .filter((t) => t.resource === "main_oven")
    .sort((a, b) => a.start_min - b.start_min || a.end_min - b.end_min);

  let prevEnd = null;
  let prevTemp = null;
  for (const t of mainOven) {
    const temp = t.temp_f || 350;
    if (prevEnd === null || t.start_min - prevEnd > 45) {
      const preheatMin = Math.max(k.earliest_start_min ?? 0, t.start_min - 15);
      events.push({
        minute: preheatMin,
        time_label: formatMinute(preheatMin),
        clock_label: formatClock(preheatMin),
        day: Math.floor(preheatMin / DAY_MINUTES),
        resource: "main_oven",
        event_type: "preheat",
        title: `Preheat Main Oven to ${temp}°F`,
        detail: `Get KitchenAid lower oven up to ${temp}°F before ${t.dish_name}.`,
        dish_id: t.dish_id,
        temp_f: temp,
      });
    } else if (prevTemp !== null && Math.abs(temp - prevTemp) > 10 && t.start_min >= prevEnd) {
      const adjMin = prevEnd;
      const direction = temp > prevTemp ? "Bump" : "Drop";
      events.push({
        minute: adjMin,
        time_label: formatMinute(adjMin),
        clock_label: formatClock(adjMin),
        day: Math.floor(adjMin / DAY_MINUTES),
        resource: "main_oven",
        event_type: "temp_change",
        title: `${direction} Main Oven: ${prevTemp}°F → ${temp}°F`,
        detail: `Adjust oven temperature for ${t.dish_name}.`,
        dish_id: t.dish_id,
        temp_f: temp,
      });
    }
    prevEnd = Math.max(prevEnd ?? 0, t.end_min);
    prevTemp = temp;
  }

  // 2. Task insert / action / checkpoint / pull events
  const dishById = {};
  for (const d of request.dishes) dishById[d.id] = d;

  for (const t of tasks) {
    if (t.resource === "main_oven" || t.resource === "upper_combo") {
      const cavity = t.resource === "main_oven" ? "Main Oven" : "Upper Combo";
      const tempStr = t.temp_f ? ` at ${t.temp_f}°F` : "";
      events.push({
        minute: t.start_min,
        time_label: formatMinute(t.start_min),
        clock_label: formatClock(t.start_min),
        day: Math.floor(t.start_min / DAY_MINUTES),
        resource: t.resource,
        event_type: "insert",
        title: `${t.emoji} Put In ${cavity}: ${t.dish_name}${tempStr}`,
        detail: t.tip || `${t.label} (${t.duration_min} min).`,
        dish_id: t.dish_id,
        temp_f: t.temp_f,
      });

      if (t.kind === "roast") {
        const dish = dishById[t.dish_id];
        const foilOffset = Math.min(120, Math.floor(t.duration_min * 0.58));
        const foilMin = t.start_min + foilOffset;
        const pullF = dish?.probe_pull_f || 158;
        events.push({
          minute: foilMin,
          time_label: formatMinute(foilMin),
          clock_label: formatClock(foilMin),
          day: Math.floor(foilMin / DAY_MINUTES),
          resource: "main_oven",
          event_type: "checkpoint",
          title: "🌡️ Turkey Probe Check & Foil Tent",
          detail: `Check KitchenAid probe display. If breast skin is golden brown, drape a loose foil tent to keep white meat juicy. Pull target: ${pullF}°F breast.`,
          dish_id: t.dish_id,
          temp_f: t.temp_f,
        });
      }

      let pullDetail = `Done after ${t.duration_min} min.`;
      if (t.kind === "roast") {
        const dish = dishById[t.dish_id];
        const pullF = dish?.probe_pull_f || 158;
        const targetF = dish?.probe_target_f || 165;
        pullDetail = `Pull at ${pullF}°F breast (carryover → ${targetF}°F). Unplug probe, tent loosely & rest—Main Oven is now FREE!`;
      }
      events.push({
        minute: t.end_min,
        time_label: formatMinute(t.end_min),
        clock_label: formatClock(t.end_min),
        day: Math.floor(t.end_min / DAY_MINUTES),
        resource: t.resource,
        event_type: "pull",
        title: `✅ Pull from ${cavity}: ${t.dish_name}`,
        detail: pullDetail,
        dish_id: t.dish_id,
        temp_f: t.temp_f,
      });
    } else if (t.resource === "stovetop") {
      events.push({
        minute: t.start_min,
        time_label: formatMinute(t.start_min),
        clock_label: formatClock(t.start_min),
        day: Math.floor(t.start_min / DAY_MINUTES),
        resource: "stovetop",
        event_type: "prep",
        title: `🔥 Stovetop: ${t.emoji} ${t.label}`,
        detail: t.tip || `${t.dish_name} (${t.duration_min} min).`,
        dish_id: t.dish_id,
        temp_f: null,
      });
    } else if (t.kind === "prep" || t.kind === "temper" || t.kind === "carve") {
      events.push({
        minute: t.start_min,
        time_label: formatMinute(t.start_min),
        clock_label: formatClock(t.start_min),
        day: Math.floor(t.start_min / DAY_MINUTES),
        resource: t.resource,
        event_type: "prep",
        title: `${t.emoji} ${t.label}`,
        detail: t.tip || `Duration: ${t.duration_min} min.`,
        dish_id: t.dish_id,
        temp_f: null,
      });
    }
  }

  // 3. Anchor service milestones
  events.push({
    minute: k.dinner_ready_min,
    time_label: formatMinute(k.dinner_ready_min),
    clock_label: formatClock(k.dinner_ready_min),
    day: Math.floor(k.dinner_ready_min / DAY_MINUTES),
    resource: "counter",
    event_type: "serve",
    title: "🍽️ DINNER SERVED!",
    detail: "Turkey carved, pan-dripping gravy, stovetop dressing, baked mac & cheese, creamy mashed potatoes & crispy green beans hit the table hot.",
    dish_id: null,
    temp_f: null,
  });
  events.push({
    minute: k.dessert_ready_min,
    time_label: formatMinute(k.dessert_ready_min),
    clock_label: formatClock(k.dessert_ready_min),
    day: Math.floor(k.dessert_ready_min / DAY_MINUTES),
    resource: "counter",
    event_type: "serve",
    title: "🥧 DESSERT SERVICE!",
    detail: "Chilled Sweet Potato & Pumpkin Pies + warm Banana Cardamom Bread Pudding ready to serve.",
    dish_id: null,
    temp_f: null,
  });

  events.sort((a, b) => {
    if (a.minute !== b.minute) return a.minute - b.minute;
    const pa = a.event_type === "preheat" || a.event_type === "temp_change" ? 0 : 1;
    const pb = b.event_type === "preheat" || b.event_type === "temp_change" ? 0 : 1;
    if (pa !== pb) return pa - pb;
    return a.title.localeCompare(b.title);
  });

  return events;
}

// ---------------------------------------------------------------------------
// Infeasibility Diagnostics (Mirrors solver.py:_diagnose_infeasibility)
// ---------------------------------------------------------------------------
function diagnoseInfeasibility(specs, request) {
  const k = request.kitchen;
  const reasons = [];
  const earliest = k.earliest_start_min;

  for (const s of specs) {
    if (domainIntervals(s, request).length === 0) {
      if (s.id === "dressing__dry" && s.day_preference === "day_before" && earliest !== null && earliest >= DAY_MINUTES) {
        reasons.push(
          `Bread Dressing is set to 'Air-Dry Overnight' (Day Before), which cannot run when starting on Thanksgiving Day (${formatMinute(earliest)}). Switch Bread Drying to 'Oven-Dry (20m)' or start Day Before.`
        );
      } else if (s.day_preference === "day_before" && earliest !== null && earliest >= DAY_MINUTES) {
        reasons.push(
          `'${s.label}' is pinned to Day Before, which is before your start time (${formatMinute(earliest)}). Switch ${s.dish_name} to 'Auto' or 'Thanksgiving Day', or move Start Time to Day Before.`
        );
      } else if (s.day_preference === "day_before" && earliest !== null && earliest + s.duration_min > k.day_before_end_min) {
        reasons.push(
          `'${s.label}' (${s.duration_min}m) cannot finish before Day-Before kitchen close (${formatClock(k.day_before_end_min)}) starting at ${formatMinute(earliest)}.`
        );
      } else {
        reasons.push(`'${s.label}' (${s.duration_min}m) does not fit inside its allowed kitchen hours.`);
      }
    }
  }

  const effDayOfStart = Math.max(k.day_of_start_min, earliest ?? 0);
  const availDayOf = k.dinner_ready_min - effDayOfStart;

  const forcedDayOfOven = specs.filter((s) => {
    const onlyMain = s.allowed_resources.length === 1 && s.allowed_resources[0] === "main_oven";
    if (!onlyMain || s.dish_id === "bread_pudding") return false;
    const ranges = domainIntervals(s, request);
    return !ranges.some(([lo]) => lo < DAY_MINUTES);
  });
  const pieOven = forcedDayOfOven.filter((s) => s.dish_id === "sweet_potato_pie" || s.dish_id === "pumpkin_pie");
  const nonPieOven = forcedDayOfOven.filter((s) => s.dish_id !== "sweet_potato_pie" && s.dish_id !== "pumpkin_pie");
  const estOvenMin =
    nonPieOven.reduce((acc, s) => acc + s.duration_min, 0) +
    (pieOven.length ? Math.max(...pieOven.map((s) => s.duration_min)) : 0);
  const distinctTemps = new Set(forcedDayOfOven.map((s) => s.temp_f).filter((t) => t !== null));
  const tempOverhead =
    15 * Math.max(0, distinctTemps.size - 1) + (earliest !== null && forcedDayOfOven.length > 0 ? 15 : 0);
  if (estOvenMin + tempOverhead > availDayOf) {
    reasons.push(
      `Thanksgiving Day Main Oven demand (~${estOvenMin + tempOverhead}m incl. preheat & temp changes before dinner) exceeds the ${availDayOf}m window from ${formatClock(effDayOfStart)} to Dinner (${formatClock(k.dinner_ready_min)}). Start earlier, bake pies Day Before, push Dinner later, or switch Turkey to Spatchcock.`
    );
  }

  const pieSpecs = specs.filter(
    (s) => (s.dish_id === "sweet_potato_pie" || s.dish_id === "pumpkin_pie") && s.is_primary_cook
  );
  for (const s of pieSpecs) {
    const ranges = domainIntervals(s, request);
    const forcedDayOf = s.day_preference === "day_of" || (ranges.length > 0 && ranges.every(([lo]) => lo >= DAY_MINUTES));
    if (forcedDayOf) {
      const chainMin = specs.filter((t) => t.dish_id === s.dish_id).reduce((acc, t) => acc + t.duration_min, 0);
      const availToDessert = k.dessert_ready_min - effDayOfStart;
      if (s.day_preference === "day_of" || chainMin > availToDessert || estOvenMin + tempOverhead >= availDayOf) {
        reasons.push(
          `${s.dish_name} must bake on Thanksgiving Day and needs ~${chainMin}m (prep + bake + 2h cool + 3h chill) plus Main Oven time before the turkey—bake Day Before, start earlier, or push Dinner/Dessert later.`
        );
        break;
      }
    }
  }

  if (k.enforce_chef_hands && k.cook_count === 1) {
    const dinnerHands = specs.filter((s) => s.active_hands > 0 && s.anchor === "dinner");
    if (dinnerHands.length >= 2) {
      const totalH = dinnerHands.reduce((acc, s) => acc + s.duration_min, 0);
      const maxSpan = Math.max(...dinnerHands.map((s) => s.duration_min + s.max_hold_min));
      if (totalH > maxSpan) {
        reasons.push(
          `With 1 cook, finishing active dinner tasks (${dinnerHands.map((s) => s.dish_name).join(", ")}; ${totalH}m total hands-on) within their hot-hold limits is infeasible. Increase Cooks to 2, relax Max Hold times, or disable Active Chef Hands.`
        );
      }
    }
  }

  if (specs.some((s) => s.locked_start_min !== null)) {
    reasons.push(
      "One or more pinned Start-Time Locks conflict with oven temperatures, turkey rest window, or Dinner Ready-By Time. Unlock a dish or shift Dinner Time."
    );
  }

  if (reasons.length === 0) {
    reasons.push(
      "Constraints are mathematically infeasible together (likely oven temperature buffers + rack capacity + max hold times before Dinner Ready-By Time). Try pushing Dinner Time later by 30m, enabling Upper Combo Convection, or switching Turkey to Spatchcock/Convection."
    );
  }
  return reasons;
}

// ---------------------------------------------------------------------------
// Independent 8-Invariant Validator (Mirrors validator.py — Zero Solver Coupling)
// ---------------------------------------------------------------------------
function activeInWakingWindow(task, spec, request) {
  if (spec.passive_overnight_ok) {
    return task.start_min >= 0 && task.end_min <= HORIZON_MINUTES;
  }
  const k = request.kitchen;
  const inDayBefore = k.day_before_start_min <= task.start_min && task.end_min <= k.day_before_end_min;
  const inDayOf = k.day_of_start_min <= task.start_min && task.end_min <= k.day_of_end_min;
  return inDayBefore || inDayOf;
}

function overlaps(a, b) {
  return a.start_min < b.end_min && b.start_min < a.end_min;
}

export function validateScheduleBrowser(rawRequest, scheduled) {
  const request = normalizeRequest(rawRequest);
  const specs = expandPlanTasks(request);
  const specById = {};
  for (const s of specs) specById[s.id] = s;
  const taskById = {};
  for (const t of scheduled) taskById[t.id] = t;

  const violations = [];
  const checks = [];
  const kitchen = request.kitchen;

  // V1: Coverage & exact durations/resources
  const v1Errors = [];
  if (scheduled.length !== Object.keys(taskById).length) {
    v1Errors.push("Duplicate task IDs detected in schedule.");
  }
  const missing = Object.keys(specById).filter((id) => !taskById[id]).sort();
  const extra = Object.keys(taskById).filter((id) => !specById[id]).sort();
  if (missing.length) v1Errors.push(`Missing required tasks: ${JSON.stringify(missing)}`);
  if (extra.length) v1Errors.push(`Unexpected foreign tasks: ${JSON.stringify(extra)}`);
  for (const [tid, spec] of Object.entries(specById)) {
    const t = taskById[tid];
    if (!t) continue;
    if (t.end_min - t.start_min !== spec.duration_min || t.duration_min !== spec.duration_min) {
      v1Errors.push(`${tid}: duration mismatch (${t.end_min - t.start_min} != ${spec.duration_min}).`);
    }
    if (!spec.allowed_resources.includes(t.resource)) {
      v1Errors.push(`${tid}: resource '${t.resource}' not in allowed ${JSON.stringify(spec.allowed_resources)}.`);
    }
  }
  checks.push({
    id: "V1_COVERAGE",
    name: "Exact Task Coverage & Durations",
    passed: v1Errors.length === 0,
    detail:
      v1Errors.length === 0
        ? `All ${specs.length} required steps assigned once with exact durations.`
        : v1Errors.join("; "),
  });
  violations.push(...v1Errors);

  // V2: Precedence chains & gap bounds
  const v2Errors = [];
  for (const spec of specs) {
    const curr = taskById[spec.id];
    if (!curr) continue;
    if (spec.after_task_id && taskById[spec.after_task_id]) {
      const prev = taskById[spec.after_task_id];
      const gap = curr.start_min - prev.end_min;
      if (gap < spec.min_gap_min) {
        v2Errors.push(`${spec.id} starts too early after ${prev.id} (gap ${gap}m < ${spec.min_gap_min}m).`);
      }
      if (spec.max_gap_min !== null && gap > spec.max_gap_min) {
        v2Errors.push(`${spec.id} waits too long after ${prev.id} (gap ${gap}m > ${spec.max_gap_min}m).`);
      }
    }
    for (const extraDep of spec.extra_after_task_ids) {
      const prev = taskById[extraDep];
      if (prev && curr.start_min < prev.end_min) {
        v2Errors.push(
          `${spec.id} starts before required dependency ${prev.id} finishes (${formatMinute(curr.start_min)} < ${formatMinute(prev.end_min)}).`
        );
      }
    }
  }
  checks.push({
    id: "V2_PRECEDENCE",
    name: "Culinary Precedence & Rest/Chill Chains",
    passed: v2Errors.length === 0,
    detail:
      v2Errors.length === 0
        ? "Every prep → cook → rest → chill/carve sequence honored."
        : v2Errors.join("; "),
  });
  violations.push(...v2Errors);

  // V3: Main Oven rack capacity, temperature compatibility & transition buffers
  const v3Errors = [];
  const mainOvenTasks = scheduled
    .filter((t) => t.resource === "main_oven")
    .sort((a, b) => a.start_min - b.start_min || a.end_min - b.end_min);

  const boundaries = [...new Set(mainOvenTasks.flatMap((t) => [t.start_min, t.end_min]))].sort((a, b) => a - b);
  for (const b of boundaries) {
    const rackSum = mainOvenTasks
      .filter((t) => t.start_min <= b && b < t.end_min)
      .reduce((acc, t) => acc + t.racks, 0);
    if (rackSum > kitchen.main_oven_racks) {
      v3Errors.push(
        `Main oven rack overload at ${formatMinute(b)}: ${rackSum} racks > ${kitchen.main_oven_racks}.`
      );
    }
  }
  for (let i = 0; i < mainOvenTasks.length; i++) {
    for (let j = i + 1; j < mainOvenTasks.length; j++) {
      const a = mainOvenTasks[i];
      const b = mainOvenTasks[j];
      const ta = a.temp_f;
      const tb = b.temp_f;
      if (overlaps(a, b)) {
        if (ta !== null && tb !== null && Math.abs(ta - tb) > kitchen.temp_tolerance_f) {
          v3Errors.push(
            `Main oven temperature clash: ${a.label} (${ta}°F) overlaps ${b.label} (${tb}°F).`
          );
        }
      } else {
        const [first, second] = a.end_min <= b.start_min ? [a, b] : [b, a];
        if (first.temp_f !== null && second.temp_f !== null) {
          const diff = Math.abs(first.temp_f - second.temp_f);
          if (diff > kitchen.temp_tolerance_f) {
            const buf = ovenTransitionBuffer(first.temp_f, second.temp_f, kitchen.temp_tolerance_f);
            const actualGap = second.start_min - first.end_min;
            if (actualGap < buf) {
              v3Errors.push(
                `Main oven transition buffer too short between ${first.label} (${first.temp_f}°F) and ${second.label} (${second.temp_f}°F): ${actualGap}m < ${buf}m.`
              );
            }
          }
        }
      }
    }
  }
  checks.push({
    id: "V3_MAIN_OVEN",
    name: "Main Oven Racks, Temp Compatibility & Buffers",
    passed: v3Errors.length === 0,
    detail:
      v3Errors.length === 0
        ? `Zero temp clashes (>±${kitchen.temp_tolerance_f}°F), rack limit (${kitchen.main_oven_racks}) & temp buffers satisfied.`
        : v3Errors.join("; "),
  });
  violations.push(...v3Errors);

  // V4: Upper KitchenAid Combo cavity exclusivity & mode capability
  const v4Errors = [];
  const upperTasks = scheduled
    .filter((t) => t.resource === "upper_combo")
    .sort((a, b) => a.start_min - b.start_min || a.end_min - b.end_min);
  for (let i = 0; i < upperTasks.length; i++) {
    if (!kitchen.upper_has_convection && upperTasks[i].temp_f !== null) {
      v4Errors.push(
        `${upperTasks[i].id} requires heated convection/air-fry in upper combo, but upper convection is disabled.`
      );
    }
    if (i + 1 < upperTasks.length && overlaps(upperTasks[i], upperTasks[i + 1])) {
      v4Errors.push(`Upper combo overlap: ${upperTasks[i].label} overlaps ${upperTasks[i + 1].label}.`);
    }
  }
  checks.push({
    id: "V4_UPPER_COMBO",
    name: "KitchenAid Upper Combo Exclusivity & Mode",
    passed: v4Errors.length === 0,
    detail:
      v4Errors.length === 0
        ? "Upper microwave/convection unit has zero overlaps and valid modes."
        : v4Errors.join("; "),
  });
  violations.push(...v4Errors);

  // V5: Stovetop burner capacity
  const v5Errors = [];
  const stoveTasks = scheduled.filter((t) => t.resource === "stovetop");
  const stoveBounds = [...new Set(stoveTasks.flatMap((t) => [t.start_min, t.end_min]))].sort((a, b) => a - b);
  for (const b of stoveBounds) {
    const active = stoveTasks.filter((t) => t.start_min <= b && b < t.end_min);
    if (active.length > kitchen.stovetop_burners) {
      v5Errors.push(
        `Stovetop overload at ${formatMinute(b)}: ${active.length} dishes > ${kitchen.stovetop_burners} burners.`
      );
    }
  }
  checks.push({
    id: "V5_STOVETOP",
    name: "Stovetop Burner Capacity",
    passed: v5Errors.length === 0,
    detail:
      v5Errors.length === 0
        ? `Simultaneous burners never exceed ${kitchen.stovetop_burners}.`
        : v5Errors.join("; "),
  });
  violations.push(...v5Errors);

  // V6: Active chef hands capacity
  const v6Errors = [];
  if (kitchen.enforce_chef_hands) {
    const activeTasks = scheduled.filter((t) => t.active_hands > 0);
    const handBounds = [...new Set(activeTasks.flatMap((t) => [t.start_min, t.end_min]))].sort((a, b) => a - b);
    for (const b of handBounds) {
      const demand = activeTasks
        .filter((t) => t.start_min <= b && b < t.end_min)
        .reduce((acc, t) => acc + t.active_hands, 0);
      if (demand > kitchen.cook_count) {
        v6Errors.push(`Active hands overload at ${formatMinute(b)}: need ${demand} cooks > ${kitchen.cook_count}.`);
      }
    }
  }
  checks.push({
    id: "V6_CHEF_HANDS",
    name: "Active Hands-On Cook Capacity",
    passed: v6Errors.length === 0,
    detail: !kitchen.enforce_chef_hands
      ? "Chef hands limit disabled."
      : v6Errors.length === 0
      ? `Hands-on tasks fit within ${kitchen.cook_count} cook(s).`
      : v6Errors.join("; "),
  });
  violations.push(...v6Errors);

  // V7: Locks, day preferences, and kitchen waking windows
  const v7Errors = [];
  for (const [tid, spec] of Object.entries(specById)) {
    const t = taskById[tid];
    if (!t) continue;
    if (spec.locked_start_min !== null && t.start_min !== spec.locked_start_min) {
      v7Errors.push(
        `Lock violated for ${tid}: placed at ${formatMinute(t.start_min)}, locked at ${formatMinute(spec.locked_start_min)}.`
      );
    }
    if (spec.locked_start_min === null && kitchen.earliest_start_min !== null) {
      if (t.start_min < kitchen.earliest_start_min) {
        v7Errors.push(
          `${tid} starts in the past (${formatMinute(t.start_min)} < earliest allowed ${formatMinute(kitchen.earliest_start_min)}).`
        );
      }
    }
    if (spec.locked_start_min === null && !activeInWakingWindow(t, spec, request)) {
      v7Errors.push(
        `${tid} (${formatMinute(t.start_min)}–${formatMinute(t.end_min)}) falls outside kitchen operating hours.`
      );
    }
    if (spec.locked_start_min === null) {
      if (spec.day_preference === "day_before" && t.start_min >= DAY_MINUTES) {
        v7Errors.push(`${tid} must start Day Before, placed at ${formatMinute(t.start_min)}.`);
      }
      if (spec.day_preference === "day_of" && t.start_min < DAY_MINUTES) {
        v7Errors.push(`${tid} must run on Thanksgiving Day, placed at ${formatMinute(t.start_min)}.`);
      }
    }
  }
  checks.push({
    id: "V7_LOCKS_WINDOWS",
    name: "Hard Locks, Day Rules & Kitchen Hours",
    passed: v7Errors.length === 0,
    detail:
      v7Errors.length === 0
        ? "All pinned locks, day assignments, and kitchen waking hours respected."
        : v7Errors.join("; "),
  });
  violations.push(...v7Errors);

  // V8: Dinner & Dessert Ready-By Deadlines
  const v8Errors = [];
  for (const [tid, spec] of Object.entries(specById)) {
    const t = taskById[tid];
    if (!t) continue;
    if (spec.anchor === "dinner") {
      if (t.end_min > kitchen.dinner_ready_min) {
        v8Errors.push(
          `${t.dish_name} finishes late (${formatMinute(t.end_min)} > Dinner ${formatMinute(kitchen.dinner_ready_min)}).`
        );
      } else if (kitchen.dinner_ready_min - t.end_min > spec.max_hold_min) {
        v8Errors.push(
          `${t.dish_name} finishes too early (${kitchen.dinner_ready_min - t.end_min}m hold > max ${spec.max_hold_min}m).`
        );
      }
    } else if (spec.anchor === "dessert") {
      if (t.end_min > kitchen.dessert_ready_min) {
        v8Errors.push(
          `${t.dish_name} misses dessert time (${formatMinute(t.end_min)} > Dessert ${formatMinute(kitchen.dessert_ready_min)}).`
        );
      } else if (kitchen.dessert_ready_min - t.end_min > spec.max_hold_min) {
        v8Errors.push(
          `${t.dish_name} finishes too early for warm dessert (${kitchen.dessert_ready_min - t.end_min}m > max ${spec.max_hold_min}m).`
        );
      }
    }
  }
  checks.push({
    id: "V8_DEADLINES",
    name: "Dinner & Dessert Ready-By Timing",
    passed: v8Errors.length === 0,
    detail:
      v8Errors.length === 0
        ? `All savory dishes land hot by ${formatMinute(kitchen.dinner_ready_min)}; desserts ready by ${formatMinute(kitchen.dessert_ready_min)}.`
        : v8Errors.join("; "),
  });
  violations.push(...v8Errors);

  return {
    valid: violations.length === 0,
    checks,
    violations,
  };
}

// ---------------------------------------------------------------------------
// Main In-Browser Constraint Solver Entrypoint
// ---------------------------------------------------------------------------
export function solveScheduleBrowser(rawRequest) {
  const t0 = typeof performance !== "undefined" ? performance.now() : Date.now();
  const elapsedMs = () =>
    Math.round(((typeof performance !== "undefined" ? performance.now() : Date.now()) - t0) * 100) / 100;

  const request = normalizeRequest(rawRequest);
  const k = request.kitchen;

  // Basic kitchen window sanity checks matching KitchenConfig.validate_windows
  if (
    k.day_before_end_min <= k.day_before_start_min ||
    k.day_of_end_min <= k.day_of_start_min ||
    k.dinner_ready_min <= k.day_of_start_min + 60
  ) {
    return {
      status: "invalid_input",
      solve_ms: elapsedMs(),
      objective_value: null,
      tasks: [],
      events: [],
      validation: null,
      diagnostics: ["Kitchen operating windows are invalid (check Dinner Time vs. Day-Of Start)."],
      repair_summary: {},
      turkey_rest_window: null,
    };
  }

  const specs = expandPlanTasks(request);
  if (specs.length === 0) {
    return {
      status: "invalid_input",
      solve_ms: elapsedMs(),
      objective_value: null,
      tasks: [],
      events: [],
      validation: null,
      diagnostics: ["Enable at least one dish to build a schedule."],
      repair_summary: {},
      turkey_rest_window: null,
    };
  }

  const indexById = {};
  specs.forEach((s, idx) => {
    indexById[s.id] = idx;
  });

  // 1. Initial domains + hard anchor intersections
  const canRunDayBefore = {};
  const baseDomains = specs.map((spec) => {
    let ranges = domainIntervals(spec, request);
    canRunDayBefore[spec.id] = ranges.some(([lo]) => lo < DAY_MINUTES);
    if (spec.anchor === "dinner") {
      ranges = clampIntervals(
        ranges,
        k.dinner_ready_min - spec.max_hold_min - spec.duration_min,
        k.dinner_ready_min - spec.duration_min
      );
    } else if (spec.anchor === "dessert") {
      ranges = clampIntervals(
        ranges,
        k.dessert_ready_min - spec.max_hold_min - spec.duration_min,
        k.dessert_ready_min - spec.duration_min
      );
    }
    return ranges;
  });

  // 2. Fixed-point precedence bound propagation
  const rootDomains = cloneDomains(baseDomains);
  if (!propagateBounds(rootDomains, specs, indexById)) {
    return {
      status: "infeasible",
      solve_ms: elapsedMs(),
      objective_value: null,
      tasks: [],
      events: [],
      validation: null,
      diagnostics: diagnoseInfeasibility(specs, request),
      repair_summary: {},
      turkey_rest_window: null,
    };
  }

  // 3. Deterministic Backtracking CSP Search with Forward Checking
  const assignedList = [];
  const assignedById = {};
  let nodesVisited = 0;
  const MAX_NODES = 25000;
  const deadlineMs = t0 + Math.min(250, (request.time_limit_sec || 3.0) * 100);
  let solvedMap = null;

  function backtrack(domains) {
    nodesVisited += 1;
    if (nodesVisited > MAX_NODES) return false;
    if ((nodesVisited & 255) === 0) {
      const now = typeof performance !== "undefined" ? performance.now() : Date.now();
      if (now > deadlineMs) return false;
    }

    const nextIdx = selectNextUnassignedIndex(specs, domains, assignedById);
    if (nextIdx === -1) {
      solvedMap = {};
      for (const [id, val] of Object.entries(assignedById)) {
        solvedMap[id] = { ...val };
      }
      return true;
    }

    const spec = specs[nextIdx];
    const ranges = domains[nextIdx];
    if (ranges.length === 0) return false;

    const resources = orderedResourcesForSpec(spec, k);
    for (const res of resources) {
      const candidates = generateCandidates(spec, res, ranges, assignedList, assignedById, specs, request);
      for (const start of candidates) {
        const placement = {
          id: spec.id,
          resource: res,
          start,
          end: start + spec.duration_min,
          temp: res === "stovetop" ? null : spec.temp_f,
          racks: spec.racks,
          active_hands: spec.active_hands,
        };

        const nextDomains = cloneDomains(domains);
        nextDomains[nextIdx] = [[start, start]];
        if (!propagateBounds(nextDomains, specs, indexById)) {
          continue;
        }

        assignedList.push(placement);
        assignedById[spec.id] = placement;

        if (backtrack(nextDomains)) {
          return true;
        }

        assignedList.pop();
        delete assignedById[spec.id];
      }
    }
    return false;
  }

  const found = backtrack(rootDomains);
  if (!found || !solvedMap) {
    return {
      status: "infeasible",
      solve_ms: elapsedMs(),
      objective_value: null,
      tasks: [],
      events: [],
      validation: null,
      diagnostics: diagnoseInfeasibility(specs, request),
      repair_summary: {},
      turkey_rest_window: null,
    };
  }

  // 4. Local coordinate-descent polish to optimize culinary freshness, Wed clustering & repair shifts
  const objectiveVal = localPolish(specs, solvedMap, baseDomains, indexById, request, canRunDayBefore);

  // 5. Materialize ScheduledTask list
  const scheduled = [];
  let movedCount = 0;
  let totalShift = 0;
  let turkeyRestWindow = null;

  for (const spec of specs) {
    const p = solvedMap[spec.id];
    const hasRef = request.repair_mode && Object.prototype.hasOwnProperty.call(request.reference_starts, spec.id);
    const shiftVal = hasRef ? p.start - request.reference_starts[spec.id] : 0;
    if (shiftVal !== 0) {
      movedCount += 1;
      totalShift += Math.abs(shiftVal);
    }
    if (spec.id === "turkey__rest") {
      turkeyRestWindow = [p.start, p.end];
    }

    scheduled.push({
      id: spec.id,
      dish_id: spec.dish_id,
      dish_name: spec.dish_name,
      emoji: spec.emoji,
      category: spec.category,
      label: spec.label,
      kind: spec.kind,
      resource: p.resource,
      start_min: p.start,
      end_min: p.end,
      duration_min: spec.duration_min,
      temp_f: p.resource === "stovetop" ? null : spec.temp_f,
      racks: spec.racks,
      active_hands: spec.active_hands,
      locked: spec.locked_start_min !== null,
      shifted_min: shiftVal,
      start_label: formatMinute(p.start),
      end_label: formatMinute(p.end),
      tip: spec.tip,
      is_primary_cook: spec.is_primary_cook,
    });
  }

  scheduled.sort((a, b) => a.start_min - b.start_min || a.end_min - b.end_min || a.id.localeCompare(b.id));

  // 6. Independent 8-Invariant Verification!
  const validation = validateScheduleBrowser(request, scheduled);
  const events = deriveKitchenEvents(scheduled, request);

  return {
    status: validation.valid ? "optimal" : "infeasible",
    solve_ms: elapsedMs(),
    objective_value: Math.round(objectiveVal),
    tasks: validation.valid ? scheduled : [],
    events: validation.valid ? events : [],
    validation,
    diagnostics: validation.valid ? [] : validation.violations,
    repair_summary: request.repair_mode
      ? { tasks_shifted: movedCount, total_shift_min: totalShift }
      : {},
    turkey_rest_window: validation.valid ? turkeyRestWindow : null,
  };
}
