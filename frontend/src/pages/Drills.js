import { useCallback, useEffect, useState } from "react";
import { api, errMsg } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/common/EmptyState";
import { toast } from "sonner";
import { Plus, Dumbbell } from "lucide-react";

export default function Drills() {
  const [rows, setRows] = useState(null);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ name: "", category: "defense", description: "", positions: "", video_url: "" });
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    api.get("/drills").then((r) => setRows(r.data)).catch((e) => toast.error(errMsg(e)));
  }, []);
  useEffect(() => { load(); }, [load]);

  const create = async () => {
    setBusy(true);
    try {
      await api.post("/drills", {
        name: form.name.trim(),
        category: form.category,
        description: form.description || null,
        positions: form.positions.split(",").map((s) => s.trim()).filter(Boolean),
        video_url: form.video_url || null,
        metric_tags: [],
        active: true,
      });
      toast.success("Drill added.");
      setOpen(false);
      setForm({ name: "", category: "defense", description: "", positions: "", video_url: "" });
      load();
    } catch (e) { toast.error(errMsg(e)); }
    finally { setBusy(false); }
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
              <div className="space-y-3">
                <div className="space-y-1"><Label className="text-xs">Name</Label><Input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} className="h-10 rounded-lg" /></div>
                <div className="space-y-1"><Label className="text-xs">Category</Label><Input value={form.category} onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))} className="h-10 rounded-lg" /></div>
                <div className="space-y-1"><Label className="text-xs">Positions (comma-separated)</Label><Input value={form.positions} onChange={(e) => setForm((f) => ({ ...f, positions: e.target.value }))} placeholder="SS, HIT" className="h-10 rounded-lg" /></div>
                <div className="space-y-1"><Label className="text-xs">Description</Label><Input value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} className="h-10 rounded-lg" /></div>
                <div className="space-y-1"><Label className="text-xs">Video URL</Label><Input value={form.video_url} onChange={(e) => setForm((f) => ({ ...f, video_url: e.target.value }))} className="h-10 rounded-lg" /></div>
              </div>
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
                {d.video_url && (
                  <a href={d.video_url} target="_blank" rel="noreferrer" className="text-xs text-info hover:underline">Video</a>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
