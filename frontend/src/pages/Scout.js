import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/common/EmptyState";
import { PlayerAvatar } from "@/components/common/PlayerAvatar";
import { VerificationBadge, isVerifiedSource } from "@/components/common/StatusBadge";
import { GradYearChips } from "@/pages/PlayersList";
import { cn } from "@/lib/utils";
import {
  ClipboardList, GitCompare, Flag, ArrowRight, ArrowUpRight, ArrowDownRight,
  Users, Video, ClipboardCheck,
} from "lucide-react";

const POSITIONS = ["P", "C", "1B", "2B", "3B", "SS", "LF", "CF", "RF"];

// Quick links kept from the previous Scout landing — same routes, same testids.
const ACTIONS = [
  { to: "/review", icon: ClipboardList, title: "Review Queue", testId: "scout-review-link" },
  { to: "/scout/compare", icon: GitCompare, title: "Compare Players", testId: "scout-compare-link" },
  { to: "/reports", icon: Flag, title: "Rankings & Reports", testId: "scout-reports-link" },
];

// Verified metrics surfaced as chips on a card, in preference order. Matches
// the backend's COMPARE_KEY_METRICS naming (see PlayerCompare).
const CHIP_METRIC_ORDER = ["exit_velocity", "throwing_velocity", "sixty_yard_dash"];

// How many cards get the (heavier) /athletes/compare enrichment — verified
// metrics, per-event trend and video counts. Cards beyond the cap still show
// roster info and the leaderboard score.
const ENRICH_CAP = 24;
const ENRICH_BATCH = 4; // backend hard limit per compare call

// Latest-vs-previous event change from a compare payload's progress_series.
// Returns null unless at least two scored event dates exist — a trend is
// never invented from a single evaluation.
const trendOf = (payload) => {
  const pts = (payload?.progress_series || []).filter((p) => p.overall_score !== null && p.overall_score !== undefined);
  if (pts.length < 2) return null;
  const change = Number(pts[pts.length - 1].overall_score) - Number(pts[pts.length - 2].overall_score);
  return Math.round(change * 10) / 10;
};

// Up to two measurement chips, verified sources first, key metrics first.
const chipMetrics = (payload) => {
  const ms = payload?.measurements || [];
  const rankKey = (m) => {
    const i = CHIP_METRIC_ORDER.indexOf(m.metric_key);
    return i === -1 ? CHIP_METRIC_ORDER.length : i;
  };
  return [...ms]
    .sort((a, b) => (isVerifiedSource(b.source) - isVerifiedSource(a.source)) || (rankKey(a) - rankKey(b)))
    .slice(0, 2);
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

const ProspectCard = ({ athlete, score, payload }) => {
  const overall = payload?.overall_score ?? score?.overall_score ?? null;
  const evalCount = payload?.evaluation_count ?? score?.evaluation_count ?? null;
  const change = trendOf(payload);
  const chips = chipMetrics(payload);
  return (
    <Card className="rounded-2xl border-border hover:border-brand/50 transition-colors" data-testid={`scout-prospect-card-${athlete.id}`}>
      <CardContent className="pt-4 pb-4 space-y-3">
        <div className="flex items-start gap-3">
          <PlayerAvatar firstName={athlete.first_name} lastName={athlete.last_name} photoUrl={athlete.photo_url} />
          <div className="flex-1 min-w-0">
            <Link to={`/players/${athlete.id}`} className="font-semibold text-foreground hover:underline block truncate">
              {athlete.first_name} {athlete.last_name}
            </Link>
            <p className="text-xs text-muted-foreground">
              {athlete.graduation_year ? `Class of ${athlete.graduation_year}` : "No grad year"} · {athlete.primary_position || "—"}
            </p>
          </div>
          <div className="text-right shrink-0">
            <p className="font-mono-num text-2xl font-bold text-brand leading-none">{overall ?? "—"}</p>
            <div className="mt-1 flex items-center justify-end gap-1.5">
              <TrendArrow change={change} />
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-1.5 min-h-[22px]">
          {chips.length > 0 ? chips.map((m) => (
            <span key={m.metric_key} className="inline-flex items-center gap-1.5 rounded-full bg-secondary px-2.5 py-0.5 text-[11px] font-medium">
              <span className="text-muted-foreground">{m.label}</span>
              <span className="font-mono-num font-bold text-foreground">
                {m.value != null ? `${m.value}${m.unit ? ` ${m.unit}` : ""}` : "—"}
              </span>
              <VerificationBadge source={m.source} compact />
            </span>
          )) : (
            <span className="text-[11px] text-muted-foreground">No verified measurements on file.</span>
          )}
        </div>

        <div className="flex items-center justify-between border-t border-border pt-2.5">
          <div className="flex items-center gap-3 text-[11px] text-muted-foreground">
            <span className="inline-flex items-center gap-1"><ClipboardCheck className="h-3.5 w-3.5" />{evalCount ?? "—"} eval{evalCount === 1 ? "" : "s"}</span>
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

export default function Scout() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [gradYears, setGradYears] = useState(null);
  const [position, setPosition] = useState("all");
  const [athletes, setAthletes] = useState(null); // null = loading
  const [scores, setScores] = useState({}); // athlete id → leaderboard row
  const [enriched, setEnriched] = useState({}); // athlete id → compare payload
  const [enrichBlocked, setEnrichBlocked] = useState(false);
  const enrichCache = useRef(new Map());

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

  // Enrich the top of the board via /athletes/compare (verified measurements,
  // per-event trend, video count) in batches of 4. One failed batch (403 for
  // roles without compare access, or endpoint trouble) stops enrichment —
  // cards degrade to roster + leaderboard data, never crash.
  useEffect(() => {
    if (!board || enrichBlocked) return;
    const targets = board.slice(0, ENRICH_CAP).map((a) => a.id).filter((id) => !enrichCache.current.has(id));
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
  }, [board, enrichBlocked]);

  return (
    <div className="space-y-4" data-testid="scout-mode-page">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-[10px] uppercase tracking-[0.16em] text-brand font-semibold">60&apos;6&quot; Scout Mode</p>
          <h1 className="font-display text-4xl text-foreground mt-1">Prospect Board</h1>
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

      <GradYearChips years={gradYears} selected={gradYear} onSelect={setGradYear} testIdPrefix="scout" />

      <div className="flex flex-wrap items-center gap-2">
        <Select value={position} onValueChange={setPosition}>
          <SelectTrigger className="w-[140px] h-11 rounded-xl bg-card" data-testid="scout-filter-position"><SelectValue /></SelectTrigger>
          <SelectContent><SelectItem value="all">All positions</SelectItem>{POSITIONS.map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}</SelectContent>
        </Select>
        {board && (
          <p className="text-xs text-muted-foreground">
            {board.length} prospect{board.length === 1 ? "" : "s"}
            {gradYear !== "all" ? ` in the class of ${gradYear}` : ""}
          </p>
        )}
      </div>

      {!board ? (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">{[...Array(6)].map((_, i) => <Skeleton key={i} className="h-44 rounded-2xl" />)}</div>
      ) : board.length === 0 ? (
        <EmptyState icon={Users} title="No prospects match" hint="Adjust the class or position filters, or add players from the directory." />
      ) : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3" data-testid="scout-prospect-board">
          {board.map((a) => (
            <ProspectCard key={a.id} athlete={a} score={scores[a.id]} payload={enriched[a.id]} />
          ))}
        </div>
      )}
    </div>
  );
}
