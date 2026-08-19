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
import { ArrowRight, CalendarRange, ClipboardList, Dumbbell, GraduationCap, Plus, Tent, Users } from "lucide-react";
import { cn } from "@/lib/utils";

const TYPES = [
  { value: "camp", label: "Camp", icon: Tent, tint: "bg-brand/15 text-brand" },
  { value: "clinic", label: "Clinic", icon: ClipboardList, tint: "bg-info/15 text-info" },
  { value: "training_block", label: "Training block", icon: Dumbbell, tint: "bg-success/15 text-success" },
  { value: "coaching_clinic", label: "Coaching clinic", icon: GraduationCap, tint: "bg-warning/15 text-warning" },
];

const STATUS_TINT = {
  open: "bg-success/15 text-success",
  active: "bg-success/15 text-success",
  full: "bg-warning/15 text-warning",
  closed: "bg-secondary text-muted-foreground",
  completed: "bg-secondary text-muted-foreground",
  cancelled: "bg-destructive/15 text-destructive",
};

const fmtPrice = (cents) => {
  const dollars = (cents || 0) / 100;
  return `$${Number.isInteger(dollars) ? dollars : dollars.toFixed(2)}`;
};

const dateRange = (start, end) => {
  if (!start && !end) return null;
  if (start && end) return `${start} – ${end}`;
  return start || end;
};

/* One chip of program metadata. Only rendered when the payload actually has
   the field — nothing here is invented. */
const Chip = ({ children }) => (
  <span className="rounded-full bg-secondary px-2 py-0.5 text-[11px] font-semibold text-muted-foreground whitespace-nowrap">
    {children}
  </span>
);

export default function Programs() {
  const [rows, setRows] = useState(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({
    name: "", type: "camp", start_date: "", end_date: "", capacity: "", description: "", status: "open",
  });

  const load = useCallback(() => {
    api.get("/programs").then((r) => setRows(r.data)).catch(() => setRows([])).catch((e) => toast.error(errMsg(e)));
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
          <p className="text-sm text-muted-foreground">
            Long-term training for this organization — seasons, blocks, and ongoing development (not one-day camps).
          </p>
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
        <div className="grid gap-3 sm:grid-cols-2">
          {rows.map((p) => {
            const type = TYPES.find((t) => t.value === p.type);
            const Icon = type?.icon || CalendarRange;
            const range = dateRange(p.start_date, p.end_date);
            const ages = Array.isArray(p.age_groups) ? p.age_groups.filter(Boolean) : [];
            return (
              <Link key={p.id} to={`/programs/${p.id}`} className="block h-full min-w-0" data-testid={`program-open-${p.id}`}>
                <Card className="h-full rounded-2xl border-border bg-card transition-all hover:border-brand/50 hover:shadow-lg hover:-translate-y-0.5">
                  <CardContent className="pt-4 pb-4">
                    <div className="flex items-start gap-3">
                      <span className={cn("h-10 w-10 rounded-lg grid place-items-center shrink-0", type?.tint || "bg-secondary text-muted-foreground")}>
                        <Icon className="h-5 w-5" />
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="font-display text-lg leading-tight text-foreground truncate">{p.name}</p>
                        <p className="text-xs text-muted-foreground mt-0.5 truncate">
                          {type?.label || p.type} · {p.status}
                        </p>
                      </div>
                      <span className="inline-flex items-center gap-1 text-xs font-semibold text-brand shrink-0">
                        Open <ArrowRight className="h-3.5 w-3.5" />
                      </span>
                    </div>

                    {p.description && (
                      <p className="mt-2.5 text-xs text-muted-foreground line-clamp-2">{p.description}</p>
                    )}

                    <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
                      {p.status && (
                        <span className={cn(
                          "rounded-full px-2 py-0.5 text-[11px] font-semibold whitespace-nowrap",
                          STATUS_TINT[p.status] || "bg-secondary text-muted-foreground"
                        )}>
                          {p.status}
                        </span>
                      )}
                      {range && <Chip><span className="font-mono-num">{range}</span></Chip>}
                      {p.price_cents ? <Chip><span className="font-mono-num">{fmtPrice(p.price_cents)}</span></Chip> : null}
                      {p.capacity ? (
                        <Chip>
                          <span className="inline-flex items-center gap-1">
                            <Users className="h-3 w-3" /> <span className="font-mono-num">{p.capacity}</span> cap
                          </span>
                        </Chip>
                      ) : null}
                      {ages.length > 0 && <Chip>{ages.join(" · ")}</Chip>}
                    </div>
                  </CardContent>
                </Card>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
