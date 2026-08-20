import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, errMsg } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { StatusBadge } from "@/components/common/StatusBadge";
import { EmptyState } from "@/components/common/EmptyState";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { CalendarDays, MapPin, Plus, Users, UserCog, ChevronRight } from "lucide-react";

// Chip styling for the canonical lifecycle statuses StatusBadge doesn't know
// yet. Legacy statuses ("Registration Open" etc.) pass through as-is and keep
// StatusBadge's own styling.
const LIFECYCLE_BADGE_CLS = {
  Setup: "bg-[hsl(var(--divider))] text-[hsl(var(--foreground))] border-[hsl(var(--border-strong))]",
  Ready: "bg-[hsl(var(--info)/0.15)] text-info border-[hsl(var(--info)/0.4)]",
  Review: "bg-warning/15 text-warning border-warning/40",
  Published: "bg-success/15 text-success border-success/40",
};

const EVENT_TYPES = [
  "Evaluation",
  "Camp",
  "Clinic",
  "Coaching Clinic",
  "Travel",
  "High School",
  "Middle School",
  "Showcase",
  "Private Lesson Block",
];

// Events store their date as a plain YYYY-MM-DD string. Parsing it with
// new Date(str) would read it as UTC midnight and show the previous day in
// western timezones, so build the local date from the parts instead.
const eventDate = (raw) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(raw || ""));
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  if (Number.isNaN(d.getTime())) return null;
  const opts = { weekday: "short", month: "short", day: "numeric" };
  if (d.getFullYear() !== new Date().getFullYear()) opts.year = "numeric";
  return {
    month: d.toLocaleDateString("en-US", { month: "short" }),
    day: String(Number(m[3])),
    full: d.toLocaleDateString("en-US", opts),
  };
};

const CreateEventDialog = ({ onCreated }) => {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ name: "", event_type: "Evaluation", date: "", start_time: "09:00", end_time: "15:00", location: "", description: "", age_groups: "" });
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      await api.post("/events", {
        ...form,
        age_groups: form.age_groups.split(",").map((s) => s.trim()).filter(Boolean),
        status: "Draft",
      });
      toast.success("Event created.");
      setOpen(false);
      onCreated();
    } catch (err) {
      toast.error(errMsg(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button className="rounded-xl bg-primary hover:bg-brand-secondary h-11" data-testid="create-event-button">
          <Plus className="h-4 w-4 sm:mr-1" /> <span className="hidden sm:inline">Create Event</span>
          <span className="sr-only sm:hidden">Create Event</span>
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-md rounded-2xl">
        <DialogHeader><DialogTitle className="font-display text-2xl text-foreground">Create Evaluation Event</DialogTitle></DialogHeader>
        <form onSubmit={submit} className="space-y-3">
          <div className="space-y-1">
            <Label className="text-xs">Event name *</Label>
            <Input required value={form.name} onChange={set("name")} className="h-10 rounded-lg" data-testid="event-name-input" placeholder="e.g. Summer Evaluation Camp" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="min-w-0 space-y-1">
              <Label className="text-xs">Date *</Label>
              <Input type="date" required value={form.date} onChange={set("date")} className="h-10 rounded-lg" data-testid="event-date-input" />
            </div>
            <div className="min-w-0 space-y-1">
              <Label className="text-xs">Event type</Label>
              <select
                value={form.event_type}
                onChange={set("event_type")}
                className="flex h-10 w-full rounded-lg border border-input bg-background px-3 text-sm"
                data-testid="event-type-select"
              >
                {EVENT_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <div className="min-w-0 space-y-1">
              <Label className="text-xs">Start time</Label>
              <Input type="time" value={form.start_time} onChange={set("start_time")} className="h-10 rounded-lg" />
            </div>
            <div className="min-w-0 space-y-1">
              <Label className="text-xs">End time</Label>
              <Input type="time" value={form.end_time} onChange={set("end_time")} className="h-10 rounded-lg" />
            </div>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Location</Label>
            <Input value={form.location} onChange={set("location")} className="h-10 rounded-lg" data-testid="event-location-input" />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Age groups (comma-separated)</Label>
            <Input value={form.age_groups} onChange={set("age_groups")} placeholder="10U, 12U, 14U" className="h-10 rounded-lg" data-testid="event-age-groups-input" />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Description</Label>
            <Textarea value={form.description} onChange={set("description")} className="rounded-lg" rows={2} />
          </div>
          <DialogFooter>
            <Button type="submit" disabled={busy} className="w-full h-11 rounded-xl bg-primary hover:bg-brand-secondary" data-testid="event-create-submit-button">
              {busy ? "Creating…" : "Create Event"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};

const CountTile = ({ icon: Icon, tint, value, label }) => (
  <span className="inline-flex min-w-0 items-center gap-1.5">
    <span className={cn("h-7 w-7 shrink-0 rounded-lg grid place-items-center", tint)}>
      <Icon className="h-3.5 w-3.5" />
    </span>
    <span className="font-mono-num text-sm font-bold text-foreground">{value ?? 0}</span>
    <span className="hidden truncate text-xs text-muted-foreground sm:inline">{label}</span>
  </span>
);

const EventCard = ({ ev }) => {
  const d = eventDate(ev.date);
  // end_time is optional on older events — never print "09:00–undefined".
  const time = ev.start_time ? [ev.start_time, ev.end_time].filter(Boolean).join("–") : null;

  return (
    <Link to={`/events/${ev.id}`} data-testid={`event-card-${ev.id}`} className="block min-w-0">
      <Card className="h-full rounded-2xl border-border transition-all hover:border-brand/50 hover:-translate-y-0.5">
        <CardContent className="flex h-full flex-col p-4 sm:p-5">
          <div className="flex items-start gap-3">
            {/* Tinted date block — the calendar chip reads before the name does. */}
            <div className="flex h-12 w-12 shrink-0 flex-col items-center justify-center rounded-lg bg-brand/15 text-brand">
              {d ? (
                <>
                  <span className="text-[10px] font-semibold uppercase leading-none tracking-wide">{d.month}</span>
                  <span className="font-mono-num text-lg font-bold leading-none">{d.day}</span>
                </>
              ) : (
                <CalendarDays className="h-5 w-5" />
              )}
            </div>
            <div className="min-w-0 flex-1">
              {/* Names run long ("… Fall Development Series — Session #1"). Clamp
                  to two lines so one event can never stretch the whole card. */}
              <p className="font-display text-lg sm:text-xl leading-tight text-foreground break-words [display:-webkit-box] [-webkit-box-orient:vertical] [-webkit-line-clamp:2] overflow-hidden">
                {ev.name}
              </p>
              <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                <StatusBadge status={ev.status} className={LIFECYCLE_BADGE_CLS[ev.status]} />
                {ev.event_type && (
                  <span className="max-w-full truncate rounded-full bg-secondary px-2 py-0.5 text-[11px] font-semibold text-muted-foreground">
                    {ev.event_type}
                  </span>
                )}
              </div>
            </div>
          </div>

          <div className="mt-3 space-y-1 text-sm text-muted-foreground">
            <p className="flex min-w-0 items-center gap-1.5">
              <CalendarDays className="h-4 w-4 shrink-0" />
              <span className="truncate">{d ? d.full : (ev.date || "Date to be confirmed")}{time ? ` · ${time}` : ""}</span>
            </p>
            {ev.location && (
              <p className="flex min-w-0 items-center gap-1.5">
                <MapPin className="h-4 w-4 shrink-0" />
                <span className="truncate">{ev.location}</span>
              </p>
            )}
          </div>

          <div className="mt-3 flex items-center gap-3 border-t border-border pt-3 sm:gap-4">
            <CountTile icon={Users} tint="bg-info/15 text-info" value={ev.player_count} label="players" />
            <CountTile icon={UserCog} tint="bg-success/15 text-success" value={ev.evaluator_count} label="evaluators" />
            <span className="ml-auto inline-flex shrink-0 items-center gap-0.5 text-xs font-semibold text-info">
              Open <ChevronRight className="h-3.5 w-3.5" />
            </span>
          </div>
        </CardContent>
      </Card>
    </Link>
  );
};

export default function EventsList() {
  const { user } = useAuth();
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const isAdmin = ["owner", "admin"].includes(user?.role);

  const load = () => {
    setLoading(true);
    setFailed(false);
    api.get("/events")
      .then((r) => setEvents(r.data))
      .catch(() => setFailed(true))
      .finally(() => setLoading(false));
  };
  useEffect(() => { load(); }, []);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2.5">
            <h1 className="font-display text-3xl sm:text-4xl text-foreground">Events</h1>
            {!loading && !failed && events.length > 0 && (
              <span className="rounded-full bg-brand/15 px-2.5 py-0.5 text-[11px] font-mono-num font-bold text-brand">
                {events.length}
              </span>
            )}
          </div>
          <p className="text-sm text-muted-foreground mt-1">
            Short-term camps, clinics, and evaluation days for this organization.
          </p>
        </div>
        {isAdmin && <CreateEventDialog onCreated={load} />}
      </div>

      {loading ? (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {[...Array(3)].map((_, i) => <Skeleton key={i} className="h-44 rounded-2xl" />)}
        </div>
      ) : failed ? (
        <EmptyState
          icon={CalendarDays}
          title="Could not load events"
          hint="Something went wrong fetching the schedule. Refresh the page to try again."
        />
      ) : events.length === 0 ? (
        <EmptyState icon={CalendarDays} title="No events yet" hint={isAdmin ? "Create your first evaluation event to get started." : "You have not been assigned to any events yet."} />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3" data-testid="events-grid">
          {events.map((ev) => <EventCard key={ev.id} ev={ev} />)}
        </div>
      )}
    </div>
  );
}
