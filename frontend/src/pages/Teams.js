import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "@/lib/api";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/common/EmptyState";
import { ChevronRight, Flag, Search, Shield, TrendingUp, Users } from "lucide-react";

/*
  Teams — derived view over athletes' `current_team` (no schema change).
  Data comes from GET /teams; when that endpoint is missing (404) or returns
  nothing, we explain that teams appear once athletes have a team set rather
  than inventing numbers. avg_score is usually null (evals carry raw metrics
  only) — cards say "No scored evaluations yet." instead of showing a dash.
*/

const fmtScore = (v) => {
  if (v === null || v === undefined || v === "" || Number.isNaN(Number(v))) return "—";
  const n = Number(v);
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
};

// "2027–2033" for a spread, "2029" for a single class, null when unknown.
const gradYearRange = (years) => {
  const ys = (Array.isArray(years) ? years : [])
    .map((y) => parseInt(y, 10))
    .filter((y) => !Number.isNaN(y))
    .sort((a, b) => a - b);
  if (ys.length === 0) return null;
  return ys[0] === ys[ys.length - 1] ? `${ys[0]}` : `${ys[0]}–${ys[ys.length - 1]}`;
};

const teamInitials = (team) =>
  (team || "").split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join("").toUpperCase() || "?";

export default function Teams() {
  const [teams, setTeams] = useState([]);
  const [loading, setLoading] = useState(true);
  const [unavailable, setUnavailable] = useState(false); // endpoint 404/error
  const [search, setSearch] = useState("");

  useEffect(() => {
    let cancelled = false;
    api
      .get("/teams")
      .then((r) => {
        if (cancelled) return;
        setTeams(Array.isArray(r.data) ? r.data : []);
      })
      .catch(() => {
        if (cancelled) return;
        setTeams([]);
        setUnavailable(true);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return teams;
    return teams.filter((t) => (t.team || "").toLowerCase().includes(q));
  }, [teams, search]);

  const totalAthletes = useMemo(
    () => teams.reduce((sum, t) => sum + (Number(t.athlete_count) || 0), 0),
    [teams]
  );

  return (
    <div className="space-y-4" data-testid="teams-page">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-3xl sm:text-4xl text-foreground">Teams</h1>
          <p className="text-sm text-muted-foreground">
            {loading
              ? "Loading…"
              : `${teams.length} team${teams.length === 1 ? "" : "s"} · ${totalAthletes} athlete${totalAthletes === 1 ? "" : "s"}`}
          </p>
        </div>
      </div>

      {!loading && teams.length > 0 && (
        <div className="relative max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search teams…"
            className="pl-9 h-11 rounded-xl bg-card"
            data-testid="teams-search-input"
          />
        </div>
      )}

      {loading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {[...Array(6)].map((_, i) => (
            <Skeleton key={i} className="h-44 rounded-2xl" />
          ))}
        </div>
      ) : teams.length === 0 ? (
        <EmptyState
          icon={Shield}
          title="No teams yet"
          hint={
            unavailable
              ? "Teams could not be loaded. They appear automatically once athletes in the directory have a team set on their profile."
              : "Teams appear automatically once athletes in the directory have a team set on their profile."
          }
        />
      ) : filtered.length === 0 ? (
        <EmptyState icon={Search} title="No teams match" hint="Try a different search." />
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3" data-testid="teams-grid">
          {filtered.map((t, index) => {
            const range = gradYearRange(t.grad_years);
            const hasAvg = t.avg_score !== null && t.avg_score !== undefined && t.avg_score !== "";
            const count = t.athlete_count ?? null;
            return (
              <Link
                key={t.team || index}
                to={`/teams/${encodeURIComponent(t.team)}`}
                className="block h-full"
                data-testid={`team-card-${index}`}
              >
                <Card className="h-full rounded-2xl border-border transition-all hover:border-brand/50 hover:shadow-lg hover:-translate-y-0.5">
                  <CardContent className="p-5 space-y-4">
                    {/* Identity row — monogram square, name, roster line */}
                    <div className="flex items-start gap-3">
                      <div className="relative flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-gradient-to-br from-brand-tertiary via-secondary to-background">
                        <span className="select-none font-display text-xl text-brand/70">{teamInitials(t.team)}</span>
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="font-display text-xl text-foreground leading-tight break-words">{t.team}</p>
                        <p className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground">
                          <Users className="h-3.5 w-3.5 shrink-0" />
                          <span className="font-mono-num font-semibold text-foreground">{count ?? "–"}</span>
                          athlete{count === 1 ? "" : "s"}
                          {range ? <span className="font-mono-num">· {range}</span> : null}
                        </p>
                      </div>
                      <ChevronRight className="h-4 w-4 text-muted-foreground mt-1 shrink-0" />
                    </div>

                    {/* Score band — real chip only when the team has a scored eval */}
                    <div className="flex min-h-[44px] items-center justify-between gap-2 rounded-xl bg-secondary px-3 py-2">
                      <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                        Team Avg
                      </span>
                      {hasAvg ? (
                        <span className="rounded-lg bg-success px-2.5 py-1 font-mono-num text-lg font-bold leading-none text-white">
                          {fmtScore(t.avg_score)}
                        </span>
                      ) : (
                        <span className="text-xs text-muted-foreground">No scored evaluations yet.</span>
                      )}
                    </div>

                    {(Number(t.improving) > 0 || Number(t.follow_up) > 0) && (
                      <div className="flex flex-wrap items-center gap-2">
                        {Number(t.improving) > 0 && (
                          <span className="inline-flex items-center gap-1 rounded-full bg-success/15 border border-success/40 px-2.5 py-0.5 text-xs font-semibold text-success">
                            <TrendingUp className="h-3 w-3" /> {t.improving} improving
                          </span>
                        )}
                        {Number(t.follow_up) > 0 && (
                          <span className="inline-flex items-center gap-1 rounded-full bg-warning/15 border border-warning/40 px-2.5 py-0.5 text-xs font-semibold text-warning">
                            <Flag className="h-3 w-3" /> {t.follow_up} follow-up
                          </span>
                        )}
                      </div>
                    )}
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
