import { useCallback, useEffect, useMemo, useState } from "react";
import { api, errMsg } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/common/EmptyState";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Dumbbell, Layers, Pencil, PlayCircle, Plus, Sparkles } from "lucide-react";

const EMPTY_DRILL = { name: "", category: "defense", description: "", positions: "", video_url: "" };

const ADMIN_ROLES = ["owner", "admin"];

const PanelLabel = ({ children }) => (
  <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">{children}</p>
);

/* Category tints are theme tokens only — the icon square carries the colour so
   the card itself stays neutral and the grid reads as one library. */
const CATEGORY_TINTS = {
  defense: "bg-info/15 text-info",
  fielding: "bg-info/15 text-info",
  hitting: "bg-brand/15 text-brand",
  pitching: "bg-warning/15 text-warning",
  catching: "bg-warning/15 text-warning",
  throwing: "bg-brand/15 text-brand",
  speed: "bg-success/15 text-success",
  baserunning: "bg-success/15 text-success",
  strength: "bg-success/15 text-success",
  conditioning: "bg-success/15 text-success",
};
const tintFor = (category) => CATEGORY_TINTS[(category || "").trim().toLowerCase()] || "bg-secondary text-muted-foreground";

/* Module level so the <Input>s are never remounted mid-typing — an inline
   component definition rebuilds them each keystroke and the field loses focus.
   Shared by the create and the edit dialog so both stay in step. */
const DrillForm = ({ form, onField, idPrefix }) => (
  <div className="space-y-3">
    <div className="space-y-1">
      <Label className="text-xs">Name</Label>
      <Input value={form.name} onChange={(e) => onField("name", e.target.value)} className="h-10 rounded-lg" data-testid={`${idPrefix}-name`} />
    </div>
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      <div className="min-w-0 space-y-1">
        <Label className="text-xs">Category</Label>
        <Input value={form.category} onChange={(e) => onField("category", e.target.value)} className="h-10 rounded-lg" data-testid={`${idPrefix}-category`} />
      </div>
      <div className="min-w-0 space-y-1">
        <Label className="text-xs">Positions (comma-separated)</Label>
        <Input value={form.positions} onChange={(e) => onField("positions", e.target.value)} placeholder="SS, HIT" className="h-10 rounded-lg" data-testid={`${idPrefix}-positions`} />
      </div>
    </div>
    <div className="space-y-1">
      <Label className="text-xs">Description</Label>
      <Input value={form.description} onChange={(e) => onField("description", e.target.value)} className="h-10 rounded-lg" data-testid={`${idPrefix}-description`} />
    </div>
    <div className="space-y-1">
      <Label className="text-xs">Video URL</Label>
      <Input value={form.video_url} onChange={(e) => onField("video_url", e.target.value)} className="h-10 rounded-lg" data-testid={`${idPrefix}-video_url`} />
    </div>
  </div>
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

const toPositions = (s) => s.split(",").map((x) => x.trim()).filter(Boolean);

export default function Drills() {
  const { user } = useAuth();
  const [rows, setRows] = useState(null);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(EMPTY_DRILL);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(null);
  const [editForm, setEditForm] = useState(EMPTY_DRILL);
  const [editBusy, setEditBusy] = useState(false);

  const load = useCallback(() => {
    api.get("/drills").then((r) => setRows(r.data)).catch((e) => { toast.error(errMsg(e)); setRows([]); });
  }, []);
  useEffect(() => { load(); }, [load]);

  const onField = useCallback((field, value) => setForm((f) => ({ ...f, [field]: value })), []);
  const onEditField = useCallback((field, value) => setEditForm((f) => ({ ...f, [field]: value })), []);

  // Every hook stays above the loading early return below.
  const stats = useMemo(() => {
    const list = rows || [];
    const categories = new Set(list.map((d) => (d.category || "general").trim().toLowerCase()).filter(Boolean));
    return {
      total: list.length,
      categories: categories.size,
      withVideo: list.filter((d) => d.video_url).length,
    };
  }, [rows]);

  const isAdmin = ADMIN_ROLES.includes(user?.role);

  const create = async () => {
    setBusy(true);
    try {
      await api.post("/drills", {
        name: form.name.trim(),
        category: form.category,
        description: form.description || null,
        positions: toPositions(form.positions),
        video_url: form.video_url || null,
        metric_tags: [],
        active: true,
      });
      toast.success("Drill added.");
      setOpen(false);
      setForm(EMPTY_DRILL);
      load();
    } catch (e) { toast.error(errMsg(e)); }
    finally { setBusy(false); }
  };

  const openEdit = (d) => {
    setEditing(d);
    setEditForm({
      name: d.name || "",
      category: d.category || "general",
      description: d.description || "",
      positions: (d.positions || []).join(", "),
      video_url: d.video_url || "",
    });
  };

  // PATCH /drills/{id} takes the full DrillBody and $sets every field, so this
  // must send the whole document — metric_tags and active come from the saved
  // drill or editing a name would silently wipe them.
  const saveEdit = async () => {
    if (!editing) return;
    setEditBusy(true);
    try {
      await api.patch(`/drills/${editing.id}`, {
        name: editForm.name.trim(),
        category: editForm.category.trim() || "general",
        description: editForm.description || null,
        positions: toPositions(editForm.positions),
        video_url: editForm.video_url || null,
        metric_tags: editing.metric_tags || [],
        active: editing.active !== false,
      });
      toast.success("Drill updated.");
      setEditing(null);
      load();
    } catch (e) { toast.error(errMsg(e)); }
    finally { setEditBusy(false); }
  };

  const seedDefaults = async () => {
    try {
      const r = await api.post("/drills/seed-defaults");
      toast.success(`Library ready (${r.data.total} drills).`);
      load();
    } catch (e) { toast.error(errMsg(e)); }
  };

  if (!rows) return <div className="space-y-2">{[...Array(4)].map((_, i) => <Skeleton key={i} className="h-16 rounded-2xl" />)}</div>;

  return (
    <div className="space-y-4" data-testid="drills-page">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h1 className="font-display text-3xl sm:text-4xl text-foreground">Drill library</h1>
          <p className="text-sm text-muted-foreground">Position-tagged drills used in development plans.</p>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            className="h-10 w-10 rounded-xl p-0 sm:h-11 sm:w-auto sm:px-4"
            onClick={seedDefaults}
            data-testid="drills-seed-button"
          >
            <Sparkles className="h-4 w-4 sm:mr-1.5" />
            <span className="hidden sm:inline">Seed defaults</span>
            <span className="sr-only sm:hidden">Seed defaults</span>
          </Button>
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button className="h-10 rounded-xl bg-primary hover:bg-brand-secondary sm:h-11" data-testid="drills-add-button">
                <Plus className="h-4 w-4 sm:mr-1" />
                <span className="hidden sm:inline">Add drill</span>
                <span className="ml-1 sm:hidden">Add</span>
              </Button>
            </DialogTrigger>
            <DialogContent className="rounded-2xl">
              <DialogHeader><DialogTitle className="font-display text-2xl">New drill</DialogTitle></DialogHeader>
              <DrillForm form={form} onField={onField} idPrefix="drill-create" />
              <DialogFooter>
                <Button className="w-full rounded-xl bg-primary h-11" disabled={busy || !form.name.trim()} onClick={create}>Save</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {rows.length > 0 && (
        <Card className="rounded-2xl border-border bg-card" data-testid="drills-stat-row">
          <CardContent className="pt-4 pb-4">
            <PanelLabel>Library at a glance</PanelLabel>
            <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
              <StatTile
                icon={Dumbbell}
                tint="bg-brand/15 text-brand"
                value={stats.total}
                label={stats.total === 1 ? "Drill" : "Drills"}
                sub="In the library"
                testId="drills-stat-total"
              />
              <StatTile
                icon={Layers}
                tint="bg-info/15 text-info"
                value={stats.categories}
                label={stats.categories === 1 ? "Category" : "Categories"}
                sub="Across the library"
                testId="drills-stat-categories"
              />
              <StatTile
                icon={PlayCircle}
                tint="bg-success/15 text-success"
                value={stats.withVideo}
                label="With video"
                sub={stats.withVideo === stats.total ? "Every drill has a clip" : `${stats.total - stats.withVideo} still need a clip`}
                testId="drills-stat-video"
              />
            </div>
          </CardContent>
        </Card>
      )}

      {rows.length === 0 ? (
        <EmptyState icon={Dumbbell} title="No drills yet" hint="Seed the default position library or add your own." />
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3" data-testid="drills-card-grid">
          {rows.map((d) => (
            <Card
              key={d.id}
              className="h-full min-w-0 rounded-2xl border-border bg-card transition-all hover:border-brand/50 hover:shadow-lg hover:-translate-y-0.5"
              data-testid={`drills-card-${d.id}`}
            >
              <CardContent className="flex h-full flex-col gap-3 pt-4 pb-4">
                <div className="flex items-start gap-3">
                  <div className={cn("h-10 w-10 shrink-0 rounded-lg grid place-items-center", tintFor(d.category))}>
                    <Dumbbell className="h-5 w-5" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold leading-snug text-foreground">{d.name}</p>
                    <p className="mt-0.5 text-xs capitalize text-muted-foreground">{d.category || "General"}</p>
                  </div>
                  {isAdmin && (
                    <button
                      type="button"
                      onClick={() => openEdit(d)}
                      className="-mr-1 -mt-1 shrink-0 rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
                      title="Edit drill"
                      data-testid={`drill-edit-${d.id}`}
                    >
                      <Pencil className="h-4 w-4" />
                    </button>
                  )}
                </div>

                {d.description && (
                  <p className="min-w-0 text-xs leading-relaxed text-muted-foreground">{d.description}</p>
                )}

                <div className="mt-auto flex flex-wrap items-center gap-1.5">
                  {(d.positions || []).length > 0 ? (
                    (d.positions || []).map((p) => (
                      <span
                        key={p}
                        className="inline-flex items-center whitespace-nowrap rounded-full bg-secondary px-2 py-0.5 text-[11px] font-bold text-foreground"
                      >
                        {p}
                      </span>
                    ))
                  ) : (
                    <span className="inline-flex items-center whitespace-nowrap rounded-full bg-secondary px-2 py-0.5 text-[11px] font-semibold text-muted-foreground">
                      All positions
                    </span>
                  )}
                  <span className="flex-1" />
                  {d.video_url && (
                    <a
                      href={d.video_url}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex shrink-0 items-center gap-1 text-xs font-semibold text-info hover:underline"
                      data-testid={`drill-video-${d.id}`}
                    >
                      <PlayCircle className="h-3.5 w-3.5" /> Video
                    </a>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={!!editing} onOpenChange={(v) => { if (!v) setEditing(null); }}>
        <DialogContent className="rounded-2xl" data-testid="drill-edit-dialog">
          <DialogHeader><DialogTitle className="font-display text-2xl">Edit drill</DialogTitle></DialogHeader>
          <DrillForm form={editForm} onField={onEditField} idPrefix="drill-edit-field" />
          <DialogFooter>
            <Button
              className="w-full rounded-xl bg-primary h-11"
              disabled={editBusy || !editForm.name.trim()}
              onClick={saveEdit}
              data-testid="drill-edit-save"
            >
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
