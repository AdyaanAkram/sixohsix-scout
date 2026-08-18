import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { api, errMsg, signedUrl } from "@/lib/api";
import { cn } from "@/lib/utils";
import { useAuth } from "@/context/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { PlayerAvatar, resolvePhotoSrc } from "@/components/common/PlayerAvatar";
import { StatusBadge } from "@/components/common/StatusBadge";
import { EmptyState } from "@/components/common/EmptyState";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import {
  Search, Plus, Upload, FileDown, Users, ChevronRight, LayoutGrid, List,
  SlidersHorizontal, Eye, TrendingUp, TrendingDown, Minus, ArrowRight,
  UserSearch, UserCheck, ClipboardCheck, AlertTriangle, BarChart3, Star,
  CalendarPlus,
} from "lucide-react";

const AGE_GROUPS = ["8U", "9U", "10U", "11U", "12U", "13U", "14U", "15U", "16U", "17U", "18U"];
const POSITIONS = ["P", "C", "1B", "2B", "3B", "SS", "LF", "CF", "RF"];
const VIEW_STORAGE_KEY = "606_players_view";

const EMPTY_FORM = {
  first_name: "", last_name: "", preferred_name: "", date_of_birth: "", graduation_year: "",
  primary_position: "", bats: "", throws: "", height: "", weight: "", jersey_number: "",
  current_team: "", school: "", city: "", state: "", country: "USA",
  guardian_name: "", guardian_email: "", guardian_phone: "", emergency_contact: "",
};

// Defined at module level ON PURPOSE: an inline component inside AddPlayerDialog
// gets a new identity every render, so React remounts the <Input> on each
// keystroke and the field loses focus after every character typed.
const F = ({ label, k, type = "text", placeholder, value, onChange }) => (
  <div className="space-y-1">
    <Label className="text-xs">{label}</Label>
    <Input type={type} value={value} onChange={onChange} placeholder={placeholder} className="h-10 rounded-lg" data-testid={`add-player-${k.replace(/_/g, "-")}-input`} />
  </div>
);

const AddPlayerDialog = ({ onCreated }) => {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e?.target ? e.target.value : e }));

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      const payload = { ...form, graduation_year: form.graduation_year ? parseInt(form.graduation_year) : null, secondary_positions: [] };
      Object.keys(payload).forEach((k) => { if (payload[k] === "") payload[k] = null; });
      await api.post("/athletes", payload);
      toast.success("Athlete added.");
      setOpen(false);
      setForm(EMPTY_FORM);
      onCreated();
    } catch (err) {
      toast.error(errMsg(err));
    } finally {
      setBusy(false);
    }
  };

  const field = (props) => <F {...props} value={form[props.k]} onChange={set(props.k)} />;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button className="rounded-xl bg-primary hover:bg-brand-secondary h-11" data-testid="add-player-button">
          <Plus className="h-4 w-4 mr-1" /> Add Athlete
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto rounded-2xl">
        <DialogHeader><DialogTitle className="font-display text-2xl text-foreground">Add Athlete</DialogTitle></DialogHeader>
        <form onSubmit={submit} className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            {field({ label: "First name *", k: "first_name" })}
            {field({ label: "Last name *", k: "last_name" })}
            {field({ label: "Preferred name", k: "preferred_name" })}
            {field({ label: "Date of birth", k: "date_of_birth", type: "date" })}
            {field({ label: "Graduation year", k: "graduation_year", type: "number" })}
            <div className="space-y-1">
              <Label className="text-xs">Primary position</Label>
              <Select value={form.primary_position || undefined} onValueChange={set("primary_position")}>
                <SelectTrigger className="h-10 rounded-lg" data-testid="add-player-position-select"><SelectValue placeholder="Select" /></SelectTrigger>
                <SelectContent>{POSITIONS.map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Bats</Label>
              <Select value={form.bats || undefined} onValueChange={set("bats")}>
                <SelectTrigger className="h-10 rounded-lg"><SelectValue placeholder="Select" /></SelectTrigger>
                <SelectContent><SelectItem value="R">Right</SelectItem><SelectItem value="L">Left</SelectItem><SelectItem value="S">Switch</SelectItem></SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Throws</Label>
              <Select value={form.throws || undefined} onValueChange={set("throws")}>
                <SelectTrigger className="h-10 rounded-lg"><SelectValue placeholder="Select" /></SelectTrigger>
                <SelectContent><SelectItem value="R">Right</SelectItem><SelectItem value="L">Left</SelectItem></SelectContent>
              </Select>
            </div>
            {field({ label: "Height", k: "height", placeholder: "e.g. 62 in" })}
            {field({ label: "Weight", k: "weight", placeholder: "e.g. 120 lb" })}
            {field({ label: "Team", k: "current_team" })}
            {field({ label: "School", k: "school" })}
            {field({ label: "City", k: "city" })}
            {field({ label: "State", k: "state" })}
            {field({ label: "Guardian name", k: "guardian_name" })}
            {field({ label: "Guardian email", k: "guardian_email", type: "email" })}
            {field({ label: "Guardian phone", k: "guardian_phone" })}
            {field({ label: "Emergency contact", k: "emergency_contact" })}
          </div>
          <DialogFooter>
            <Button type="submit" disabled={busy || !form.first_name || !form.last_name} className="rounded-xl bg-primary hover:bg-brand-secondary w-full h-11" data-testid="add-player-submit-button">
              {busy ? "Adding…" : "Add Athlete"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};

/* Search the shared 60'6" Player Registry (families who self-signed up) and pull
   an athlete into this organization. The backend links to an existing roster
   athlete when it finds a match instead of creating a duplicate. */
const RegistrySearchDialog = ({ onAdded }) => {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [addingId, setAddingId] = useState(null);

  // Debounced search — under 2 chars the endpoint returns nothing, so skip it.
  useEffect(() => {
    if (!open) return undefined;
    const term = q.trim();
    if (term.length < 2) { setResults([]); return undefined; }
    const t = setTimeout(() => {
      setSearching(true);
      api.get("/registry/search", { params: { q: term } })
        .then((r) => setResults(Array.isArray(r.data) ? r.data : []))
        .catch((e) => toast.error(errMsg(e)))
        .finally(() => setSearching(false));
    }, 300);
    return () => clearTimeout(t);
  }, [q, open]);

  const add = async (row) => {
    setAddingId(row.registry_athlete_id);
    try {
      const r = await api.post("/registry/add", { registry_athlete_id: row.registry_athlete_id });
      const a = r.data?.athlete;
      toast.success(
        r.data?.linked_existing
          ? `Linked to your existing athlete ${[a?.first_name, a?.last_name].filter(Boolean).join(" ") || `${row.first_name} ${row.last_name}`}`
          : "Added"
      );
      onAdded();
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setAddingId(null);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) { setQ(""); setResults([]); } }}>
      <DialogTrigger asChild>
        <Button variant="outline" className="rounded-xl h-11" data-testid="registry-search-button">
          <UserSearch className="h-4 w-4 mr-1" /> Find registered athletes
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-lg max-h-[85vh] flex flex-col rounded-2xl" data-testid="registry-search-dialog">
        <DialogHeader>
          <DialogTitle className="font-display text-2xl text-foreground">Find registered athletes</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 flex-1 min-h-0 flex flex-col">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search the 60'6&quot; Player Registry by name…"
              className="pl-9 h-11 rounded-xl"
              autoFocus
              data-testid="registry-search-input"
            />
          </div>
          <p className="text-xs text-muted-foreground">
            Families who created their own 60&apos;6&quot; ID show up here. Adding a player links their existing profile to your roster.
          </p>
          <div className="flex-1 min-h-0 overflow-y-auto space-y-2">
            {searching && <p className="text-sm text-muted-foreground text-center py-4">Searching…</p>}
            {!searching && q.trim().length >= 2 && results.length === 0 && (
              <p className="text-sm text-muted-foreground text-center py-4">No registered players match “{q.trim()}”.</p>
            )}
            {!searching && results.map((r) => (
              <div key={r.registry_athlete_id} className="rounded-xl border border-border bg-card px-4 py-3 flex flex-wrap items-center gap-3" data-testid={`registry-result-${r.registry_athlete_id}`}>
                <div className="flex-1 min-w-[160px]">
                  <p className="font-semibold text-foreground">{r.first_name} {r.last_name}</p>
                  <p className="text-xs text-muted-foreground">
                    {[
                      r.graduation_year ? `Class of ${r.graduation_year}` : null,
                      r.age_group || null,
                      r.primary_position || null,
                      r.city ? `${r.city}${r.state ? `, ${r.state}` : ""}` : r.state || null,
                    ].filter(Boolean).join(" · ") || "—"}
                  </p>
                  <p className="text-xs text-muted-foreground font-mono">
                    {[r.athlete_email_masked, r.guardian_email_masked].filter(Boolean).join(" · ")}
                  </p>
                </div>
                <Button
                  size="sm"
                  className="rounded-lg h-9 bg-primary hover:bg-brand-secondary"
                  disabled={addingId === r.registry_athlete_id}
                  onClick={() => add(r)}
                  data-testid={`registry-add-${r.registry_athlete_id}`}
                >
                  <UserCheck className="h-4 w-4 mr-1" />
                  {addingId === r.registry_athlete_id ? "Adding…" : "Add to organization"}
                </Button>
              </div>
            ))}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};

// Kept for Scout.js (it imports this chip row for its own header). The Players
// page itself now uses the Grad Year dropdown in the control bar instead.
export const GradYearChips = ({ years, selected, onSelect, testIdPrefix }) => {
  const list = years?.length ? years : selected !== "all" ? [{ year: selected, count: null }] : [];
  if (list.length === 0) return null;
  const chip = (active) =>
    cn(
      "shrink-0 whitespace-nowrap rounded-full border h-9 px-3.5 inline-flex items-center text-sm font-semibold transition-colors",
      active
        ? "bg-primary text-white border-primary"
        : "bg-card text-muted-foreground border-border hover:border-brand/50 hover:text-foreground"
    );
  return (
    <div className="flex gap-2 overflow-x-auto pb-1" data-testid={`${testIdPrefix}-gradyear-chips`}>
      <button type="button" onClick={() => onSelect("all")} className={chip(selected === "all")} data-testid={`${testIdPrefix}-gradyear-chip-all`}>
        All classes
      </button>
      {list.map(({ year, count }) => (
        <button
          key={year}
          type="button"
          onClick={() => onSelect(String(year))}
          className={chip(String(year) === String(selected))}
          data-testid={`${testIdPrefix}-gradyear-chip-${year}`}
        >
          Class of {year}{count !== null && count !== undefined ? ` (${count})` : ""}
        </button>
      ))}
    </div>
  );
};

/*
  Development status chips (overview payload `statuses` object). Priority order
  per client direction: Follow-Up > Needs Evaluation > Personal Best > New
  Video > Improving > Evaluated. Colors carry meaning via theme tokens only:
  warning = needs attention, success = positive momentum, info = new material.
*/
const STATUS_CHIP_DEFS = [
  { key: "follow_up", label: "Follow-Up", cls: "bg-warning/15 text-warning border-warning/40" },
  { key: "needs_evaluation", label: "Needs Evaluation", cls: "bg-warning/15 text-warning border-warning/40" },
  { key: "personal_best", label: "Personal Best", cls: "bg-success/15 text-success border-success/40" },
  { key: "new_video", label: "New Video", cls: "bg-[hsl(var(--info)_/_0.15)] text-info border-[hsl(var(--info)_/_0.4)]" },
  { key: "improving", label: "Improving", cls: "bg-success/15 text-success border-success/40" },
  { key: "evaluated", label: "Evaluated", cls: "bg-secondary text-muted-foreground border-border" },
];

const topStatuses = (statuses, max = 3) =>
  statuses ? STATUS_CHIP_DEFS.filter(({ key }) => statuses[key]).slice(0, max) : [];

const StatusChips = ({ statuses, max = 3, testIdPrefix }) => {
  const chips = topStatuses(statuses, max);
  if (chips.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-1.5">
      {chips.map(({ key, label, cls }) => (
        <span
          key={key}
          data-testid={testIdPrefix ? `${testIdPrefix}-status-${key.replace(/_/g, "-")}` : undefined}
          className={cn("inline-flex items-center whitespace-nowrap rounded-full border px-2 py-0.5 text-[11px] font-semibold", cls)}
        >
          {label}
        </span>
      ))}
    </div>
  );
};

const fmtScore = (v) => (Number.isFinite(Number(v)) && v !== null ? Number(v).toFixed(1).replace(/\.0$/, "") : "—");

const ScoreTrend = ({ score, change, size = "md" }) => {
  const num = size === "md" ? "text-2xl" : "text-xl";
  const hasChange = Number.isFinite(Number(change)) && change !== null && Number(change) !== 0;
  const up = hasChange && Number(change) > 0;
  return (
    <div className="flex items-baseline gap-1.5">
      <span className={cn("font-mono-num font-bold text-foreground", num)}>{fmtScore(score)}</span>
      {hasChange ? (
        <span className={cn("inline-flex items-center gap-0.5 text-xs font-mono-num font-semibold", up ? "text-success" : "text-warning")}>
          {up ? <TrendingUp className="h-3.5 w-3.5" /> : <TrendingDown className="h-3.5 w-3.5" />}
          {up ? "+" : ""}{Number(change).toFixed(1).replace(/\.0$/, "")}
        </span>
      ) : (
        score !== null && score !== undefined && <Minus className="h-3.5 w-3.5 text-muted-foreground" />
      )}
    </div>
  );
};

const fmtDate = (iso) => {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? "—"
    : d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
};

const pct = (x, total) => (total ? Math.round((x / total) * 100) : 0);

/* Scouting-card status pill. Priority: follow_up > needs eval > improving >
   evaluated. Warning = needs attention, success = on track. */
const CardStatusPill = ({ statuses }) => {
  const s = statuses || {};
  let label = "EVALUATED";
  let cls = "bg-success text-white";
  let trending = false;
  if (s.follow_up) {
    label = "FOLLOW-UP";
    cls = "bg-warning text-black";
  } else if (!s.evaluated) {
    label = "NEEDS EVAL";
    cls = "bg-warning text-black";
  } else if (s.improving) {
    trending = true;
  }
  return (
    <span className={cn("inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide shadow-md", cls)}>
      {trending ? <TrendingUp className="h-3 w-3" /> : <span aria-hidden="true">•</span>}
      {label}
    </span>
  );
};

/* Photo header for the roster card. Real photo when the athlete has one;
   otherwise a branded monogram panel with a faded position watermark, so a
   photo-less roster still looks intentional rather than broken. */
const CardPhoto = ({ p }) => {
  const [failed, setFailed] = useState(false);
  useEffect(() => { setFailed(false); }, [p.photo_url]);
  const src = !failed ? resolvePhotoSrc(p.photo_url) : null;
  if (src) {
    return (
      <img
        src={src}
        alt={`${p.first_name || ""} ${p.last_name || ""}`.trim() || "Player"}
        className="h-full w-full object-cover object-top"
        loading="lazy"
        onError={() => setFailed(true)}
      />
    );
  }
  const initials = `${(p.first_name || "?")[0] || ""}${(p.last_name || "")[0] || ""}`.toUpperCase();
  return (
    <div className="relative flex h-full w-full items-center justify-center bg-gradient-to-br from-brand-tertiary via-secondary to-background">
      {p.primary_position && (
        <span className="absolute -right-2 bottom-0 select-none font-display text-7xl font-extrabold leading-none text-foreground/[0.06]">
          {p.primary_position}
        </span>
      )}
      <span className="select-none font-display text-5xl text-brand/70">{initials}</span>
    </div>
  );
};

/* Right side of the card score block — adapted from ScoreTrend, with the
   "since last eval" caption the scouting card design calls for. */
const ChangeSince = ({ change }) => {
  const hasChange = change !== null && change !== undefined && Number.isFinite(Number(change)) && Number(change) !== 0;
  const up = hasChange && Number(change) > 0;
  return (
    <div className="text-right shrink-0">
      {hasChange ? (
        <span className={cn("inline-flex items-center gap-0.5 font-mono-num text-sm font-semibold", up ? "text-success" : "text-warning")}>
          {up ? <TrendingUp className="h-3.5 w-3.5" /> : <TrendingDown className="h-3.5 w-3.5" />}
          {up ? "+" : ""}{Number(change).toFixed(1).replace(/\.0$/, "")}
        </span>
      ) : (
        <Minus className="ml-auto h-3.5 w-3.5 text-muted-foreground" />
      )}
      <span className="block text-[10px] text-muted-foreground">since last eval</span>
    </div>
  );
};

/* One stat block inside the class snapshot band. Clickable blocks (Improving /
   Needs Follow-Up) toggle the quick filter, mirroring the old snapshot tiles. */
const SnapshotStat = ({ icon: Icon, tint, label, value, sub, onClick, active, testId }) => {
  const Tag = onClick ? "button" : "div";
  return (
    <Tag
      type={onClick ? "button" : undefined}
      onClick={onClick}
      data-testid={testId}
      className={cn(
        "flex items-center gap-3 rounded-xl px-3 py-2 text-left transition-colors",
        onClick && "cursor-pointer hover:bg-secondary",
        active && "bg-secondary ring-1 ring-brand/40"
      )}
    >
      <span className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-lg", tint)}>
        <Icon className="h-4 w-4" />
      </span>
      <span className="min-w-0">
        <span className="block font-mono-num text-2xl font-bold leading-tight text-foreground">{value ?? "—"}</span>
        <span className="block text-[11px] font-semibold text-muted-foreground whitespace-nowrap">{label}{active ? " ✕" : ""}</span>
        {sub}
      </span>
    </Tag>
  );
};

const identityLine = (p) =>
  [p.graduation_year ? `Class of ${p.graduation_year}` : null, p.primary_position || null, `${p.bats || "—"}/${p.throws || "—"}`]
    .filter(Boolean)
    .join(" · ");

export default function PlayersList() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [players, setPlayers] = useState([]);
  const [snapshot, setSnapshot] = useState(null); // null → overview unavailable, degrade quietly
  const [overviewOk, setOverviewOk] = useState(true); // optimistic; flips false on first 404
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [ageGroup, setAgeGroup] = useState("all");
  const [position, setPosition] = useState("all");
  const [team, setTeam] = useState("all");
  const [status, setStatus] = useState("active");
  const [gradYears, setGradYears] = useState(null); // null → endpoint unavailable
  const [teams, setTeams] = useState(null); // null → /teams unavailable, Team filter hidden
  const [quickFilter, setQuickFilter] = useState(null); // "improving" | "follow_up" | null (snapshot tile toggle)
  const [quickView, setQuickView] = useState(null); // athlete object → Quick View dialog
  const [view, setViewState] = useState(() => {
    try {
      const stored = localStorage.getItem(VIEW_STORAGE_KEY);
      return stored === "list" || stored === "card" ? stored : "card";
    } catch { return "card"; }
  });
  const [pending, setPending] = useState([]); // self-signup athletes awaiting approval
  const [pendingBusyId, setPendingBusyId] = useState(null);
  // Watchlist star toggle on cards. null → GET /watchlist failed or still
  // loading, stars hidden entirely (feature-detect, same as Scout.js).
  const [watchedIds, setWatchedIds] = useState(null);
  const isAdmin = ["owner", "admin"].includes(user?.role);

  useEffect(() => {
    api.get("/watchlist")
      .then((r) => setWatchedIds(new Set((Array.isArray(r.data) ? r.data : []).map((w) => w.id))))
      .catch(() => setWatchedIds(null));
  }, []);

  const toggleWatch = (e, p) => {
    e.stopPropagation();
    if (!watchedIds) return;
    const wasWatched = watchedIds.has(p.id);
    // Optimistic flip; roll back and toast on error.
    setWatchedIds((prev) => {
      const next = new Set(prev);
      if (wasWatched) next.delete(p.id); else next.add(p.id);
      return next;
    });
    (wasWatched ? api.delete(`/watchlist/${p.id}`) : api.post(`/watchlist/${p.id}`)).catch((err) => {
      setWatchedIds((prev) => {
        const next = new Set(prev);
        if (wasWatched) next.add(p.id); else next.delete(p.id);
        return next;
      });
      toast.error(errMsg(err));
    });
  };

  const setView = (v) => {
    setViewState(v);
    try { localStorage.setItem(VIEW_STORAGE_KEY, v); } catch { /* private mode */ }
  };

  // Deep-linkable: /players?graduation_year=2029 opens straight onto that class.
  const gradYear = searchParams.get("graduation_year") || "all";
  const setGradYear = (year) => {
    const next = new URLSearchParams(searchParams);
    if (year === "all") next.delete("graduation_year");
    else next.set("graduation_year", String(year));
    setSearchParams(next, { replace: true });
  };

  // Pending self-signups live outside the roster filters — always fetched flat.
  const loadPending = useCallback(() => {
    api.get("/athletes", { params: { status: "pending" } })
      .then((r) => setPending(Array.isArray(r.data) ? r.data : r.data?.athletes || []))
      .catch(() => setPending([]));
  }, []);

  useEffect(loadPending, [loadPending]);

  useEffect(() => {
    api.get("/athletes/grad-years")
      .then((r) => setGradYears(Array.isArray(r.data) ? r.data : null))
      .catch(() => setGradYears(null));
    api.get("/teams")
      .then((r) => setTeams(Array.isArray(r.data) ? r.data : null))
      .catch(() => setTeams(null)); // 404 → hide the Team filter
  }, []);

  const load = useCallback(() => {
    setLoading(true);
    const base = {};
    if (search) base.search = search;
    if (position !== "all") base.position = position;
    if (status !== "all") base.status = status;
    if (gradYear !== "all") base.graduation_year = gradYear;

    // Filters the backend may not know about are re-applied client-side so a
    // deep link (or older backend) never shows the wrong set.
    const clientFilter = (rows) => {
      let out = rows;
      if (gradYear !== "all") out = out.filter((p) => String(p.graduation_year || "") === String(gradYear));
      // Dashboard "Flagged" cards deep-link here; the list payload carries the flag.
      if (searchParams.get("flagged") === "true") out = out.filter((p) => p.flagged_follow_up);
      return out;
    };

    // Degraded path: the plain /athletes list (no snapshot, no dev statuses).
    const loadLegacy = () => {
      const params = { ...base };
      if (ageGroup !== "all") params.age_group = ageGroup;
      api.get("/athletes", { params }).then((r) => {
        let rows = Array.isArray(r.data) ? r.data : r.data?.athletes || [];
        rows = clientFilter(rows);
        if (team !== "all") rows = rows.filter((p) => p.current_team === team);
        setPlayers(rows);
        setSnapshot(null);
      }).finally(() => setLoading(false));
    };

    if (!overviewOk) { loadLegacy(); return; }
    const params = { ...base };
    if (team !== "all") params.team = team;
    api.get("/athletes/overview", { params }).then((r) => {
      let rows = Array.isArray(r.data?.athletes) ? r.data.athletes : [];
      rows = clientFilter(rows);
      if (ageGroup !== "all") rows = rows.filter((p) => p.age_group === ageGroup); // not in the overview contract
      setPlayers(rows);
      setSnapshot(r.data?.snapshot || null);
      setLoading(false);
    }).catch(() => {
      setOverviewOk(false); // 404 or bad shape → fall back for the rest of the session
      loadLegacy();
    });
  }, [search, ageGroup, position, team, status, gradYear, searchParams, overviewOk]);

  useEffect(() => {
    const t = setTimeout(load, search ? 350 : 0);
    return () => clearTimeout(t);
  }, [load, search]);

  // Snapshot-tile quick filter (Improving / Follow-Up) — client-side toggle
  // over data already loaded; needs the overview statuses to mean anything.
  const visible = useMemo(() => {
    if (!quickFilter || !snapshot) return players;
    return players.filter((p) => p.statuses?.[quickFilter]);
  }, [players, quickFilter, snapshot]);

  const moreFiltersActive = (ageGroup !== "all" ? 1 : 0) + (status !== "active" ? 1 : 0);
  const gradYearOptions = gradYears?.length ? gradYears : gradYear !== "all" ? [{ year: gradYear, count: null }] : [];

  const quickViewOpen = (p) => setQuickView(p);

  const approvePending = async (p) => {
    setPendingBusyId(p.id);
    try {
      await api.post(`/athletes/${p.id}/approve`);
      toast.success(`${p.first_name} ${p.last_name} approved and added to the roster.`);
      loadPending();
      load();
    } catch (e) { toast.error(errMsg(e)); } finally { setPendingBusyId(null); }
  };

  const rejectPending = async (p) => {
    if (!window.confirm(`Reject ${p.first_name} ${p.last_name}? Their signup is archived and won't appear on your roster.`)) return;
    setPendingBusyId(p.id);
    try {
      await api.post(`/athletes/${p.id}/archive`);
      toast.success(`${p.first_name} ${p.last_name} rejected.`);
      loadPending();
      load();
    } catch (e) { toast.error(errMsg(e)); } finally { setPendingBusyId(null); }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-4xl text-foreground">Athletes</h1>
          <p className="text-sm text-muted-foreground">{visible.length} player{visible.length === 1 ? "" : "s"} in the directory</p>
        </div>
        {isAdmin && (
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" className="rounded-xl h-11" onClick={() => navigate("/players/import")} data-testid="import-players-button">
              <Upload className="h-4 w-4 mr-1" /> Import Roster (CSV · Excel · Word)
            </Button>
            <RegistrySearchDialog onAdded={() => { load(); loadPending(); }} />
            <Button variant="outline" className="rounded-xl h-11" onClick={() => window.open(signedUrl("/athletes-export/csv"), "_blank")} data-testid="export-players-button">
              <FileDown className="h-4 w-4 mr-1" /> Export
            </Button>
            <AddPlayerDialog onCreated={load} />
          </div>
        )}
      </div>

      {/* Self-signup approvals — surfaced above everything so no family waits unseen. */}
      {pending.length > 0 && (
        <Card className="rounded-2xl border-warning/40 bg-warning/10" data-testid="pending-approvals-card">
          <CardContent className="py-4 space-y-2">
            <p className="text-sm font-semibold text-warning">Pending approval ({pending.length})</p>
            {pending.map((p) => (
              <div key={p.id} className="flex flex-wrap items-center justify-between gap-2 text-sm border-b border-warning/20 pb-2 last:border-0 last:pb-0">
                <div className="min-w-0">
                  <span className="font-semibold text-foreground">{p.first_name} {p.last_name}</span>
                  <span className="text-muted-foreground">{p.graduation_year ? ` · Class of ${p.graduation_year}` : ""}</span>
                </div>
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    className="rounded-lg h-8 bg-primary hover:bg-brand-secondary"
                    disabled={pendingBusyId === p.id}
                    onClick={() => approvePending(p)}
                    data-testid={`pending-approve-${p.id}`}
                  >
                    Approve
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="rounded-lg h-8 text-muted-foreground"
                    disabled={pendingBusyId === p.id}
                    onClick={() => rejectPending(p)}
                    data-testid={`pending-reject-${p.id}`}
                  >
                    Reject
                  </Button>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* Class snapshot band — class selector + development at a glance,
          reflecting current filters. Improving / Needs Follow-Up stats toggle a
          quick filter. Legacy fallback (snapshot null) keeps only the selector. */}
      <div className="rounded-2xl border border-border bg-card px-4 py-4 sm:px-6" data-testid="players-snapshot">
        <div className="flex flex-wrap items-center gap-x-6 gap-y-4">
          <div className="min-w-[120px]">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Class of</p>
            <Select value={gradYear} onValueChange={setGradYear}>
              <SelectTrigger
                className="h-auto w-auto gap-1.5 border-0 bg-transparent p-0 focus:ring-0 focus:ring-offset-0"
                data-testid="players-gradyear-select"
              >
                <SelectValue placeholder="Grad Year">
                  <span className={cn("font-display text-4xl leading-none", gradYear === "all" ? "text-foreground" : "text-primary")}>
                    {gradYear === "all" ? "All" : gradYear}
                  </span>
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All classes</SelectItem>
                {gradYearOptions.map(({ year, count }) => (
                  <SelectItem key={year} value={String(year)}>
                    Class of {year}{count !== null && count !== undefined ? ` (${count})` : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="mt-1 text-xs text-muted-foreground">{visible.length} athlete{visible.length === 1 ? "" : "s"}</p>
          </div>
          {snapshot && (
            <>
              <div className="hidden md:block w-px self-stretch bg-border" />
              <SnapshotStat
                icon={Users}
                tint="bg-[hsl(var(--info)_/_0.15)] text-info"
                label="Total Athletes"
                value={snapshot.total}
                testId="players-snapshot-total"
              />
              <SnapshotStat
                icon={ClipboardCheck}
                tint="bg-success/15 text-success"
                label="Evaluated"
                value={snapshot.evaluated}
                sub={<span className="block font-mono-num text-[10px] font-semibold text-success">{pct(snapshot.evaluated, snapshot.total)}%</span>}
                testId="players-snapshot-evaluated"
              />
              <SnapshotStat
                icon={TrendingUp}
                tint="bg-success/15 text-success"
                label="Improving"
                value={snapshot.improving}
                sub={<span className="block font-mono-num text-[10px] font-semibold text-success">{pct(snapshot.improving, snapshot.total)}%</span>}
                onClick={() => setQuickFilter(quickFilter === "improving" ? null : "improving")}
                active={quickFilter === "improving"}
                testId="players-snapshot-improving"
              />
              <SnapshotStat
                icon={AlertTriangle}
                tint="bg-warning/15 text-warning"
                label="Need Follow-Up"
                value={snapshot.follow_up}
                sub={<span className="block font-mono-num text-[10px] font-semibold text-warning">{pct(snapshot.follow_up, snapshot.total)}%</span>}
                onClick={() => setQuickFilter(quickFilter === "follow_up" ? null : "follow_up")}
                active={quickFilter === "follow_up"}
                testId="players-snapshot-follow-up"
              />
              <div className="ml-auto">
                <Button variant="outline" className="rounded-xl h-10" onClick={() => navigate("/reports")} data-testid="players-view-class-report">
                  <BarChart3 className="h-4 w-4 mr-1.5" /> View Class Report
                </Button>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Control bar: Search | Position | Team | More Filters | View
          (Grad Year lives in the class snapshot band above) */}
      <div className="flex flex-wrap gap-2">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search by name…" className="pl-9 h-11 rounded-xl bg-card" data-testid="players-search-input" />
        </div>
        <Select value={position} onValueChange={setPosition}>
          <SelectTrigger className="w-[120px] h-11 rounded-xl bg-card" data-testid="players-filter-position"><SelectValue /></SelectTrigger>
          <SelectContent><SelectItem value="all">All positions</SelectItem>{POSITIONS.map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}</SelectContent>
        </Select>
        {teams?.length > 0 && (
          <Select value={team} onValueChange={setTeam}>
            <SelectTrigger className="w-[150px] h-11 rounded-xl bg-card" data-testid="players-filter-team"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All teams</SelectItem>
              {teams.map((t) => (
                <SelectItem key={t.team} value={t.team}>
                  {t.team}{t.athlete_count !== null && t.athlete_count !== undefined ? ` (${t.athlete_count})` : ""}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        <Popover>
          <PopoverTrigger asChild>
            <Button variant="outline" className="h-11 rounded-xl bg-card" data-testid="players-more-filters">
              <SlidersHorizontal className="h-4 w-4 mr-1.5" /> More Filters
              {moreFiltersActive > 0 && (
                <span className="ml-1.5 rounded-full bg-primary text-white text-[10px] font-mono-num font-bold px-1.5 py-0.5 leading-none">{moreFiltersActive}</span>
              )}
            </Button>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-64 space-y-3 rounded-xl">
            <div className="space-y-1">
              <Label className="text-xs">Age group</Label>
              <Select value={ageGroup} onValueChange={setAgeGroup}>
                <SelectTrigger className="h-10 rounded-lg" data-testid="players-filter-age-group"><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="all">All ages</SelectItem>{AGE_GROUPS.map((a) => <SelectItem key={a} value={a}>{a}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Roster status</Label>
              <Select value={status} onValueChange={setStatus}>
                <SelectTrigger className="h-10 rounded-lg" data-testid="players-filter-status"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="active">Active</SelectItem>
                  <SelectItem value="archived">Archived</SelectItem>
                  <SelectItem value="all">All</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </PopoverContent>
        </Popover>
        <div className="inline-flex h-11 items-center rounded-xl border border-border bg-card p-1" data-testid="players-view-toggle">
          <button
            type="button"
            onClick={() => setView("card")}
            aria-pressed={view === "card"}
            data-testid="players-view-toggle-card"
            className={cn("inline-flex h-9 items-center gap-1.5 rounded-lg px-3 text-sm font-semibold transition-colors", view === "card" ? "bg-primary text-white" : "text-muted-foreground hover:text-foreground")}
          >
            <LayoutGrid className="h-4 w-4" /> Cards
          </button>
          <button
            type="button"
            onClick={() => setView("list")}
            aria-pressed={view === "list"}
            data-testid="players-view-toggle-list"
            className={cn("inline-flex h-9 items-center gap-1.5 rounded-lg px-3 text-sm font-semibold transition-colors", view === "list" ? "bg-primary text-white" : "text-muted-foreground hover:text-foreground")}
          >
            <List className="h-4 w-4" /> List
          </button>
        </div>
      </div>

      {loading ? (
        view === "card" ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
            {[...Array(8)].map((_, i) => <Skeleton key={i} className="h-80 rounded-2xl" />)}
          </div>
        ) : (
          <div className="space-y-2">{[...Array(6)].map((_, i) => <Skeleton key={i} className="h-16 rounded-2xl" />)}</div>
        )
      ) : visible.length === 0 ? (
        <EmptyState icon={Users} title="No players found" hint="Adjust your filters, or add players manually or via CSV import." />
      ) : view === "card" ? (
        /* Card view — premium scouting card: status + watchlist on top, identity,
           score block, then focus / last-eval meta. Whole card opens Quick View
           (div+role, not <button>, so the star and CTA can be real buttons). */
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3" data-testid="players-card-grid">
          {visible.map((p) => {
            const hasScore = p.latest_overall !== null && p.latest_overall !== undefined;
            const watched = watchedIds?.has(p.id);
            return (
              <div
                key={p.id}
                role="button"
                tabIndex={0}
                onClick={() => quickViewOpen(p)}
                onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); quickViewOpen(p); } }}
                className="text-left cursor-pointer h-full"
                data-testid={`players-card-${p.id}`}
              >
                <Card className="h-full overflow-hidden rounded-2xl border-border transition-all hover:border-brand/50 hover:shadow-lg hover:-translate-y-0.5">
                    {/* Photo header — the athlete's face is the card. Status,
                        watchlist star and the overall score live on the image. */}
                    <div className="relative aspect-[4/3] w-full overflow-hidden">
                      <CardPhoto p={p} />
                      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-14 bg-gradient-to-t from-black/55 to-transparent" />
                      {snapshot && (
                        <div className="absolute left-2.5 top-2.5 flex max-w-[70%] flex-wrap items-center gap-1.5">
                          <CardStatusPill statuses={p.statuses} />
                          {p.statuses?.new_video && (
                            <span className="inline-flex items-center gap-1 whitespace-nowrap rounded-full bg-[hsl(var(--info))] px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white shadow-md">
                              <span aria-hidden="true">•</span> NEW VIDEO
                            </span>
                          )}
                        </div>
                      )}
                      {watchedIds && (
                        <button
                          type="button"
                          onClick={(e) => toggleWatch(e, p)}
                          className="absolute right-2 top-2 rounded-full bg-black/40 p-1.5 backdrop-blur-sm transition-colors hover:bg-black/60"
                          title={watched ? "Remove from watchlist" : "Add to watchlist"}
                          aria-label={watched ? "Remove from watchlist" : "Add to watchlist"}
                          aria-pressed={!!watched}
                          data-testid={`players-watch-${p.id}`}
                        >
                          <Star className={cn("h-4 w-4", watched ? "fill-current text-warning" : "text-white/85")} />
                        </button>
                      )}
                      {hasScore && (
                        <span className="absolute bottom-2.5 left-2.5 rounded-lg bg-success px-2.5 py-1.5 font-mono-num text-xl font-bold leading-none text-white shadow-lg">
                          {fmtScore(p.latest_overall)}
                        </span>
                      )}
                    </div>
                  <CardContent className="p-4 pt-3 space-y-2.5">
                    <div className="min-w-0">
                      <p className="font-display text-lg leading-tight text-foreground truncate">{p.first_name} {p.last_name}</p>
                      <p className="text-xs text-muted-foreground truncate">
                        {p.primary_position || "—"} · {p.bats || "—"}/{p.throws || "—"} · {p.current_team || "No team"}
                      </p>
                      {(p.graduation_year || p.age_group) && (
                        <p className="text-xs text-muted-foreground truncate">
                          {[p.graduation_year ? `Class of ${p.graduation_year}` : null, p.age_group || null].filter(Boolean).join(" · ")}
                        </p>
                      )}
                    </div>
                    {snapshot && (
                      <>
                        {hasScore ? (
                          /* The score itself sits on the photo — this row carries the trend. */
                          <div className="flex min-h-[44px] items-center justify-between gap-2 rounded-xl bg-secondary px-3 py-2">
                            <span className="text-[10px] font-semibold uppercase tracking-wide leading-tight text-muted-foreground">
                              Overall Eval Score
                            </span>
                            <ChangeSince change={p.score_change} />
                          </div>
                        ) : p.statuses?.evaluated ? (
                          /* Evaluated, but the evals carry raw measurements only —
                             no normalized overall. Don't contradict the pill. */
                          <div className="flex min-h-[52px] items-center justify-between gap-2 rounded-xl bg-secondary px-3 py-2">
                            <span className="text-xs text-muted-foreground">Evaluated · verified metrics on file</span>
                            <span className="text-[10px] font-semibold uppercase tracking-wide text-info">View profile →</span>
                          </div>
                        ) : (
                          <div className="flex min-h-[52px] items-center rounded-xl bg-secondary px-3 py-2">
                            <span className="text-xs text-muted-foreground">No eval yet · Not Evaluated</span>
                          </div>
                        )}
                        <div className="grid grid-cols-2 gap-2">
                          <div className="min-w-0">
                            <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Focus</p>
                            <p className="text-xs text-foreground truncate" title={p.development_focus || undefined}>{p.development_focus || "—"}</p>
                          </div>
                          <div className="min-w-0">
                            <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Last Eval</p>
                            <p className="text-xs text-foreground truncate">{fmtDate(p.last_eval_at)}</p>
                          </div>
                        </div>
                        {!hasScore && !p.statuses?.evaluated && (
                          <button
                            type="button"
                            onClick={(e) => { e.stopPropagation(); navigate("/events"); }}
                            className="flex h-9 w-full items-center justify-center gap-1.5 rounded-xl border border-warning/40 bg-warning/15 text-xs font-semibold text-warning transition-colors hover:bg-warning/25"
                            data-testid={`players-schedule-${p.id}`}
                          >
                            <CalendarPlus className="h-4 w-4" /> Schedule Evaluation
                          </button>
                        )}
                      </>
                    )}
                  </CardContent>
                </Card>
              </div>
            );
          })}
        </div>
      ) : (
        <>
          {/* Mobile cards (list view) */}
          <div className="md:hidden space-y-2">
            {visible.map((p) => (
              <Link key={p.id} to={`/players/${p.id}`} data-testid={`player-card-${p.id}`}>
                <Card className="rounded-2xl border-border mb-2 active:scale-[0.99] transition">
                  <CardContent className="py-3.5 flex items-center gap-3">
                    <PlayerAvatar firstName={p.first_name} lastName={p.last_name} photoUrl={p.photo_url} />
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold text-foreground truncate">{p.first_name} {p.last_name}</p>
                      <p className="text-xs text-muted-foreground">{p.graduation_year ? `${p.graduation_year} · ` : ""}{p.age_group || "—"} · {p.primary_position || "—"} · {p.current_team || "No team"}</p>
                    </div>
                    <StatusBadge status={p.status} />
                    <ChevronRight className="h-4 w-4 text-muted-foreground" />
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>
          {/* Desktop table (list view) */}
          <Card className="hidden md:block rounded-2xl border-border overflow-hidden">
            <Table data-testid="players-table">
              <TableHeader>
                <TableRow className="bg-secondary">
                  <TableHead>Player</TableHead>
                  <TableHead>Class</TableHead>
                  <TableHead>Age Group</TableHead>
                  <TableHead>Position</TableHead>
                  <TableHead>B/T</TableHead>
                  {snapshot && <TableHead>Score</TableHead>}
                  <TableHead>Team</TableHead>
                  <TableHead>Location</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="w-12"><span className="sr-only">Quick view</span></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {visible.map((p) => (
                  <TableRow key={p.id} className="cursor-pointer hover:bg-secondary" onClick={() => navigate(`/players/${p.id}`)} data-testid={`player-row-${p.id}`}>
                    <TableCell>
                      <div className="flex items-center gap-3">
                        <PlayerAvatar firstName={p.first_name} lastName={p.last_name} photoUrl={p.photo_url} size="sm" />
                        <span className="font-semibold text-foreground">{p.first_name} {p.last_name}</span>
                      </div>
                    </TableCell>
                    <TableCell className="font-mono-num">{p.graduation_year || "—"}</TableCell>
                    <TableCell>{p.age_group || "—"}</TableCell>
                    <TableCell>{p.primary_position || "—"}</TableCell>
                    <TableCell className="font-mono-num text-xs">{p.bats || "—"}/{p.throws || "—"}</TableCell>
                    {snapshot && (
                      <TableCell className="font-mono-num font-semibold text-foreground">{fmtScore(p.latest_overall)}</TableCell>
                    )}
                    <TableCell className="text-muted-foreground">{p.current_team || "—"}</TableCell>
                    <TableCell className="text-muted-foreground">{p.city ? `${p.city}, ${p.state}` : "—"}</TableCell>
                    <TableCell><StatusBadge status={p.status} /></TableCell>
                    <TableCell>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 rounded-lg text-muted-foreground hover:text-foreground"
                        onClick={(e) => { e.stopPropagation(); quickViewOpen(p); }}
                        aria-label={`Quick view ${p.first_name} ${p.last_name}`}
                        data-testid={`player-quickview-${p.id}`}
                      >
                        <Eye className="h-4 w-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>
        </>
      )}

      {/* Quick View — details on demand, from data already loaded (no extra fetch). */}
      <Dialog open={!!quickView} onOpenChange={(o) => { if (!o) setQuickView(null); }}>
        <DialogContent className="max-w-md rounded-2xl" data-testid="players-quickview">
          {quickView && (
            <>
              <DialogHeader>
                <div className="flex items-center gap-4">
                  <PlayerAvatar firstName={quickView.first_name} lastName={quickView.last_name} photoUrl={quickView.photo_url} size="xl" />
                  <div className="min-w-0">
                    <DialogTitle className="font-display text-2xl text-foreground truncate">
                      {quickView.first_name} {quickView.last_name}
                    </DialogTitle>
                    <p className="text-sm text-muted-foreground">{identityLine(quickView) || "—"}</p>
                    <p className="text-sm text-muted-foreground truncate">{quickView.current_team || "No team"}</p>
                  </div>
                </div>
              </DialogHeader>
              <div className="space-y-3">
                {snapshot && (
                  <div className="rounded-xl bg-secondary px-4 py-3 space-y-1">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Latest eval</span>
                      <ScoreTrend score={quickView.latest_overall} change={quickView.score_change} />
                    </div>
                    <p className="text-xs text-muted-foreground">Last eval · {fmtDate(quickView.last_eval_at)}</p>
                  </div>
                )}
                {snapshot && <StatusChips statuses={quickView.statuses} max={3} testIdPrefix="players-quickview" />}
                {quickView.development_focus && (
                  <p className="text-sm text-muted-foreground">
                    <span className="font-semibold text-foreground">Development focus:</span> {quickView.development_focus}
                  </p>
                )}
                {!snapshot && <StatusBadge status={quickView.status} />}
              </div>
              <DialogFooter className="gap-2 sm:gap-2">
                <Button variant="outline" className="rounded-xl h-11" onClick={() => setQuickView(null)} data-testid="players-quickview-close">
                  Close
                </Button>
                <Button
                  className="rounded-xl h-11 bg-primary hover:bg-brand-secondary"
                  onClick={() => navigate(`/players/${quickView.id}`)}
                  data-testid="players-quickview-profile"
                >
                  Full profile <ArrowRight className="h-4 w-4 ml-1" />
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
