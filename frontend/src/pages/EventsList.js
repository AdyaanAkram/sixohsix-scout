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
import { CalendarDays, MapPin, Plus, Users, UserCog, ChevronRight } from "lucide-react";

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
        <Button className="rounded-xl bg-[#0B1E3A] hover:bg-[#102A4F] h-11" data-testid="create-event-button">
          <Plus className="h-4 w-4 mr-1" /> Create Event
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-md rounded-2xl">
        <DialogHeader><DialogTitle className="font-display text-2xl text-[#0B1E3A]">Create Evaluation Event</DialogTitle></DialogHeader>
        <form onSubmit={submit} className="space-y-3">
          <div className="space-y-1">
            <Label className="text-xs">Event name *</Label>
            <Input required value={form.name} onChange={set("name")} className="h-10 rounded-lg" data-testid="event-name-input" placeholder="e.g. Summer Evaluation Camp" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label className="text-xs">Date *</Label>
              <Input type="date" required value={form.date} onChange={set("date")} className="h-10 rounded-lg" data-testid="event-date-input" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Event type</Label>
              <Input value={form.event_type} onChange={set("event_type")} className="h-10 rounded-lg" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Start time</Label>
              <Input type="time" value={form.start_time} onChange={set("start_time")} className="h-10 rounded-lg" />
            </div>
            <div className="space-y-1">
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
            <Button type="submit" disabled={busy} className="w-full h-11 rounded-xl bg-[#0B1E3A] hover:bg-[#102A4F]" data-testid="event-create-submit-button">
              {busy ? "Creating…" : "Create Event"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};

export default function EventsList() {
  const { user } = useAuth();
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const isAdmin = ["owner", "admin"].includes(user?.role);

  const load = () => {
    setLoading(true);
    api.get("/events").then((r) => setEvents(r.data)).finally(() => setLoading(false));
  };
  useEffect(load, []);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-4xl text-[#0B1E3A]">Evaluation Events</h1>
          <p className="text-sm text-slate-500">Organize and run player evaluation days.</p>
        </div>
        {isAdmin && <CreateEventDialog onCreated={load} />}
      </div>

      {loading ? (
        <div className="space-y-2">{[...Array(3)].map((_, i) => <Skeleton key={i} className="h-28 rounded-2xl" />)}</div>
      ) : events.length === 0 ? (
        <EmptyState icon={CalendarDays} title="No events yet" hint={isAdmin ? "Create your first evaluation event to get started." : "You have not been assigned to any events yet."} />
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {events.map((ev) => (
            <Link key={ev.id} to={`/events/${ev.id}`} data-testid={`event-card-${ev.id}`}>
              <Card className="rounded-2xl card-shadow border-[#E7E1D6] hover:shadow-lg transition-shadow h-full">
                <CardContent className="pt-5 pb-5">
                  <div className="flex items-start justify-between gap-2">
                    <p className="font-display text-2xl text-[#0B1E3A] leading-tight">{ev.name}</p>
                    <StatusBadge status={ev.status} />
                  </div>
                  <div className="mt-2 space-y-1 text-sm text-slate-600">
                    <p className="flex items-center gap-1.5"><CalendarDays className="h-4 w-4 text-slate-400" /> {ev.date} {ev.start_time && `· ${ev.start_time}–${ev.end_time}`}</p>
                    {ev.location && <p className="flex items-center gap-1.5"><MapPin className="h-4 w-4 text-slate-400" /> {ev.location}</p>}
                  </div>
                  <div className="mt-3 flex items-center gap-4 text-xs text-slate-500">
                    <span className="inline-flex items-center gap-1"><Users className="h-3.5 w-3.5" /> {ev.player_count} players</span>
                    <span className="inline-flex items-center gap-1"><UserCog className="h-3.5 w-3.5" /> {ev.evaluator_count} evaluators</span>
                    <span className="ml-auto inline-flex items-center gap-0.5 text-[#1F4AA8] font-medium">Open <ChevronRight className="h-3.5 w-3.5" /></span>
                  </div>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
