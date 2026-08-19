import { useCallback, useEffect, useState } from "react";
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
import { Dumbbell, Pencil, Plus } from "lucide-react";

const EMPTY_DRILL = { name: "", category: "defense", description: "", positions: "", video_url: "" };

const ADMIN_ROLES = ["owner", "admin"];

/* Module level so the <Input>s are never remounted mid-typing — an inline
   component definition rebuilds them each keystroke and the field loses focus.
   Shared by the create and the edit dialog so both stay in step. */
const DrillForm = ({ form, onField, idPrefix }) => (
  <div className="space-y-3">
    <div className="space-y-1">
      <Label className="text-xs">Name</Label>
      <Input value={form.name} onChange={(e) => onField("name", e.target.value)} className="h-10 rounded-lg" data-testid={`${idPrefix}-name`} />
    </div>
    <div className="space-y-1">
      <Label className="text-xs">Category</Label>
      <Input value={form.category} onChange={(e) => onField("category", e.target.value)} className="h-10 rounded-lg" data-testid={`${idPrefix}-category`} />
    </div>
    <div className="space-y-1">
      <Label className="text-xs">Positions (comma-separated)</Label>
      <Input value={form.positions} onChange={(e) => onField("positions", e.target.value)} placeholder="SS, HIT" className="h-10 rounded-lg" data-testid={`${idPrefix}-positions`} />
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
        <div>
          <h1 className="font-display text-4xl text-foreground">Drill library</h1>
          <p className="text-sm text-muted-foreground">Position-tagged drills used in development plans.</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" className="rounded-xl h-10" onClick={seedDefaults} data-testid="drills-seed-button">Seed defaults</Button>
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button className="rounded-xl bg-primary h-10" data-testid="drills-add-button"><Plus className="h-4 w-4 mr-1" /> Add drill</Button>
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

      {rows.length === 0 ? (
        <EmptyState icon={Dumbbell} title="No drills yet" hint="Seed the default position library or add your own." />
      ) : (
        <div className="space-y-2">
          {rows.map((d) => (
            <Card key={d.id} className="rounded-2xl border-border">
              <CardContent className="py-3.5 flex flex-wrap items-start gap-3 justify-between">
                <div>
                  <p className="text-sm font-semibold text-foreground">{d.name}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {d.category} · {(d.positions || []).join(", ") || "All positions"}
                  </p>
                  {d.description && <p className="text-xs text-muted-foreground mt-1">{d.description}</p>}
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  {d.video_url && (
                    <a href={d.video_url} target="_blank" rel="noreferrer" className="text-xs text-info hover:underline">Video</a>
                  )}
                  {isAdmin && (
                    <button
                      type="button"
                      onClick={() => openEdit(d)}
                      className="text-muted-foreground hover:text-foreground p-1"
                      title="Edit drill"
                      data-testid={`drill-edit-${d.id}`}
                    >
                      <Pencil className="h-4 w-4" />
                    </button>
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
