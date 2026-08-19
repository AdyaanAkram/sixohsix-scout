import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { EmptyState } from "@/components/common/EmptyState";
import { resolvePhotoSrc } from "@/components/common/PlayerAvatar";
import { VerificationBadge, isVerifiedSource } from "@/components/common/StatusBadge";
import { GradYearChips } from "@/pages/PlayersList";
import { cn } from "@/lib/utils";
import {
  ClipboardList, GitCompare, Flag, ArrowRight, ArrowUpRight, ArrowDownRight,
  Users, Video, ClipboardCheck, Star, CalendarDays, Target,
} from "lucide-react";

const POSITIONS = ["P", "C", "1B", "2B", "3B", "SS", "LF", "CF", "RF"];

// Header quick links kept from the previous Scout landing (same routes, same
// testids) plus Events — Scout Mode is Discover | Watchlist | Compare | Events,
// with Compare and Events living here as links to the existing pages.
const ACTIONS = [
  { to: "/review", icon: ClipboardList, title: "Review Queue", testId: "scout-review-link" },
  { to: "/scout/compare", icon: GitCompare, title: "Compare Players", testId: "scout-compare-link" },
  { to: "/events", icon: CalendarDays, title: "Events", testId: "scout-events-link" },
  { to: "/reports", icon: Flag, title: "Rankings & Reports", testId: "scout-reports-link" },
];

// Verified metrics surfaced on a card, in preference order. Matches the
// backend's COMPARE_KEY_METRICS naming (see PlayerCompare).
const CHIP_METRIC_ORDER = ["exit_velocity", "throwing_velocity", "sixty_yard_dash"];

// How many cards get the (heavier) /athletes/compare enrichment — verified
// metrics, per-event trend and video counts. Cards beyond the cap still show
// roster info and the leaderboard score.
const ENRICH_CAP = 24;
const ENRICH_BATCH = 4; // backend hard limit per compare call

const errMsg = (e) => e?.response?.data?.detail || e?.message || "Something went wrong";

// Latest-vs-previous event change from a compare payload's progress_series.
// Returns null unless at least two scored event dates exist — a trend is
// never invented from a single evaluation.
const trendOf = (payload) => {
  const pts = (payload?.progress_series || []).filter((p) => p.overall_score !== null && p.overall_score !== undefined);
  if (pts.length < 2) return null;
  const change = Number(pts[pts.length - 1].overall_score) - Number(pts[pts.length - 2].overall_score);
  return Math.round(change * 10) / 10;
};

// Up to three measurements for the card's mini-grid, verified sources first,
// key metrics first.
const chipMetrics = (payload) => {
  const ms = payload?.measurements || [];
  const rankKey = (m) => {
    const i = CHIP_METRIC_ORDER.indexOf(m.metric_key);
    return i === -1 ? CHIP_METRIC_ORDER.length : i;
  };
  return [...ms]
    .sort((a, b) => (isVerifiedSource(b.source) - isVerifiedSource(a.source)) || (rankKey(a) - rankKey(b)))
    .slice(0, 3);
};

const TrendArrow = ({ change }) => {
  if (change === null || change === undefined) return null;
  if (change === 0) {
    return <span className="text-xs font-mono-num text-muted-foreground" title="No change between last two scored events">±0</span>;
  }
  const up = change > 0;
  const Icon = up ? ArrowUpRight : ArrowDownRight;
  return (
    <span
      className={cn("inline-flex items-center gap-0.5 text-xs font-mono-num font-bold", up ? "text-success" : "text-destructive")}
      title="Change vs previous scored event"
      data-testid="scout-trend-arrow"
    >
      <Icon className="h-3.5 w-3.5" />{up ? "+" : ""}{change}
    </span>
  );
};

/* Photo header for the prospect card — same idiom as the Athletes directory:
   real photo when the athlete has one, otherwise a branded monogram panel with
   a faded position watermark so a photo-less prospect still looks intentional. */
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

// One prospect card, shared by Discover and Watchlist. `wl` is the athlete's
// /watchlist entry (latest_overall, score_change, development_focus) used as a
// fallback when the compare enrichment hasn't loaded; `onToggleWatch` being
// undefined hides the star entirely (watchlist endpoint unavailable).
const ProspectCard = ({ athlete, score, payload, wl, watched, onToggleWatch }) => {
  const overall = payload?.overall_score ?? score?.overall_score ?? wl?.latest_overall ?? null;
  const evalCount = payload?.evaluation_count ?? score?.evaluation_count ?? null;
  const hasScore = overall !== null && overall !== undefined;
  // Evaluated-but-unscored: evals exist yet carry raw metrics only. Never show
  // a "—" score for that — say what's actually on file.
  const evaluated = (evalCount ?? 0) > 0 || !!athlete.statuses?.evaluated || !!wl?.statuses?.evaluated;
  const enrichedChange = trendOf(payload);
  const change = enrichedChange !== null ? enrichedChange
    : (wl?.score_change !== null && wl?.score_change !== undefined ? Math.round(Number(wl.score_change) * 10) / 10 : null);
  const chips = chipMetrics(payload);
  return (
    <Card
      className="h-full overflow-hidden rounded-2xl border-border transition-all hover:border-brand/50 hover:shadow-lg hover:-translate-y-0.5"
      data-testid={`scout-prospect-card-${athlete.id}`}
    >
      {/* Photo header — the prospect's face is the card. The watchlist star and
          the overall score (when a real one exists) live on the image. */}
      <div className="relative aspect-[4/3] w-full overflow-hidden">
        <CardPhoto p={athlete} />
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-14 bg-gradient-to-t from-black/55 to-transparent" />
        {onToggleWatch && (
          <button
            type="button"
            onClick={() => onToggleWatch(athlete)}
            className="absolute right-2 top-2 rounded-full bg-black/40 p-1.5 backdrop-blur-sm transition-colors hover:bg-black/60"
            title={watched ? "Remove from watchlist" : "Add to watchlist"}
            aria-label={watched ? "Remove from watchlist" : "Add to watchlist"}
            aria-pressed={!!watched}
            data-testid={`scout-watch-toggle-${athlete.id}`}
          >
            <Star className={cn("h-4 w-4", watched ? "fill-current text-warning" : "text-white/85")} />
          </button>
        )}
        {hasScore && (
          <span className="absolute bottom-2.5 left-2.5 rounded-lg bg-success px-2.5 py-1.5 font-mono-num text-xl font-bold leading-none text-white shadow-lg">
            {overall}
          </span>
        )}
      </div>

      <CardContent className="p-4 pt-3 space-y-2.5">
        <div className="min-w-0">
          <Link to={`/players/${athlete.id}`} className="font-display text-lg leading-tight text-foreground hover:underline block truncate">
            {athlete.first_name} {athlete.last_name}
          </Link>
          <p className="text-xs text-muted-foreground truncate">
            {athlete.primary_position || "—"} · {athlete.bats || "—"}/{athlete.throws || "—"} · {athlete.current_team || "No team"}
          </p>
          <p className="text-xs text-muted-foreground truncate">
            {athlete.graduation_year ? `Class of ${athlete.graduation_year}` : "No grad year"}
            {athlete.age_group ? ` · ${athlete.age_group}` : ""}
          </p>
        </div>

        {hasScore ? (
          /* The score itself sits on the photo — this row carries the trend. */
          <div className="flex min-h-[44px] items-center justify-between gap-2 rounded-xl bg-secondary px-3 py-2">
            <span className="text-[10px] font-semibold uppercase tracking-wide leading-tight text-muted-foreground">
              Overall Eval Score
            </span>
            {change !== null ? (
              <TrendArrow change={change} />
            ) : (
              <span className="font-mono-num text-xs text-muted-foreground">–</span>
            )}
          </div>
        ) : evaluated ? (
          <div className="flex min-h-[44px] items-center rounded-xl bg-secondary px-3 py-2">
            <span className="text-xs text-muted-foreground">Evaluated · metrics on file</span>
          </div>
        ) : (
          <div className="flex min-h-[44px] items-center rounded-xl bg-secondary px-3 py-2">
            <span className="text-xs text-muted-foreground">No eval yet · Not Evaluated</span>
          </div>
        )}

        {chips.length > 0 ? (
          <div className={cn("grid gap-2", chips.length === 1 ? "grid-cols-1" : chips.length === 2 ? "grid-cols-2" : "grid-cols-3")}>
            {chips.map((m) => (
              <div key={m.metric_key} className="min-w-0 rounded-lg bg-secondary/60 px-2.5 py-2">
                <p className="text-[9px] font-semibold uppercase tracking-wide text-muted-foreground truncate" title={m.label}>
                  {m.label}
                </p>
                <p className="flex items-baseline gap-1 whitespace-nowrap">
                  <span className="truncate font-mono-num text-base font-bold leading-tight text-foreground">
                    {m.value != null ? m.value : "–"}
                  </span>
                  {m.unit && <span className="shrink-0 text-[10px] text-muted-foreground">{m.unit}</span>}
                  <VerificationBadge source={m.source} iconOnly className="ml-auto self-center" />
                </p>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-[11px] text-muted-foreground">No verified measurements on file.</p>
        )}

        {wl?.development_focus && (
          <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <Target className="h-3.5 w-3.5 shrink-0 text-brand" />
            <span className="truncate" title={wl.development_focus}>{wl.development_focus}</span>
          </p>
        )}

        <div className="flex items-center justify-between border-t border-border pt-2.5">
          <div className="flex items-center gap-3 text-[11px] text-muted-foreground">
            {evalCount !== null && (
              <span className="inline-flex items-center gap-1"><ClipboardCheck className="h-3.5 w-3.5" />{evalCount} eval{evalCount === 1 ? "" : "s"}</span>
            )}
            {payload?.video_count !== undefined && (
              <span className="inline-flex items-center gap-1"><Video className="h-3.5 w-3.5" />{payload.video_count} video{payload.video_count === 1 ? "" : "s"}</span>
            )}
          </div>
          <div className="flex items-center gap-1">
            <Button asChild variant="ghost" size="sm" className="h-8 px-2 text-xs" data-testid={`scout-card-compare-${athlete.id}`}>
              <Link to="/scout/compare" title="Open the compare picker"><GitCompare className="h-3.5 w-3.5 mr-1" /> Compare</Link>
            </Button>
            <Button asChild variant="ghost" size="sm" className="h-8 px-2 text-xs" data-testid={`scout-card-profile-${athlete.id}`}>
              <Link to={`/players/${athlete.id}`}>Profile <ArrowRight className="h-3.5 w-3.5 ml-1" /></Link>
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
};

const CardGrid = ({ children, testId }) => (
  <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3" data-testid={testId}>{children}</div>
);

const GridSkeleton = () => (
  <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{[...Array(6)].map((_, i) => <Skeleton key={i} className="h-80 rounded-2xl" />)}</div>
);

export default function Scout() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [gradYears, setGradYears] = useState(null);
  const [position, setPosition] = useState("all");
  const [athletes, setAthletes] = useState(null); // null = loading
  const [scores, setScores] = useState({}); // athlete id → leaderboard row
  const [enriched, setEnriched] = useState({}); // athlete id → compare payload
  const [enrichBlocked, setEnrichBlocked] = useState(false);
  const enrichCache = useRef(new Map());

  // Watchlist: null = loading, array = loaded. `watchAvailable` goes false when
  // GET /watchlist errors (endpoint not shipped, or role without access) — the
  // Watchlist tab and every star affordance then disappear and the page behaves
  // exactly like the plain Prospect Board.
  const [watchlist, setWatchlist] = useState(null);
  const [watchAvailable, setWatchAvailable] = useState(null);

  useEffect(() => {
    api.get("/watchlist").then((r) => {
      setWatchlist(Array.isArray(r.data) ? r.data : []);
      setWatchAvailable(true);
    }).catch(() => {
      setWatchlist(null);
      setWatchAvailable(false);
    });
  }, []);

  const watchedIds = useMemo(() => new Set((watchlist || []).map((w) => w.id)), [watchlist]);

  // Tab state lives in the URL (?tab=watchlist) so the nav can deep-link and
  // refresh/back keep the tab. Discover is the unmarked default.
  const tab = searchParams.get("tab") === "watchlist" && watchAvailable !== false ? "watchlist" : "discover";
  const setTab = (t) => {
    const next = new URLSearchParams(searchParams);
    if (t === "watchlist") next.set("tab", "watchlist");
    else next.delete("tab");
    setSearchParams(next, { replace: true });
  };

  // Same deep-link contract as /players: ?graduation_year=2029.
  const gradYear = searchParams.get("graduation_year") || "all";
  const setGradYear = (year) => {
    const next = new URLSearchParams(searchParams);
    if (year === "all") next.delete("graduation_year");
    else next.set("graduation_year", String(year));
    setSearchParams(next, { replace: true });
  };

  useEffect(() => {
    api.get("/athletes/grad-years")
      .then((r) => setGradYears(Array.isArray(r.data) ? r.data : null))
      .catch(() => setGradYears(null));
  }, []);

  useEffect(() => {
    const params = { status: "active" };
    if (position !== "all") params.position = position;
    if (gradYear !== "all") params.graduation_year = gradYear;
    setAthletes(null);
    api.get("/athletes", { params }).then((r) => {
      let rows = Array.isArray(r.data) ? r.data : r.data?.athletes || [];
      if (gradYear !== "all") rows = rows.filter((p) => String(p.graduation_year || "") === String(gradYear));
      setAthletes(rows);
    }).catch(() => setAthletes([]));
  }, [position, gradYear]);

  // Org-wide leaderboard (no event filter) for latest overall scores. Roles
  // without report access simply get score-less cards.
  useEffect(() => {
    api.get("/reports/leaderboard").then((r) => {
      const map = {};
      (Array.isArray(r.data) ? r.data : []).forEach((row) => {
        if (row.athlete?.id) map[row.athlete.id] = row;
      });
      setScores(map);
    }).catch(() => setScores({}));
  }, []);

  // Prospect-board order: scored players first (best score first), then the
  // rest alphabetically.
  const board = useMemo(() => {
    if (!athletes) return null;
    return [...athletes].sort((a, b) => {
      const sa = scores[a.id]?.overall_score, sb = scores[b.id]?.overall_score;
      if (sa != null && sb != null) return sb - sa;
      if (sa != null) return -1;
      if (sb != null) return 1;
      return `${a.last_name} ${a.first_name}`.localeCompare(`${b.last_name} ${b.first_name}`);
    });
  }, [athletes, scores]);

  // Enrich the top of the board — plus every watched athlete — via
  // /athletes/compare (verified measurements, per-event trend, video count) in
  // batches of 4. One failed batch (403 for roles without compare access, or
  // endpoint trouble) stops enrichment — cards degrade to roster + leaderboard
  // + watchlist data, never crash.
  useEffect(() => {
    if (!board || enrichBlocked) return;
    const wanted = [...board.slice(0, ENRICH_CAP).map((a) => a.id), ...(watchlist || []).map((w) => w.id)];
    const targets = [...new Set(wanted)].filter((id) => id && !enrichCache.current.has(id));
    if (targets.length === 0) return;
    let cancelled = false;
    (async () => {
      for (let i = 0; i < targets.length; i += ENRICH_BATCH) {
        const batch = targets.slice(i, i + ENRICH_BATCH);
        try {
          const r = await api.post("/athletes/compare", { athlete_ids: batch });
          if (cancelled) return;
          (r.data?.players || []).forEach((p) => { if (p.athlete?.id) enrichCache.current.set(p.athlete.id, p); });
          batch.forEach((id) => { if (!enrichCache.current.has(id)) enrichCache.current.set(id, null); });
          setEnriched(Object.fromEntries(enrichCache.current));
        } catch {
          if (!cancelled) setEnrichBlocked(true);
          return;
        }
      }
    })();
    return () => { cancelled = true; };
  }, [board, watchlist, enrichBlocked]);

  // Star toggle: optimistic flip, then reconcile against the server's list so
  // the Watchlist tab shows the canonical entries (latest_overall, focus, …).
  // Both endpoints are idempotent, so a double-tap is harmless.
  const toggleWatch = useCallback(async (athlete) => {
    const prev = watchlist;
    const isWatched = (prev || []).some((w) => w.id === athlete.id);
    setWatchlist(isWatched ? (prev || []).filter((w) => w.id !== athlete.id) : [...(prev || []), { ...athlete }]);
    try {
      if (isWatched) await api.delete(`/watchlist/${athlete.id}`);
      else await api.post(`/watchlist/${athlete.id}`);
      const r = await api.get("/watchlist");
      if (Array.isArray(r.data)) setWatchlist(r.data);
    } catch (e) {
      setWatchlist(prev);
      toast.error(errMsg(e));
    }
  }, [watchlist]);

  const canWatch = watchAvailable !== false;
  const onToggle = canWatch ? toggleWatch : undefined;

  const discoverPanel = (
    <div className="space-y-4">
      <GradYearChips years={gradYears} selected={gradYear} onSelect={setGradYear} testIdPrefix="scout" />

      {/* Control bar — same h-11 rounded-xl bg-card language as the directory. */}
      <div className="flex flex-wrap items-center gap-2">
        <Select value={position} onValueChange={setPosition}>
          <SelectTrigger className="h-10 sm:h-11 w-auto min-w-[112px] sm:w-[140px] rounded-xl bg-card" data-testid="scout-filter-position"><SelectValue /></SelectTrigger>
          <SelectContent><SelectItem value="all">All positions</SelectItem>{POSITIONS.map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}</SelectContent>
        </Select>
        {board && (
          <p className="text-xs text-muted-foreground">
            {board.length} prospect{board.length === 1 ? "" : "s"}
            {gradYear !== "all" ? ` in the class of ${gradYear}` : ""}
          </p>
        )}
      </div>

      <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Prospect Board</p>

      {!board ? (
        <GridSkeleton />
      ) : board.length === 0 ? (
        <EmptyState icon={Users} title="No prospects match" hint="Adjust the class or position filters, or add players from the directory." />
      ) : (
        <CardGrid testId="scout-prospect-board">
          {board.map((a) => (
            <ProspectCard key={a.id} athlete={a} score={scores[a.id]} payload={enriched[a.id]} watched={watchedIds.has(a.id)} onToggleWatch={onToggle} />
          ))}
        </CardGrid>
      )}
    </div>
  );

  // Endpoint missing → no tabs, no stars: exactly the pre-watchlist board.
  if (!canWatch) {
    return (
      <div className="space-y-4" data-testid="scout-mode-page">
        <ScoutHeader />
        {discoverPanel}
      </div>
    );
  }

  return (
    <div className="space-y-4" data-testid="scout-mode-page">
      <ScoutHeader />

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="rounded-xl">
          <TabsTrigger value="discover" className="rounded-lg" data-testid="scout-tab-discover">Discover</TabsTrigger>
          <TabsTrigger value="watchlist" className="rounded-lg" data-testid="scout-tab-watchlist">
            Watchlist
            {watchlist !== null && (
              <span className="ml-1.5 inline-flex items-center justify-center rounded-full bg-secondary px-1.5 min-w-[20px] h-5 text-[11px] font-mono-num font-bold text-foreground" data-testid="scout-watchlist-count">
                {watchlist.length}
              </span>
            )}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="discover" className="mt-4 space-y-4">
          {discoverPanel}
        </TabsContent>

        <TabsContent value="watchlist" className="mt-4 space-y-4">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Watched Prospects</p>
          {watchlist === null ? (
            <GridSkeleton />
          ) : watchlist.length === 0 ? (
            <EmptyState icon={Star} title="Your watchlist is empty" hint="Star prospects on the Discover board to track them here." />
          ) : (
            <CardGrid testId="scout-watchlist-board">
              {watchlist.map((w) => (
                <ProspectCard key={w.id} athlete={w} score={scores[w.id]} payload={enriched[w.id]} wl={w} watched onToggleWatch={toggleWatch} />
              ))}
            </CardGrid>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}

const ScoutHeader = () => (
  <div className="flex flex-wrap items-end justify-between gap-3">
    <div>
      <p className="text-[10px] uppercase tracking-[0.16em] text-brand font-semibold">60&apos;6&quot; Scout Mode</p>
      <h1 className="font-display text-3xl sm:text-4xl text-foreground mt-1">Prospect Board</h1>
      <p className="text-sm text-muted-foreground mt-1 max-w-xl">
        Every active athlete with verified metrics, evaluation history and trend — filter by class and position.
      </p>
    </div>
    <div className="flex flex-wrap gap-2">
      {ACTIONS.map(({ to, icon: Icon, title, testId }) => (
        <Button key={to} asChild variant="outline" className="rounded-xl h-11" data-testid={testId}>
          <Link to={to}><Icon className="h-4 w-4 mr-1.5" /> {title}</Link>
        </Button>
      ))}
    </div>
  </div>
);
