import { useEffect, useMemo, useState } from "react";
import { api, errMsg } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { EmptyState } from "@/components/common/EmptyState";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import { AlertTriangle, ArrowDown, ArrowUp, ChevronDown, FileSpreadsheet, Layers, ListChecks, Pencil, Plus, Star, Trash2, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { POSITIONS } from "@/lib/templateCache";

const TYPE_LABELS = { rating_5: "1-5 Rating", rating_10: "1-10 Rating", numeric: "Numeric", time: "Time", velocity: "Velocity", yes_no: "Yes/No", multiple_choice: "Multiple Choice", comment: "Comment", observation: "Observation" };
const ALL_AGES = "__all__";

// Weights are relative on the backend, but coaches read them as percentages, so
// warn (never block) when a template's category weights don't add up to ~100.
const WEIGHT_TARGET = 100;
const weightSum = (cats) => (cats || []).reduce((s, c) => s + (Number(c.weight) || 0), 0);
const weightsOk = (cats) => !cats?.length || Math.abs(weightSum(cats) - WEIGHT_TARGET) < 0.5;

// Full PUT body — /templates/{id} needs the whole document, so preserve every field
// the caller isn't explicitly changing (metrics especially). station_kind is in
// here on purpose: the backend $sets the whole doc, so omitting it wipes the
// field and the station-first form resolution silently stops working.
const putBody = (t, overrides = {}) => ({
  name: t.name,
  description: t.description,
  age_group: t.age_group,
  position: t.position,
  event_type: t.event_type,
  categories: t.categories || [],
  metrics: t.metrics || [],
  applies_to_positions: t.applies_to_positions || [],
  is_default: !!t.is_default,
  station_kind: t.station_kind ?? null,
  ...overrides,
});

// Fixed display order for age-band sections; anything unrecognized lands after
// College, and templates with no age_group go in the final General bucket.
const AGE_BAND_ORDER = ["7U-8U", "9U-10U", "11U-12U", "13U-14U", "15U-16U", "17U-18U", "College"];
const GENERAL_BAND = "General / All ages";
const bandKey = (b) => b.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

// Metric types that carry no score, hence no meaningful weight.
const UNSCORED_TYPES = new Set(["comment", "observation"]);

const prettyKind = (kind) => (kind || "").replace(/_/g, " ");

const PanelLabel = ({ children, className }) => (
  <p className={cn("text-[10px] font-semibold uppercase tracking-widest text-muted-foreground", className)}>{children}</p>
);

const StatTile = ({ icon: Icon, tint, value, label, sub, testId }) => (
  <div className="flex min-w-0 items-center gap-3" data-testid={testId}>
    <div className={cn("h-10 w-10 shrink-0 rounded-lg grid place-items-center", tint)}>
      <Icon className="h-5 w-5" />
    </div>
    <div className="min-w-0">
      <p className="font-mono-num text-2xl font-bold leading-none text-foreground">{value}</p>
      <p className="mt-1 text-xs font-semibold leading-snug text-foreground">{label}</p>
      {sub && <p className="text-[10px] text-muted-foreground truncate">{sub}</p>}
    </div>
  </div>
);

// Module-level on purpose: defining this inline inside Templates() would remount
// the input on every parent render and drop focus after each keystroke.
function MetricWeightInput({ templateId, metricId, weight, disabled, onSave }) {
  const [val, setVal] = useState(String(weight ?? 0));
  useEffect(() => { setVal(String(weight ?? 0)); }, [weight]);
  const commit = () => {
    const n = Number(val);
    if (val.trim() === "" || Number.isNaN(n) || n < 0) {
      toast.error("Weight must be a non-negative number.");
      setVal(String(weight ?? 0));
      return;
    }
    if (n === Number(weight ?? 0)) { setVal(String(n)); return; } // unchanged — skip the round-trip
    onSave(n);
  };
  return (
    <Input
      type="number"
      step="0.5"
      min="0"
      value={val}
      disabled={disabled}
      onChange={(e) => setVal(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); }}
      onClick={(e) => e.stopPropagation()}
      className="h-9 w-16 rounded-lg text-center font-mono-num text-xs"
      aria-label="Metric weight"
      data-testid={`metric-weight-${templateId}-${metricId}`}
    />
  );
}

export default function Templates() {
  const { user } = useAuth();
  const canEdit = ["owner", "admin"].includes(user?.role);
  const [templates, setTemplates] = useState(null);
  const [ageBands, setAgeBands] = useState([]);
  const [expanded, setExpanded] = useState({});
  const [openBands, setOpenBands] = useState({}); // all collapsed on load
  const [savingId, setSavingId] = useState(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editing, setEditing] = useState(null); // template being edited, or null = create
  const [deleteTarget, setDeleteTarget] = useState(null);

  const load = () => api.get("/templates").then((r) => setTemplates(r.data)).catch(() => setTemplates([]));
  useEffect(() => { load(); }, []);
  useEffect(() => {
    // Age bands are validated server-side; fetch the canonical list rather than hardcoding it.
    api.get("/age-bands").then((r) => setAgeBands(r.data?.age_bands || [])).catch(() => setAgeBands([]));
  }, []);

  // TRUE ambiguity only. Under station-aware resolution, many templates
  // legitimately share a position (different age bands, different station
  // kinds). A conflict is: two templates with the SAME station kind and SAME
  // age band, or (legacy untagged) the same position claim in the same band.
  const positionConflicts = useMemo(() => {
    const seen = {};
    for (const t of templates || []) {
      if (t.station_kind) {
        const key = `${t.station_kind} · ${t.age_group || "all ages"}`;
        (seen[key] = seen[key] || []).push(t.name);
      } else {
        for (const p of t.applies_to_positions || []) {
          const key = `${p} · ${t.age_group || "all ages"} (no station kind)`;
          (seen[key] = seen[key] || []).push(t.name);
        }
      }
    }
    return Object.entries(seen).filter(([, names]) => names.length > 1);
  }, [templates]);

  // Group templates into age-band sections in fixed order; cards within a
  // section sort by station_kind then name. Only non-empty sections render.
  const bandSections = useMemo(() => {
    const byBand = {};
    for (const t of templates || []) {
      const band = t.age_group && AGE_BAND_ORDER.includes(t.age_group) ? t.age_group : t.age_group || GENERAL_BAND;
      (byBand[band] = byBand[band] || []).push(t);
    }
    const extras = Object.keys(byBand).filter((b) => !AGE_BAND_ORDER.includes(b) && b !== GENERAL_BAND).sort();
    const order = [...AGE_BAND_ORDER, ...extras, GENERAL_BAND];
    const sortCards = (a, b) =>
      (a.station_kind || "").localeCompare(b.station_kind || "") || (a.name || "").localeCompare(b.name || "");
    return order.filter((b) => byBand[b]?.length).map((b) => [b, byBand[b].sort(sortCards)]);
  }, [templates]);

  const overview = useMemo(() => {
    const list = templates || [];
    return {
      total: list.length,
      bands: new Set(list.map((t) => t.age_group || GENERAL_BAND)).size,
      metrics: list.reduce((s, t) => s + (t.metrics || []).length, 0),
      defaultName: list.find((t) => t.is_default)?.name || null,
      untagged: list.filter((t) => !t.station_kind).length,
    };
  }, [templates]);

  // Inline weight edit: one metric's weight changes, everything else in the
  // template document is preserved via putBody.
  const saveMetricWeight = async (t, metricId, weight) => {
    if (!canEdit) return;
    const metrics = (t.metrics || []).map((m) => (m.id === metricId ? { ...m, weight } : m));
    setSavingId(t.id);
    try {
      await api.put(`/templates/${t.id}`, putBody(t, { metrics }));
      toast.success("Weight saved");
      await load();
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setSavingId(null);
    }
  };

  const patchTemplate = (id, next) => setTemplates((ts) => (ts || []).map((t) => (t.id === id ? { ...t, ...next } : t)));

  const togglePosition = async (t, pos) => {
    if (!canEdit) return;
    const current = new Set(t.applies_to_positions || []);
    if (current.has(pos)) current.delete(pos);
    else current.add(pos);
    const next = [...current];
    // warn client-side if another template already claims pos
    const clash = (templates || []).find((x) => x.id !== t.id && (x.applies_to_positions || []).includes(pos));
    if (clash && next.includes(pos)) {
      toast.warning(`${pos} is already claimed by "${clash.name}". Save anyway only if intentional.`);
    }
    setSavingId(t.id);
    try {
      await api.put(`/templates/${t.id}`, putBody(t, { applies_to_positions: next }));
      toast.success("Template positions updated.");
      await load();
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setSavingId(null);
    }
  };

  const setDefault = async (t) => {
    if (!canEdit) return;
    setSavingId(t.id);
    try {
      await api.put(`/templates/${t.id}`, putBody(t, { is_default: true }));
      toast.success(`"${t.name}" is now the org default catch-all.`);
      await load();
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setSavingId(null);
    }
  };

  // Reorder categories or metrics via the dedicated /order endpoint. Ordering is
  // presentational, so this does NOT bump template_version. We reconcile with the
  // server response (it returns the renumbered categories + metrics).
  const move = async (t, kind, index, dir) => {
    if (!canEdit) return;
    const target = index + dir;
    const isCat = kind === "category";
    const items = [...(isCat ? t.categories || [] : t.metrics || [])].sort((a, b) => (a.display_order || 0) - (b.display_order || 0));
    if (target < 0 || target >= items.length) return;
    [items[index], items[target]] = [items[target], items[index]];
    // optimistic
    patchTemplate(t.id, isCat ? { categories: items.map((c, i) => ({ ...c, display_order: i })) } : { metrics: items.map((m, i) => ({ ...m, display_order: i })) });
    const body = isCat ? { category_names: items.map((c) => c.name) } : { metric_ids: items.map((m) => m.id) };
    setSavingId(t.id);
    try {
      const r = await api.put(`/templates/${t.id}/order`, body);
      patchTemplate(t.id, { categories: r.data?.categories || t.categories, metrics: r.data?.metrics || t.metrics });
    } catch (e) {
      toast.error(errMsg(e));
      await load(); // reconcile on failure
    } finally {
      setSavingId(null);
    }
  };

  const doDelete = async () => {
    const t = deleteTarget;
    if (!t) return;
    setSavingId(t.id);
    try {
      await api.delete(`/templates/${t.id}`);
      toast.success(`"${t.name}" deleted.`);
      setDeleteTarget(null);
      await load();
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setSavingId(null);
    }
  };

  const openCreate = () => { setEditing(null); setEditorOpen(true); };
  const openEdit = (t) => { setEditing(t); setEditorOpen(true); };

  if (!templates) return <div className="space-y-2">{[...Array(4)].map((_, i) => <Skeleton key={i} className="h-20 rounded-2xl" />)}</div>;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="font-display text-3xl sm:text-4xl text-foreground">Evaluation Templates</h1>
          <p className="text-sm text-muted-foreground">
            Forms resolve by the station’s kind + the athlete’s age band first, then position/age, then the org default.
          </p>
        </div>
        {canEdit && (
          <Button className="h-10 shrink-0 rounded-xl bg-primary hover:bg-brand-secondary sm:h-11" onClick={openCreate} data-testid="template-create-btn">
            <Plus className="h-4 w-4 sm:mr-1" />
            <span className="hidden sm:inline">New template</span>
            <span className="ml-1 sm:hidden">New</span>
          </Button>
        )}
      </div>

      {templates.length > 0 && (
        <Card className="rounded-2xl border-border bg-card" data-testid="templates-overview">
          <CardContent className="pt-4 pb-4">
            <PanelLabel>Template library</PanelLabel>
            <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
              <StatTile
                icon={FileSpreadsheet}
                tint="bg-brand/15 text-brand"
                value={overview.total}
                label={overview.total === 1 ? "Template" : "Templates"}
                sub={overview.untagged === 0 ? "All tagged with a station kind" : `${overview.untagged} without a station kind`}
                testId="templates-stat-total"
              />
              <StatTile
                icon={Layers}
                tint="bg-info/15 text-info"
                value={overview.bands}
                label={overview.bands === 1 ? "Age band" : "Age bands"}
                sub="Sections below"
                testId="templates-stat-bands"
              />
              <StatTile
                icon={ListChecks}
                tint="bg-success/15 text-success"
                value={overview.metrics}
                label="Metrics"
                sub="Scored across all forms"
                testId="templates-stat-metrics"
              />
            </div>
            <p className="mt-3 border-t border-border pt-3 text-xs text-muted-foreground" data-testid="templates-default-line">
              {overview.defaultName ? (
                <>
                  <span className="font-semibold text-foreground">Org default catch-all:</span> {overview.defaultName} — used when no station kind or position matches.
                </>
              ) : (
                <>No org default catch-all is set. Every evaluation must match on station kind, position or age band.</>
              )}
            </p>
          </CardContent>
        </Card>
      )}

      {positionConflicts.length > 0 && (
        <Card className="rounded-2xl border-warning/40 bg-warning/10" data-testid="position-conflict-warning">
          <CardContent className="flex items-start gap-3 pt-4 pb-4">
            <div className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-warning/20 text-warning">
              <AlertTriangle className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <PanelLabel className="text-warning">Ambiguous templates</PanelLabel>
              <p className="mt-0.5 text-sm font-semibold text-warning">Two forms could load for the same athlete at the same station</p>
              <ul className="mt-1.5 space-y-1">
                {positionConflicts.map(([pos, names]) => (
                  <li key={pos} className="min-w-0 text-xs text-warning">
                    <span className="font-mono font-bold">{pos}</span>: {names.join(" · ")}
                  </li>
                ))}
              </ul>
            </div>
          </CardContent>
        </Card>
      )}

      {templates.length === 0 ? (
        <EmptyState icon={FileSpreadsheet} title="No templates" hint="Templates define the metrics evaluators score at each station." />
      ) : (
        <div className="space-y-3">
          {bandSections.map(([band, sectionTemplates]) => {
            const bandOpen = !!openBands[band];
            const bandMetrics = sectionTemplates.reduce((s, t) => s + (t.metrics || []).length, 0);
            const bandKinds = [...new Set(sectionTemplates.map((t) => t.station_kind).filter(Boolean))];
            return (
              <Card key={band} className="overflow-hidden rounded-2xl border-border bg-card">
                <button
                  type="button"
                  className="flex w-full items-center gap-3 px-4 py-4 text-left transition-colors hover:bg-secondary/40"
                  onClick={() => setOpenBands((x) => ({ ...x, [band]: !x[band] }))}
                  aria-expanded={bandOpen}
                  data-testid={`template-band-${bandKey(band)}`}
                >
                  <div className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-brand/15 text-brand">
                    <Layers className="h-5 w-5" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <PanelLabel>Age band</PanelLabel>
                    <p className="font-display text-2xl leading-tight text-foreground">{band}</p>
                    <p className="mt-0.5 truncate text-xs text-muted-foreground">
                      {sectionTemplates.length} {sectionTemplates.length === 1 ? "template" : "templates"} · {bandMetrics} metrics
                      {bandKinds.length > 0 ? ` · ${bandKinds.map(prettyKind).join(", ")}` : " · no station kind tagged"}
                    </p>
                  </div>
                  <span className="shrink-0 rounded-full bg-secondary px-2.5 py-0.5 font-mono-num text-xs font-bold text-foreground">
                    {sectionTemplates.length}
                  </span>
                  <ChevronDown className={cn("h-5 w-5 shrink-0 text-muted-foreground transition-transform", bandOpen && "rotate-180")} />
                </button>

                {bandOpen && (
                  <div className="space-y-2 border-t border-border p-3 sm:p-4">
                    {sectionTemplates.map((t) => {
                      const cats = [...(t.categories || [])].sort((a, b) => (a.display_order || 0) - (b.display_order || 0));
                      const mets = [...(t.metrics || [])].sort((a, b) => (a.display_order || 0) - (b.display_order || 0));
                      const badWeights = cats.length > 0 && !weightsOk(cats);
                      const catTotal = weightSum(cats);
                      const isOpen = !!expanded[t.id];
                      return (
                        <div
                          key={t.id}
                          className={cn(
                            "min-w-0 overflow-hidden rounded-xl border border-border bg-background transition-colors",
                            !isOpen && "hover:border-brand/50"
                          )}
                        >
                          <button
                            type="button"
                            className="flex w-full items-start gap-3 px-3 py-3 text-left"
                            onClick={() => setExpanded((x) => ({ ...x, [t.id]: !x[t.id] }))}
                            aria-expanded={isOpen}
                            data-testid={`template-toggle-${t.id}`}
                          >
                            <div className="min-w-0 flex-1">
                              <div className="flex flex-wrap items-center gap-1.5">
                                <p className="min-w-0 font-semibold text-foreground">{t.name}</p>
                                {t.station_kind ? (
                                  <span className="inline-flex items-center rounded-full bg-info/15 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-info">
                                    {prettyKind(t.station_kind)}
                                  </span>
                                ) : (
                                  <span className="inline-flex items-center rounded-full bg-secondary px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
                                    No station kind
                                  </span>
                                )}
                                {t.is_default && (
                                  <span className="inline-flex items-center gap-1 rounded-full border border-warning/40 bg-warning/15 px-2 py-0.5 text-[10px] font-bold uppercase text-warning" data-testid={`template-default-${t.id}`}>
                                    <Star className="h-3 w-3" /> Org default
                                  </span>
                                )}
                              </div>
                              <p className="mt-1 text-xs text-muted-foreground">
                                {t.age_group || "All ages"} · {(t.metrics || []).length} metrics · {cats.length} categories
                                {(t.applies_to_positions || []).length > 0
                                  ? ` · positions ${(t.applies_to_positions || []).join(", ")}`
                                  : " · universal / station fallback"}
                                {t.template_version ? ` · v${t.template_version}` : ""}
                              </p>
                              {badWeights && !isOpen && (
                                <p className="mt-1 inline-flex items-center gap-1 text-[11px] font-semibold text-warning">
                                  <AlertTriangle className="h-3 w-3" /> Category weights total {catTotal}, not 100
                                </p>
                              )}
                            </div>
                            <ChevronDown className={cn("mt-0.5 h-4 w-4 shrink-0 text-muted-foreground transition-transform", isOpen && "rotate-180")} />
                          </button>

                          {isOpen && (
                            <div className="space-y-4 border-t border-border px-3 pb-4 pt-3">
                              {canEdit && (
                                <div className="flex flex-wrap gap-2">
                                  <Button variant="outline" size="sm" className="h-9 rounded-lg text-xs" disabled={savingId === t.id} onClick={() => openEdit(t)} data-testid={`template-edit-${t.id}`}>
                                    <Pencil className="mr-1 h-3.5 w-3.5" /> Edit template
                                  </Button>
                                  {!t.is_default && (
                                    <Button variant="outline" size="sm" className="h-9 rounded-lg text-xs" disabled={savingId === t.id} onClick={() => setDefault(t)} data-testid={`template-set-default-${t.id}`}>
                                      <Star className="mr-1 h-3.5 w-3.5" /> Set as org default
                                    </Button>
                                  )}
                                  <Button variant="outline" size="sm" className="h-9 rounded-lg text-xs text-destructive hover:text-destructive" disabled={savingId === t.id} onClick={() => setDeleteTarget(t)} data-testid={`template-delete-${t.id}`}>
                                    <Trash2 className="mr-1 h-3.5 w-3.5" /> Delete
                                  </Button>
                                </div>
                              )}

                              <div>
                                <PanelLabel>Applies to positions</PanelLabel>
                                <div className="mt-2 flex flex-wrap gap-1.5">
                                  {POSITIONS.map((p) => {
                                    const on = (t.applies_to_positions || []).includes(p);
                                    return (
                                      <button
                                        key={p}
                                        type="button"
                                        disabled={!canEdit || savingId === t.id}
                                        onClick={() => togglePosition(t, p)}
                                        className={cn(
                                          "h-9 rounded-lg border px-2.5 text-xs font-bold transition-colors",
                                          on
                                            ? "border-transparent bg-primary text-white"
                                            : "border-border bg-card text-muted-foreground hover:border-brand/50 hover:text-foreground"
                                        )}
                                        data-testid={`template-pos-${t.id}-${p}`}
                                      >
                                        {p}
                                      </button>
                                    );
                                  })}
                                </div>
                                {(t.applies_to_positions || []).length === 0 && (
                                  <p className="mt-1.5 text-[11px] text-muted-foreground">
                                    No position claimed — this form is reached by station kind, age band or the org default.
                                  </p>
                                )}
                              </div>

                              {cats.length > 0 && (
                                <div>
                                  <div className="flex flex-wrap items-center justify-between gap-2">
                                    <PanelLabel>Categories</PanelLabel>
                                    <span
                                      className={cn(
                                        "rounded-full px-2 py-0.5 font-mono-num text-[11px] font-bold",
                                        badWeights ? "bg-warning/15 text-warning" : "bg-success/15 text-success"
                                      )}
                                      data-testid={`template-weight-sum-${t.id}`}
                                    >
                                      weights {catTotal}{badWeights ? " ≠ 100" : ""}
                                    </span>
                                  </div>
                                  {badWeights && (
                                    <p className="mt-2 flex items-start gap-1 text-xs text-warning" data-testid={`template-weight-warning-${t.id}`}>
                                      <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                                      <span className="min-w-0">Category weights total {catTotal}, not 100. They are used as relative weights, but a coach expects ~100.</span>
                                    </p>
                                  )}
                                  <div className="mt-2 space-y-1.5">
                                    {cats.map((c, i) => {
                                      const share = catTotal > 0 ? Math.round(((Number(c.weight) || 0) / catTotal) * 100) : 0;
                                      return (
                                        <div
                                          key={c.name}
                                          className="min-w-0 rounded-xl border border-border bg-secondary/30 px-3 py-2"
                                          data-testid={`template-cat-row-${t.id}-${c.name}`}
                                        >
                                          <div className="flex items-center gap-2">
                                            <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">{c.name}</span>
                                            <span className="shrink-0 font-mono-num text-xs font-bold text-foreground">{c.weight}</span>
                                            <span className="shrink-0 font-mono-num text-[10px] text-muted-foreground">{share}%</span>
                                            {canEdit && (
                                              <div className="flex shrink-0 items-center">
                                                <button type="button" disabled={i === 0 || savingId === t.id} onClick={() => move(t, "category", i, -1)} className="rounded p-1 transition-colors hover:text-primary disabled:opacity-30" aria-label={`Move ${c.name} up`} data-testid={`template-cat-up-${t.id}-${c.name}`}><ArrowUp className="h-3.5 w-3.5" /></button>
                                                <button type="button" disabled={i === cats.length - 1 || savingId === t.id} onClick={() => move(t, "category", i, 1)} className="rounded p-1 transition-colors hover:text-primary disabled:opacity-30" aria-label={`Move ${c.name} down`} data-testid={`template-cat-down-${t.id}-${c.name}`}><ArrowDown className="h-3.5 w-3.5" /></button>
                                              </div>
                                            )}
                                          </div>
                                          <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-secondary">
                                            <div className={cn("h-full rounded-full", badWeights ? "bg-warning" : "bg-brand")} style={{ width: `${Math.min(100, share)}%` }} />
                                          </div>
                                        </div>
                                      );
                                    })}
                                  </div>
                                </div>
                              )}

                              {mets.length > 0 && (
                                <div>
                                  <div className="flex flex-wrap items-center justify-between gap-2">
                                    <PanelLabel>Metrics</PanelLabel>
                                    {canEdit && (
                                      <span className="text-[10px] text-muted-foreground">Edit a weight and tab away to save</span>
                                    )}
                                  </div>
                                  <div className="mt-2 space-y-1.5">
                                    {mets.map((m, i) => {
                                      const unscored = UNSCORED_TYPES.has(m.metric_type);
                                      const lowerIsBetter = m.metric_type === "time" || m.higher_is_better === false;
                                      return (
                                        <div
                                          key={m.id}
                                          className="flex min-w-0 flex-wrap items-center gap-2 rounded-xl border border-border bg-secondary/30 px-3 py-2"
                                          data-testid={`template-metric-row-${t.id}-${m.id}`}
                                        >
                                          <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-secondary font-mono-num text-[11px] font-bold text-muted-foreground">
                                            {i + 1}
                                          </span>
                                          <div className="min-w-[8rem] flex-1">
                                            <p className="truncate text-sm font-medium text-foreground">
                                              {m.name} {m.required && <span className="text-destructive" title="Required">*</span>}
                                            </p>
                                            <p className="truncate text-[11px] text-muted-foreground">
                                              {m.category} · {TYPE_LABELS[m.metric_type] || m.metric_type}
                                              {m.unit ? ` (${m.unit})` : ""}
                                              {lowerIsBetter ? " · lower is better" : ""}
                                            </p>
                                          </div>
                                          <div className="ml-auto flex shrink-0 items-center gap-2">
                                            {unscored ? (
                                              <span className="rounded-full bg-secondary px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                                                Not scored
                                              </span>
                                            ) : canEdit ? (
                                              <MetricWeightInput
                                                templateId={t.id}
                                                metricId={m.id}
                                                weight={m.weight}
                                                disabled={savingId === t.id}
                                                onSave={(w) => saveMetricWeight(t, m.id, w)}
                                              />
                                            ) : (
                                              <span className="rounded-lg bg-secondary px-2 py-1 font-mono-num text-xs font-bold text-foreground">
                                                {m.weight}
                                              </span>
                                            )}
                                            {canEdit && (
                                              <div className="flex items-center">
                                                <button type="button" disabled={i === 0 || savingId === t.id} onClick={() => move(t, "metric", i, -1)} className="rounded p-1 transition-colors hover:text-primary disabled:opacity-30" aria-label={`Move ${m.name} up`} data-testid={`template-metric-up-${t.id}-${m.id}`}><ArrowUp className="h-3.5 w-3.5" /></button>
                                                <button type="button" disabled={i === mets.length - 1 || savingId === t.id} onClick={() => move(t, "metric", i, 1)} className="rounded p-1 transition-colors hover:text-primary disabled:opacity-30" aria-label={`Move ${m.name} down`} data-testid={`template-metric-down-${t.id}-${m.id}`}><ArrowDown className="h-3.5 w-3.5" /></button>
                                              </div>
                                            )}
                                          </div>
                                        </div>
                                      );
                                    })}
                                  </div>
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </Card>
            );
          })}
        </div>
      )}

      {canEdit && (
        <TemplateEditorDialog
          open={editorOpen}
          onOpenChange={setEditorOpen}
          editing={editing}
          ageBands={ageBands}
          onSaved={load}
        />
      )}

      <AlertDialog open={!!deleteTarget} onOpenChange={(v) => { if (!v) setDeleteTarget(null); }}>
        <AlertDialogContent className="rounded-2xl" data-testid="template-delete-dialog">
          <AlertDialogHeader>
            <AlertDialogTitle className="font-display text-2xl">Delete template?</AlertDialogTitle>
            <AlertDialogDescription>
              “{deleteTarget?.name}” and its {(deleteTarget?.metrics || []).length} metrics will be permanently removed. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="rounded-lg" data-testid="template-delete-cancel">Cancel</AlertDialogCancel>
            <AlertDialogAction className="rounded-lg bg-destructive text-white hover:bg-destructive/90" onClick={doDelete} data-testid="template-delete-confirm">
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// Create + edit share this dialog. Structural changes (name, age band, positions,
// add/remove/rename categories and their weights) go through POST or the full PUT.
// Category order here is by array position; reorder that must NOT bump the version
// is done from the card via the /order endpoint.
function TemplateEditorDialog({ open, onOpenChange, editing, ageBands, onSaved }) {
  const isEdit = !!editing;
  const [form, setForm] = useState({ name: "", description: "", age_group: "", applies_to_positions: [], categories: [] });
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    if (editing) {
      setForm({
        name: editing.name || "",
        description: editing.description || "",
        age_group: editing.age_group || "",
        applies_to_positions: [...(editing.applies_to_positions || [])],
        categories: [...(editing.categories || [])]
          .sort((a, b) => (a.display_order || 0) - (b.display_order || 0))
          .map((c) => ({ name: c.name, weight: c.weight ?? 0 })),
      });
    } else {
      setForm({ name: "", description: "", age_group: "", applies_to_positions: [], categories: [{ name: "", weight: 100 }] });
    }
  }, [open, editing]);

  const setCat = (i, patch) => setForm((f) => ({ ...f, categories: f.categories.map((c, j) => (j === i ? { ...c, ...patch } : c)) }));
  const addCat = () => setForm((f) => ({ ...f, categories: [...f.categories, { name: "", weight: 0 }] }));
  const removeCat = (i) => setForm((f) => ({ ...f, categories: f.categories.filter((_, j) => j !== i) }));
  const togglePos = (p) => setForm((f) => ({
    ...f,
    applies_to_positions: f.applies_to_positions.includes(p)
      ? f.applies_to_positions.filter((x) => x !== p)
      : [...f.applies_to_positions, p],
  }));

  const sum = weightSum(form.categories);
  const badWeights = form.categories.length > 0 && !weightsOk(form.categories);

  const save = async () => {
    const name = form.name.trim();
    if (!name) { toast.error("Template name is required."); return; }
    const cats = form.categories.map((c) => ({ name: c.name.trim(), weight: Number(c.weight) || 0 }));
    if (cats.some((c) => !c.name)) { toast.error("Category names cannot be empty."); return; }
    const names = cats.map((c) => c.name.toLowerCase());
    if (new Set(names).size !== names.length) { toast.error("Category names must be unique within a template."); return; }

    // Assign display_order by position so create/edit persists the on-screen order.
    const categories = cats.map((c, i) => ({ ...c, display_order: i }));
    const payload = {
      name,
      description: form.description || null,
      age_group: form.age_group || null,
      applies_to_positions: form.applies_to_positions,
      categories,
      // Preserve existing metrics on edit; create starts with none.
      metrics: isEdit ? (editing.metrics || []) : [],
      is_default: isEdit ? !!editing.is_default : false,
      // Explicit, not inherited from a spread: the PUT replaces the whole
      // document, so a dropped station_kind silently breaks station-first
      // resolution. This dialog never edits it — it only carries it through.
      station_kind: isEdit ? (editing.station_kind ?? null) : null,
    };
    setBusy(true);
    try {
      if (isEdit) {
        await api.put(`/templates/${editing.id}`, { ...putBody(editing), ...payload });
        toast.success("Template updated.");
      } else {
        await api.post("/templates", payload);
        toast.success("Template created.");
      }
      onOpenChange(false);
      await onSaved();
    } catch (e) {
      // Backend rejects duplicate category names and invalid age bands — surface why.
      toast.error(errMsg(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto rounded-2xl" data-testid="template-editor-dialog">
        <DialogHeader>
          <DialogTitle className="font-display text-2xl text-foreground">{isEdit ? "Edit template" : "New template"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1">
            <Label className="text-xs">Name *</Label>
            <Input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} className="h-10 rounded-lg" data-testid="template-name-input" />
          </div>

          <div className="space-y-1">
            <Label className="text-xs">Description</Label>
            <Textarea value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} className="min-h-[60px] rounded-lg" data-testid="template-desc-input" />
          </div>

          <div className="space-y-1">
            <Label className="text-xs">Age band</Label>
            <Select value={form.age_group || ALL_AGES} onValueChange={(v) => setForm((f) => ({ ...f, age_group: v === ALL_AGES ? "" : v }))}>
              <SelectTrigger className="h-10 rounded-lg" data-testid="template-age-select"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL_AGES}>All ages</SelectItem>
                {ageBands.map((b) => <SelectItem key={b} value={b}>{b}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          {isEdit && (
            <div className="rounded-xl border border-border bg-secondary/40 px-3 py-2.5" data-testid="template-editor-station-kind">
              <PanelLabel>Station kind</PanelLabel>
              <p className="mt-1 text-sm font-semibold capitalize text-foreground">
                {editing.station_kind ? prettyKind(editing.station_kind) : "Not tagged"}
              </p>
              <p className="mt-0.5 text-[11px] text-muted-foreground">
                Carried through this save unchanged — it is set where the station is defined, not here.
              </p>
            </div>
          )}

          <div className="space-y-1">
            <Label className="text-xs">Applies to positions</Label>
            <div className="flex flex-wrap gap-1.5">
              {POSITIONS.map((p) => {
                const on = form.applies_to_positions.includes(p);
                return (
                  <button
                    key={p}
                    type="button"
                    onClick={() => togglePos(p)}
                    className={cn(
                      "h-9 rounded-lg border px-2.5 text-xs font-bold transition-colors",
                      on ? "border-transparent bg-primary text-white" : "border-border bg-card text-muted-foreground hover:border-brand/50 hover:text-foreground"
                    )}
                    data-testid={`template-editor-pos-${p}`}
                  >
                    {p}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <Label className="text-xs">Categories</Label>
              <span
                className={cn(
                  "rounded-full px-2 py-0.5 font-mono-num text-[11px] font-bold",
                  badWeights ? "bg-warning/15 text-warning" : "bg-success/15 text-success"
                )}
                data-testid="template-editor-weight-sum"
              >
                weights {sum}{badWeights ? " ≠ 100" : ""}
              </span>
            </div>
            {badWeights && (
              <p className="flex items-start gap-1 text-xs text-warning" data-testid="template-editor-weight-warning">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <span className="min-w-0">Weights total {sum}, not 100 — saved as relative weights, but a coach expects ~100.</span>
              </p>
            )}
            <div className="space-y-1.5">
              {form.categories.map((c, i) => (
                <div key={i} className="flex min-w-0 items-center gap-2" data-testid={`template-editor-cat-${i}`}>
                  <Input value={c.name} placeholder="Category name" onChange={(e) => setCat(i, { name: e.target.value })} className="h-9 min-w-0 flex-1 rounded-lg" data-testid={`template-editor-cat-name-${i}`} />
                  <Input type="number" value={c.weight} onChange={(e) => setCat(i, { weight: e.target.value })} className="h-9 w-20 shrink-0 rounded-lg text-center font-mono-num" aria-label="Category weight" data-testid={`template-editor-cat-weight-${i}`} />
                  <button type="button" onClick={() => removeCat(i)} className="shrink-0 rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-secondary hover:text-destructive" aria-label="Remove category" data-testid={`template-editor-cat-remove-${i}`}><X className="h-4 w-4" /></button>
                </div>
              ))}
            </div>
            <Button variant="outline" size="sm" className="h-9 rounded-lg text-xs" onClick={addCat} data-testid="template-editor-add-cat">
              <Plus className="mr-1 h-3.5 w-3.5" /> Add category
            </Button>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" className="h-11 rounded-xl" onClick={() => onOpenChange(false)} disabled={busy}>Cancel</Button>
          <Button className="h-11 rounded-xl bg-primary hover:bg-brand-secondary" onClick={save} disabled={busy} data-testid="template-editor-save">
            {isEdit ? "Save changes" : "Create template"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
