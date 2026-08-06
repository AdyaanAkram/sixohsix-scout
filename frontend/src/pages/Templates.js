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
import { FileSpreadsheet, ChevronDown, ChevronUp, AlertTriangle, Star, Plus, Pencil, Trash2, ArrowUp, ArrowDown, X } from "lucide-react";
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
// the caller isn't explicitly changing (metrics especially).
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
  ...overrides,
});

export default function Templates() {
  const { user } = useAuth();
  const canEdit = ["owner", "admin"].includes(user?.role);
  const [templates, setTemplates] = useState(null);
  const [ageBands, setAgeBands] = useState([]);
  const [expanded, setExpanded] = useState({});
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

  const positionConflicts = useMemo(() => {
    const claimed = {};
    for (const t of templates || []) {
      for (const p of t.applies_to_positions || []) {
        claimed[p] = claimed[p] || [];
        claimed[p].push(t.name);
      }
    }
    return Object.entries(claimed).filter(([, names]) => names.length > 1);
  }, [templates]);

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
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="font-display text-4xl text-foreground">Evaluation Templates</h1>
          <p className="text-sm text-muted-foreground">Metric sets resolved by athlete position, then station, then org default.</p>
        </div>
        {canEdit && (
          <Button className="rounded-lg h-9 shrink-0" onClick={openCreate} data-testid="template-create-btn">
            <Plus className="h-4 w-4 mr-1" /> New template
          </Button>
        )}
      </div>

      {positionConflicts.length > 0 && (
        <div className="rounded-xl bg-warning/15 border border-warning/40 px-4 py-3 text-sm text-warning flex items-start gap-2" data-testid="position-conflict-warning">
          <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
          <div>
            <p className="font-semibold">Overlapping position claims</p>
            <ul className="mt-1 space-y-0.5">
              {positionConflicts.map(([pos, names]) => (
                <li key={pos}><span className="font-mono font-bold">{pos}</span>: {names.join(" · ")}</li>
              ))}
            </ul>
          </div>
        </div>
      )}

      {templates.length === 0 ? (
        <EmptyState icon={FileSpreadsheet} title="No templates" hint="Templates define the metrics evaluators score at each station." />
      ) : (
        <div className="space-y-2">
          {templates.map((t) => {
            const cats = [...(t.categories || [])].sort((a, b) => (a.display_order || 0) - (b.display_order || 0));
            const mets = [...(t.metrics || [])].sort((a, b) => (a.display_order || 0) - (b.display_order || 0));
            const badWeights = cats.length > 0 && !weightsOk(cats);
            return (
            <Card key={t.id} className="rounded-2xl border-border">
              <CardContent className="py-4">
                <button className="w-full text-left flex items-center justify-between gap-2" onClick={() => setExpanded((x) => ({ ...x, [t.id]: !x[t.id] }))} data-testid={`template-toggle-${t.id}`}>
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-semibold text-foreground">{t.name}</p>
                      {t.is_default && (
                        <span className="inline-flex items-center gap-1 rounded-full bg-warning/15 border border-warning/40 text-warning px-2 py-0.5 text-[10px] font-bold uppercase" data-testid={`template-default-${t.id}`}>
                          <Star className="h-3 w-3" /> Org default
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {t.age_group || "All ages"} · {(t.metrics || []).length} metrics · {cats.length} categories
                      {(t.applies_to_positions || []).length > 0
                        ? ` · positions ${(t.applies_to_positions || []).join(", ")}`
                        : " · universal / station fallback"}
                      {t.template_version ? ` · v${t.template_version}` : ""}
                    </p>
                  </div>
                  {expanded[t.id] ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
                </button>
                {expanded[t.id] && (
                  <div className="mt-3 border-t pt-3 space-y-4">
                    {canEdit && (
                      <div className="flex flex-wrap gap-2">
                        <Button variant="outline" size="sm" className="rounded-lg h-8 text-xs" disabled={savingId === t.id} onClick={() => openEdit(t)} data-testid={`template-edit-${t.id}`}>
                          <Pencil className="h-3.5 w-3.5 mr-1" /> Edit template
                        </Button>
                        {!t.is_default && (
                          <Button variant="outline" size="sm" className="rounded-lg h-8 text-xs" disabled={savingId === t.id} onClick={() => setDefault(t)} data-testid={`template-set-default-${t.id}`}>
                            Set as org default
                          </Button>
                        )}
                        <Button variant="outline" size="sm" className="rounded-lg h-8 text-xs text-destructive hover:text-destructive" disabled={savingId === t.id} onClick={() => setDeleteTarget(t)} data-testid={`template-delete-${t.id}`}>
                          <Trash2 className="h-3.5 w-3.5 mr-1" /> Delete
                        </Button>
                      </div>
                    )}

                    <div>
                      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Applies to positions</p>
                      <div className="flex flex-wrap gap-1.5">
                        {POSITIONS.map((p) => {
                          const on = (t.applies_to_positions || []).includes(p);
                          return (
                            <button
                              key={p}
                              type="button"
                              disabled={!canEdit || savingId === t.id}
                              onClick={() => togglePosition(t, p)}
                              className={cn(
                                "rounded-lg border px-2.5 h-8 text-xs font-bold transition",
                                on ? "bg-primary text-white border-transparent" : "bg-card text-muted-foreground hover:bg-secondary"
                              )}
                              data-testid={`template-pos-${t.id}-${p}`}
                            >
                              {p}
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    {cats.length > 0 && (
                      <div>
                        <div className="flex items-center justify-between gap-2 mb-2">
                          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Categories</p>
                          <span className={cn("text-xs font-semibold", badWeights ? "text-warning" : "text-muted-foreground")} data-testid={`template-weight-sum-${t.id}`}>
                            weights {weightSum(cats)}{badWeights ? " ≠ 100" : ""}
                          </span>
                        </div>
                        {badWeights && (
                          <p className="text-xs text-warning flex items-center gap-1 mb-2" data-testid={`template-weight-warning-${t.id}`}>
                            <AlertTriangle className="h-3.5 w-3.5" /> Category weights total {weightSum(cats)}, not 100. They are used as relative weights, but a coach expects ~100.
                          </p>
                        )}
                        <div className="space-y-1">
                          {cats.map((c, i) => (
                            <div key={c.name} className="flex items-center justify-between gap-2 rounded-lg bg-secondary/40 px-2.5 py-1.5 text-sm" data-testid={`template-cat-row-${t.id}-${c.name}`}>
                              <span className="font-medium text-foreground truncate">{c.name}</span>
                              <div className="flex items-center gap-2 shrink-0">
                                <span className="text-xs text-muted-foreground">weight {c.weight}</span>
                                {canEdit && (
                                  <div className="flex items-center">
                                    <button type="button" disabled={i === 0 || savingId === t.id} onClick={() => move(t, "category", i, -1)} className="p-1 disabled:opacity-30 hover:text-primary" data-testid={`template-cat-up-${t.id}-${c.name}`}><ArrowUp className="h-3.5 w-3.5" /></button>
                                    <button type="button" disabled={i === cats.length - 1 || savingId === t.id} onClick={() => move(t, "category", i, 1)} className="p-1 disabled:opacity-30 hover:text-primary" data-testid={`template-cat-down-${t.id}-${c.name}`}><ArrowDown className="h-3.5 w-3.5" /></button>
                                  </div>
                                )}
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {mets.length > 0 && (
                      <div>
                        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Metrics</p>
                        <div className="space-y-1">
                          {mets.map((m, i) => (
                            <div key={m.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg px-2.5 py-1.5 text-sm hover:bg-secondary/40" data-testid={`template-metric-row-${t.id}-${m.id}`}>
                              <span className="font-medium text-foreground">
                                {m.name} {m.required && <span className="text-destructive">*</span>}
                              </span>
                              <div className="flex items-center gap-2">
                                <span className="text-xs text-muted-foreground">
                                  {m.category} · {TYPE_LABELS[m.metric_type]} {m.unit && `(${m.unit})`} · weight {m.weight}
                                  {["time"].includes(m.metric_type) || m.higher_is_better === false ? " · lower is better" : ""}
                                </span>
                                {canEdit && (
                                  <div className="flex items-center shrink-0">
                                    <button type="button" disabled={i === 0 || savingId === t.id} onClick={() => move(t, "metric", i, -1)} className="p-1 disabled:opacity-30 hover:text-primary" data-testid={`template-metric-up-${t.id}-${m.id}`}><ArrowUp className="h-3.5 w-3.5" /></button>
                                    <button type="button" disabled={i === mets.length - 1 || savingId === t.id} onClick={() => move(t, "metric", i, 1)} className="p-1 disabled:opacity-30 hover:text-primary" data-testid={`template-metric-down-${t.id}-${m.id}`}><ArrowDown className="h-3.5 w-3.5" /></button>
                                  </div>
                                )}
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
          );})}
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
              "{deleteTarget?.name}" and its {(deleteTarget?.metrics || []).length} metrics will be permanently removed. This cannot be undone.
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
      <DialogContent className="rounded-2xl max-w-lg max-h-[90vh] overflow-y-auto" data-testid="template-editor-dialog">
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
            <Textarea value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} className="rounded-lg min-h-[60px]" data-testid="template-desc-input" />
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
                    className={cn("rounded-lg border px-2.5 h-8 text-xs font-bold transition", on ? "bg-primary text-white border-transparent" : "bg-card text-muted-foreground hover:bg-secondary")}
                    data-testid={`template-editor-pos-${p}`}
                  >
                    {p}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label className="text-xs">Categories</Label>
              <span className={cn("text-xs font-semibold", badWeights ? "text-warning" : "text-muted-foreground")} data-testid="template-editor-weight-sum">
                weights {sum}{badWeights ? " ≠ 100" : ""}
              </span>
            </div>
            {badWeights && (
              <p className="text-xs text-warning flex items-center gap-1" data-testid="template-editor-weight-warning">
                <AlertTriangle className="h-3.5 w-3.5" /> Weights total {sum}, not 100 — saved as relative weights, but a coach expects ~100.
              </p>
            )}
            <div className="space-y-1.5">
              {form.categories.map((c, i) => (
                <div key={i} className="flex items-center gap-2" data-testid={`template-editor-cat-${i}`}>
                  <Input value={c.name} placeholder="Category name" onChange={(e) => setCat(i, { name: e.target.value })} className="h-9 rounded-lg flex-1" data-testid={`template-editor-cat-name-${i}`} />
                  <Input type="number" value={c.weight} onChange={(e) => setCat(i, { weight: e.target.value })} className="h-9 rounded-lg w-20" data-testid={`template-editor-cat-weight-${i}`} />
                  <button type="button" onClick={() => removeCat(i)} className="p-1.5 text-muted-foreground hover:text-destructive" data-testid={`template-editor-cat-remove-${i}`}><X className="h-4 w-4" /></button>
                </div>
              ))}
            </div>
            <Button variant="outline" size="sm" className="rounded-lg h-8 text-xs" onClick={addCat} data-testid="template-editor-add-cat">
              <Plus className="h-3.5 w-3.5 mr-1" /> Add category
            </Button>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" className="rounded-lg" onClick={() => onOpenChange(false)} disabled={busy}>Cancel</Button>
          <Button className="rounded-lg" onClick={save} disabled={busy} data-testid="template-editor-save">{isEdit ? "Save changes" : "Create template"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
