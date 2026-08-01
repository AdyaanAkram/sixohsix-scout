import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, errMsg } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/common/EmptyState";
import { toast } from "sonner";
import { Plus, CalendarRange } from "lucide-react";

const TYPES = [
  { value: "camp", label: "Camp" },
  { value: "clinic", label: "Clinic" },
  { value: "training_block", label: "Training block" },
  { value: "coaching_clinic", label: "Coaching clinic" },
];

export default function Programs() {
  const [rows, setRows] = useState(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({
    name: "", type: "camp", start_date: "", end_date: "", capacity: "", description: "", status: "open",
  });

  const load = useCallback(() => {
    api.get("/programs").then((r) => setRows(r.data)).catch((e) => toast.error(errMsg(e)));
  }, []);
  useEffect(() => { load(); }, [load]);

  const create = async () => {
    setBusy(true);
    try {
      await api.post("/programs", {
        name: form.name.trim(),
        type: form.type,
        start_date: form.start_date || null,
        end_date: form.end_date || null,
        capacity: form.capacity ? parseInt(form.capacity, 10) : null,
        description: form.description || null,
        status: form.status,
      });
      toast.success("Program created.");
      setOpen(false);
      setForm({ name: "", type: "camp", start_date: "", end_date: "", capacity: "", description: "", status: "open" });
      load();
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setBusy(false);
    }
  };

  if (!rows) {
    return <div className="space-y-2">{[...Array(4)].map((_, i) => <Skeleton key={i} className="h-20 rounded-2xl" />)}</div>;
  }

  return (
    <div className="space-y-4" data-testid="programs-page">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-4xl text-foreground">Programs</h1>
          <p className="text-sm text-muted-foreground">Camps, clinics, and training blocks — the year-round chassis.</p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button className="rounded-xl bg-brand hover:bg-brand-secondary h-11" data-testid="program-create-button">
              <Plus className="h-4 w-4 mr-1" /> New program
            </Button>
          </DialogTrigger>
          <DialogContent className="rounded-2xl max-w-md">
            <DialogHeader><DialogTitle className="font-display text-2xl">Create program</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <div className="space-y-1"><Label className="text-xs">Name *</Label>
                <Input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} className="h-10 rounded-lg" data-testid="program-name-input" />
              </div>
              <div className="space-y-1"><Label className="text-xs">Type</Label>
                <Select value={form.type} onValueChange={(v) => setForm((f) => ({ ...f, type: v }))}>
                  <SelectTrigger className="h-10 rounded-lg"><SelectValue /></SelectTrigger>
                  <SelectContent>{TYPES.map((t) => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1"><Label className="text-xs">Start</Label>
                  <Input type="date" value={form.start_date} onChange={(e) => setForm((f) => ({ ...f, start_date: e.target.value }))} className="h-10 rounded-lg" />
                </div>
                <div className="space-y-1"><Label className="text-xs">End</Label>
                  <Input type="date" value={form.end_date} onChange={(e) => setForm((f) => ({ ...f, end_date: e.target.value }))} className="h-10 rounded-lg" />
                </div>
              </div>
              <div className="space-y-1"><Label className="text-xs">Capacity</Label>
                <Input type="number" min={1} value={form.capacity} onChange={(e) => setForm((f) => ({ ...f, capacity: e.target.value }))} className="h-10 rounded-lg" placeholder="Optional" />
              </div>
            </div>
            <DialogFooter>
              <Button className="w-full rounded-xl bg-brand h-11" disabled={busy || !form.name.trim()} onClick={create} data-testid="program-submit-button">
                {busy ? "Creating…" : "Create"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {rows.length === 0 ? (
        <EmptyState
          icon={CalendarRange}
          title="No programs yet"
          hint="Create a camp or clinic to enroll athletes across multiple sessions — this is how you show growth over time."
        />
      ) : (
        <div className="space-y-2">
          {rows.map((p) => (
            <Card key={p.id} className="rounded-2xl border-border bg-card">
              <CardContent className="py-4 flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="font-semibold text-foreground">{p.name}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {TYPES.find((t) => t.value === p.type)?.label || p.type}
                    {p.start_date ? ` · ${p.start_date}` : ""}
                    {p.end_date ? ` → ${p.end_date}` : ""}
                    {p.capacity ? ` · cap ${p.capacity}` : ""}
                    {` · ${p.status}`}
                  </p>
                </div>
                <Button asChild variant="outline" className="rounded-xl h-9">
                  <Link to={`/programs/${p.id}`} data-testid={`program-open-${p.id}`}>Open</Link>
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
