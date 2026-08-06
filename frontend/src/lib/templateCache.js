/** Offline template cache for evaluation-day resilience (Aug 16).
 * Templates are prefetched when an assignment opens — never lazily per athlete.
 */
const CACHE_PREFIX = "pbg_station_templates_";

export function stationCacheKey(eventId, stationId) {
  return `${CACHE_PREFIX}${eventId}_${stationId}`;
}

export function saveStationTemplates(eventId, stationId, payload) {
  // lsSetSafe prunes stale cached snapshots on quota before giving up.
  return lsSetSafe(stationCacheKey(eventId, stationId), JSON.stringify({
    ...payload,
    cached_at: new Date().toISOString(),
  })).ok;
}

export function loadStationTemplates(eventId, stationId) {
  try {
    return JSON.parse(localStorage.getItem(stationCacheKey(eventId, stationId)) || "null");
  } catch {
    return null;
  }
}

/* ---- Age bands: mirror of backend/positions.py AGE_BAND_SPANS ---- */
const AGE_BAND_SPANS = {
  "7U-8U": [0, 8],
  "9U-10U": [9, 10],
  "11U-12U": [11, 12],
  "13U-14U": [13, 14],
  "15U-16U": [15, 16],
  "17U-18U": [17, 18],
  College: [19, 22],
  Professional: [23, 99],
};

const POSITION_TAXONOMY = ["P", "C", "1B", "2B", "3B", "SS", "LF", "CF", "RF", "OF", "IF", "DH", "UTIL"];
const POSITION_TO_GROUP = {
  LF: "OF", CF: "OF", RF: "OF",
  "1B": "IF", "2B": "IF", "3B": "IF", SS: "IF",
};

function canonAge(token) {
  if (!token) return null;
  return String(token).trim().toUpperCase().replace(/–/g, "-");
}

function ageRank(token) {
  const t = canonAge(token);
  if (!t) return null;
  if (t === "COLLEGE") return 19;
  if (t === "PRO" || t === "PROFESSIONAL") return 25;
  if (t.endsWith("U") && /^\d+$/.test(t.slice(0, -1))) return parseInt(t.slice(0, -1), 10);
  if (/^\d+$/.test(t)) return parseInt(t, 10);
  return null;
}

/** Numeric [lo, hi] for a canonical band, legacy band ("8U-10U"), single-year
 *  label ("12U"), College or Pro. null when unparseable. */
function ageSpan(token) {
  const t = canonAge(token);
  if (!t) return null;
  for (const band of Object.keys(AGE_BAND_SPANS)) {
    if (t === band.toUpperCase()) return AGE_BAND_SPANS[band];
  }
  if (t === "PRO" || t === "PROFESSIONAL") return AGE_BAND_SPANS.Professional;
  if (t.includes("-")) {
    const i = t.indexOf("-");
    const lo = ageRank(t.slice(0, i).trim());
    const hi = ageRank(t.slice(i + 1).trim());
    if (lo !== null && hi !== null) return [Math.min(lo, hi), Math.max(lo, hi)];
    return null;
  }
  const r = ageRank(t);
  return r !== null ? [r, r] : null;
}

/** True when the template's age_group covers the athlete's age label.
 *  Spans overlap rather than nest, so legacy labels on either side still match. */
function ageMatches(athleteAge, templateAge) {
  if (!templateAge) return true;
  if (!athleteAge) return false;
  const ta = canonAge(templateAge);
  const aa = canonAge(athleteAge);
  if (ta === aa) return true;
  const tspan = ageSpan(ta);
  const aspan = ageSpan(aa);
  if (!tspan || !aspan) return false;
  return aspan[0] <= tspan[1] && tspan[0] <= aspan[1];
}

/** Narrower age bands win ties. Unparseable/blank sort last. */
function ageSpecificity(t) {
  const span = ageSpan(t?.age_group);
  return span ? span[1] - span[0] : 999;
}

/** Gap in years between a template's band and the athlete's. Age-neutral
 *  templates sort first — they are authored to cover every band. */
function ageDistance(t, ageGroup) {
  const tspan = ageSpan(t?.age_group);
  if (!tspan) return -1;
  const aspan = ageSpan(ageGroup);
  if (!aspan) return 999;
  return Math.max(0, aspan[0] - tspan[1], tspan[0] - aspan[1]);
}

/** Candidates carrying an age_group compatible with the athlete, tightest first. */
function ageHits(candidates, ageGroup) {
  if (!ageGroup) return [];
  return (candidates || [])
    .filter((t) => t?.age_group && ageMatches(ageGroup, t.age_group))
    .sort((a, b) => ageSpecificity(a) - ageSpecificity(b));
}

function minBy(list, score) {
  let best = null;
  let bestScore = Infinity;
  for (const t of list) {
    const s = score(t);
    if (s < bestScore) { best = t; bestScore = s; }
  }
  return best;
}

/** Client-side mirror of backend resolve_template (backend/positions.py) for
 *  offline use. Age is part of the lookup, not a tiebreaker: an age+position
 *  template outranks a position-only one, so an offline evaluator resolves the
 *  same template the server would. Precedence:
 *    age+position exact -> age+position group -> position exact ->
 *    position group -> age only -> station default -> org default
 */
export function resolveTemplateLocal(templates, { position, stationTemplateId, ageGroup = null } = {}) {
  const list = templates || [];
  const raw = (position || "").toUpperCase();
  const pos = POSITION_TAXONOMY.includes(raw) ? raw : null;
  const byId = Object.fromEntries(list.filter((t) => t?.id).map((t) => [t.id, t]));

  let exact = [];
  let groupHits = [];
  if (pos) {
    exact = list.filter((t) => (t.applies_to_positions || []).includes(pos));
    const group = POSITION_TO_GROUP[pos];
    if (group) groupHits = list.filter((t) => (t.applies_to_positions || []).includes(group));
  }

  // 1. age_group + exact position
  const agedExact = ageHits(exact, ageGroup);
  if (agedExact.length) return { template: agedExact[0], reason: "position_match_age" };

  // 2. age_group + position group
  const agedGroup = ageHits(groupHits, ageGroup);
  if (agedGroup.length) return { template: agedGroup[0], reason: "position_group_age" };

  // 3. exact position, any age — nearest band, age-neutral templates first
  if (exact.length) {
    return {
      template: minBy(exact, (t) => ageDistance(t, ageGroup)),
      reason: ageGroup ? "position_match_no_age" : "position_match",
    };
  }

  // 4. position group, any age
  if (groupHits.length) {
    return {
      template: minBy(groupHits, (t) => ageDistance(t, ageGroup)),
      reason: ageGroup ? "position_group_no_age" : "position_group",
    };
  }

  // 5. age_group only — template carries no position filter
  const ageOnly = ageHits(list.filter((t) => !(t.applies_to_positions || []).length), ageGroup);
  if (ageOnly.length) return { template: ageOnly[0], reason: "age_match" };

  // 6. Station default
  if (stationTemplateId && byId[stationTemplateId]) {
    return { template: byId[stationTemplateId], reason: "station_default" };
  }

  // 7. Org catch-all
  const def = list.find((t) => t.is_default);
  if (def) return { template: def, reason: "org_default" };
  return { template: null, reason: null };
}

export const POSITIONS = ["P", "C", "1B", "2B", "3B", "SS", "LF", "CF", "RF", "OF", "IF", "DH", "UTIL"];

/* ==========================================================================
 * Durable offline store — IndexedDB mirror underneath the existing
 * localStorage draft path. Added Aug 2026 for the live evaluation event.
 *
 * Layering, deliberately: localStorage stays the SYNCHRONOUS fast path and the
 * fallback. IndexedDB is an additional durable mirror that survives a
 * localStorage quota wall and holds media Blobs (which cannot live in
 * localStorage at all). Nothing here removes a draft; deletion still happens
 * only on an explicit server ack, via deleteDraft().
 * ========================================================================== */

export const draftKey = (id) => `pbg_draft_${id}`;
export const templateDraftKey = (id) => `pbg_eval_template_${id}`;
export const metaDraftKey = (id) => `pbg_eval_meta_${id}`;

const DRAFT_PREFIX = "pbg_draft_";
const TEMPLATE_PREFIX = "pbg_eval_template_";
const META_PREFIX = "pbg_eval_meta_";

const DB_NAME = "pbg_offline";
const DB_VERSION = 1;
const STORE_DRAFTS = "drafts";
const STORE_MEDIA = "media";

let dbPromise;

/** Opens (once) the offline DB. Resolves null on ANY failure — private mode,
 *  disabled storage, blocked upgrade, or a hang. Callers must treat null as
 *  "IndexedDB unavailable" and fall back to localStorage. */
function openDb() {
  if (dbPromise !== undefined) return dbPromise;
  dbPromise = new Promise((resolve) => {
    try {
      if (typeof indexedDB === "undefined" || !indexedDB) { resolve(null); return; }
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      let settled = false;
      const done = (v) => { if (!settled) { settled = true; resolve(v); } };
      // Safari private mode / a locked profile can leave open() pending forever.
      const timer = setTimeout(() => done(null), 3000);
      req.onupgradeneeded = () => {
        try {
          const db = req.result;
          if (!db.objectStoreNames.contains(STORE_DRAFTS)) db.createObjectStore(STORE_DRAFTS, { keyPath: "id" });
          if (!db.objectStoreNames.contains(STORE_MEDIA)) db.createObjectStore(STORE_MEDIA, { keyPath: "id" });
        } catch { /* handled by onerror */ }
      };
      req.onsuccess = () => { clearTimeout(timer); done(req.result); };
      req.onerror = () => { clearTimeout(timer); done(null); };
      req.onblocked = () => { clearTimeout(timer); done(null); };
    } catch {
      resolve(null);
    }
  });
  return dbPromise;
}

async function idbPut(store, value) {
  const db = await openDb();
  if (!db) return false;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(store, "readwrite");
      tx.objectStore(store).put(value);
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => resolve(false);
      tx.onabort = () => resolve(false);
    } catch { resolve(false); }
  });
}

async function idbGet(store, key) {
  const db = await openDb();
  if (!db) return null;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(store, "readonly");
      const req = tx.objectStore(store).get(key);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => resolve(null);
      tx.onabort = () => resolve(null);
    } catch { resolve(null); }
  });
}

async function idbDelete(store, key) {
  const db = await openDb();
  if (!db) return false;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(store, "readwrite");
      tx.objectStore(store).delete(key);
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => resolve(false);
      tx.onabort = () => resolve(false);
    } catch { resolve(false); }
  });
}

async function idbGetAll(store) {
  const db = await openDb();
  if (!db) return [];
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(store, "readonly");
      const req = tx.objectStore(store).getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => resolve([]);
      tx.onabort = () => resolve([]);
    } catch { resolve([]); }
  });
}

/** True for the several browser spellings of "storage is full". */
function isQuotaError(e) {
  if (!e) return false;
  return e.name === "QuotaExceededError"
    || e.name === "NS_ERROR_DOM_QUOTA_REACHED"
    || e.code === 22 || e.code === 1014;
}

function allLocalKeys() {
  const keys = [];
  try {
    for (let i = 0; i < localStorage.length; i += 1) {
      const k = localStorage.key(i);
      if (k) keys.push(k);
    }
  } catch { /* storage unavailable */ }
  return keys;
}

function cachedAtOf(key) {
  try {
    const v = JSON.parse(localStorage.getItem(key) || "null");
    return (v && v.cached_at) || "";
  } catch { return ""; }
}

/** Frees localStorage WITHOUT touching any unsynced draft.
 *  Only cached snapshots (template/meta) for evaluations that have no pending
 *  draft are removed, oldest first; then stale station template packs.
 *  Returns the number of keys removed. */
export function pruneStorage(protectId) {
  let removed = 0;
  try {
    const keys = allLocalKeys();
    const pendingIds = new Set(
      keys.filter((k) => k.startsWith(DRAFT_PREFIX)).map((k) => k.slice(DRAFT_PREFIX.length)),
    );
    const candidates = [];
    for (const k of keys) {
      let id = null;
      if (k.startsWith(TEMPLATE_PREFIX)) id = k.slice(TEMPLATE_PREFIX.length);
      else if (k.startsWith(META_PREFIX)) id = k.slice(META_PREFIX.length);
      if (!id || id === protectId) continue;
      if (pendingIds.has(id)) continue; // unsynced work — never touch
      candidates.push({ k, at: cachedAtOf(k) });
    }
    candidates.sort((a, b) => String(a.at).localeCompare(String(b.at)));
    for (const c of candidates) {
      try { localStorage.removeItem(c.k); removed += 1; } catch { /* ignore */ }
    }
    if (removed) return removed;
    // Nothing else to give: drop the oldest station template packs, keeping the
    // newest so the current station can still resolve a template offline.
    const packs = keys
      .filter((k) => k.startsWith(CACHE_PREFIX))
      .map((k) => ({ k, at: cachedAtOf(k) }))
      .sort((a, b) => String(a.at).localeCompare(String(b.at)));
    for (const p of packs.slice(0, Math.max(0, packs.length - 1))) {
      try { localStorage.removeItem(p.k); removed += 1; } catch { /* ignore */ }
    }
  } catch { /* ignore */ }
  return removed;
}

/** localStorage.setItem that can never throw into a save path.
 *  On quota it prunes cached snapshots and retries once. */
function lsSetSafe(key, value, protectId) {
  try {
    localStorage.setItem(key, value);
    return { ok: true };
  } catch (e) {
    if (!isQuotaError(e)) return { ok: false, reason: "unavailable" };
    if (pruneStorage(protectId)) {
      try {
        localStorage.setItem(key, value);
        return { ok: true, pruned: true };
      } catch { /* still full */ }
    }
    return { ok: false, reason: "quota" };
  }
}

export function readDraftLocal(evaluationId) {
  try { return JSON.parse(localStorage.getItem(draftKey(evaluationId)) || "null"); } catch { return null; }
}

/** Writes the draft to BOTH stores. localStorage is written synchronously so
 *  the existing fast path is unchanged; IndexedDB is mirrored in the
 *  background. Returns the synchronous localStorage result plus a `durable`
 *  promise resolving to whether the IndexedDB mirror succeeded. */
export function saveDraft(evaluationId, draft) {
  const res = lsSetSafe(draftKey(evaluationId), JSON.stringify(draft), evaluationId);
  const durable = idbPut(STORE_DRAFTS, {
    ...draft, id: evaluationId, mirrored_at: new Date().toISOString(),
  }).catch(() => false);
  return { ...res, durable };
}

/** Restores from whichever store holds the newer draft (same client_updated_at
 *  comparison the online path uses). */
export async function loadDraftBest(evaluationId) {
  const local = readDraftLocal(evaluationId);
  let durable = null;
  try { durable = await idbGet(STORE_DRAFTS, evaluationId); } catch { durable = null; }
  if (!durable) return local;
  if (!local) return durable;
  const a = local.client_updated_at || "";
  const b = durable.client_updated_at || "";
  return b > a ? durable : local;
}

/** ONLY call after an explicit server acknowledgement. Clears both stores. */
export function deleteDraft(evaluationId) {
  try { localStorage.removeItem(draftKey(evaluationId)); } catch { /* ignore */ }
  idbDelete(STORE_DRAFTS, evaluationId).catch(() => {});
}

/** Template + athlete snapshot so an offline reload still shows who is being
 *  scored. Quota-safe; stamped with cached_at so pruning can order them. */
export function saveEvalSnapshot(evaluationId, { template, meta }) {
  const cached_at = new Date().toISOString();
  let ok = true;
  if (template) {
    ok = lsSetSafe(templateDraftKey(evaluationId), JSON.stringify({ ...template, cached_at }), evaluationId).ok && ok;
  }
  if (meta) {
    ok = lsSetSafe(metaDraftKey(evaluationId), JSON.stringify({ ...meta, cached_at }), evaluationId).ok && ok;
  }
  return ok;
}

/* ---------------- Offline media queue (spec §11) ---------------- */

// Mirrors the backend limits so a doomed upload fails on the phone, not after
// a multi-minute push over camp wifi.
export const MEDIA_MAX_BYTES = 50 * 1024 * 1024;
export const MEDIA_WARN_BYTES = 12 * 1024 * 1024;
export const MEDIA_ALLOWED_EXT = [".jpg", ".jpeg", ".png", ".webp", ".heic", ".mp4", ".mov", ".webm", ".m4v"];

export function mediaExtOf(name) {
  const m = /\.[a-z0-9]+$/i.exec(name || "");
  return m ? m[0].toLowerCase() : "";
}

/** Blobs only live in IndexedDB — localStorage cannot hold them. Returns the
 *  queue id, or null when IndexedDB is unavailable (caller MUST NOT tell the
 *  user the file is safe in that case). */
export async function queueMedia(record) {
  const id = record.id || `m_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const ok = await idbPut(STORE_MEDIA, { ...record, id, queued_at: new Date().toISOString() });
  return ok ? id : null;
}

export async function listQueuedMedia() {
  return idbGetAll(STORE_MEDIA);
}

export async function deleteQueuedMedia(id) {
  return idbDelete(STORE_MEDIA, id);
}

export async function countQueuedMedia() {
  return (await idbGetAll(STORE_MEDIA)).length;
}

/* ---------------- App-shell service worker ---------------- */

let swAttempted = false;

/** Registers the offline app-shell worker. Defensive by construction: any
 *  failure is swallowed, and it is a no-op outside a production build so it can
 *  never interfere with a dev server. `pbg_sw_disable=1` in localStorage is a
 *  kill switch that unregisters everything — a live-event escape hatch. */
export function registerAppShell() {
  if (swAttempted) return;
  swAttempted = true;
  try {
    if (typeof window === "undefined" || typeof navigator === "undefined") return;
    if (!("serviceWorker" in navigator)) return;

    let disabled = false;
    try { disabled = localStorage.getItem("pbg_sw_disable") === "1"; } catch { /* ignore */ }
    if (disabled) {
      navigator.serviceWorker.getRegistrations()
        .then((rs) => rs.forEach((r) => r.unregister()))
        .catch(() => {});
      return;
    }
    if (process.env.NODE_ENV !== "production") return;

    const url = `${process.env.PUBLIC_URL || ""}/sw.js`;
    const go = () => {
      navigator.serviceWorker.register(url, { scope: "/", updateViaCache: "none" })
        .then((reg) => { try { reg.update(); } catch { /* ignore */ } })
        .catch(() => { /* no offline shell; the app still works normally */ });
    };
    if (document.readyState === "complete") go();
    else window.addEventListener("load", go, { once: true });
  } catch {
    /* a cache optimisation must never break the app */
  }
}
