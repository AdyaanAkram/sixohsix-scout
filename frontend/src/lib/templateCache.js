/** Offline template cache for evaluation-day resilience (Aug 16).
 * Templates are prefetched when an assignment opens — never lazily per athlete.
 */
const CACHE_PREFIX = "pbg_station_templates_";

export function stationCacheKey(eventId, stationId) {
  return `${CACHE_PREFIX}${eventId}_${stationId}`;
}

export function saveStationTemplates(eventId, stationId, payload) {
  try {
    localStorage.setItem(stationCacheKey(eventId, stationId), JSON.stringify({
      ...payload,
      cached_at: new Date().toISOString(),
    }));
    return true;
  } catch {
    return false; /* quota / private mode */
  }
}

export function loadStationTemplates(eventId, stationId) {
  try {
    return JSON.parse(localStorage.getItem(stationCacheKey(eventId, stationId)) || "null");
  } catch {
    return null;
  }
}

/** Client-side mirror of backend resolve_template for offline use. */
export function resolveTemplateLocal(templates, { position, stationTemplateId }) {
  const pos = (position || "").toUpperCase() || null;
  const byId = Object.fromEntries((templates || []).map((t) => [t.id, t]));
  const OF = new Set(["LF", "CF", "RF", "OF"]);
  const IF = new Set(["1B", "2B", "3B", "SS", "IF"]);

  if (pos) {
    for (const t of templates || []) {
      if ((t.applies_to_positions || []).includes(pos)) return { template: t, reason: "position_match" };
    }
    const group = OF.has(pos) ? "OF" : IF.has(pos) ? "IF" : null;
    if (group) {
      for (const t of templates || []) {
        if ((t.applies_to_positions || []).includes(group)) return { template: t, reason: "position_group" };
      }
    }
  }
  if (stationTemplateId && byId[stationTemplateId]) {
    return { template: byId[stationTemplateId], reason: "station_default" };
  }
  const def = (templates || []).find((t) => t.is_default);
  if (def) return { template: def, reason: "org_default" };
  return { template: null, reason: null };
}

export const POSITIONS = ["P", "C", "1B", "2B", "3B", "SS", "LF", "CF", "RF", "OF", "IF", "DH", "UTIL"];
