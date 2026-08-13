import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "@/lib/api";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/common/EmptyState";
import { Search, Shield, Users, TrendingUp, Flag, ChevronRight } from "lucide-react";

/*
  Teams — derived view over athletes' `current_team` (no schema change).
  Data comes from GET /teams; when that endpoint is missing (404) or returns
  nothing, we explain that teams appear once athletes have a team set rather
  than inventing numbers.
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

  return (
    <div className="space-y-4" data-testid="teams-page">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-4xl text-foreground">Teams</h1>
          <p className="text-sm text-muted-foreground">
            {loading ? "Loading…" : `${teams.length} team${teams.length === 1 ? "" : "s"}`}
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
            <Skeleton key={i} className="h-40 rounded-2xl" />
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
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {filtered.map((t, index) => {
            const range = gradYearRange(t.grad_years);
            return (
              <Link
                key={t.team || index}
                to={`/teams/${encodeURIComponent(t.team)}`}
                data-testid={`team-card-${index}`}
              >
                <Card className="rounded-2xl border-border h-full hover:border-brand/50 active:scale-[0.99] transition">
                  <CardContent className="p-5 space-y-3">
                    <div className="flex items-start justify-between gap-2">
                      <p className="font-display text-2xl text-foreground leading-tight break-words">
                        {t.team}
                      </p>
                      <ChevronRight className="h-4 w-4 text-muted-foreground mt-1 shrink-0" />
                    </div>

                    <div className="flex items-end gap-6">
                      <div>
                        <p className="text-xs text-muted-foreground">Athletes</p>
                        <p className="text-xl font-bold font-mono-num text-foreground flex items-center gap-1.5">
                          <Users className="h-4 w-4 text-muted-foreground" />
                          {t.athlete_count ?? "—"}
                        </p>
                      </div>
                      <div>
                        <p className="text-xs text-muted-foreground">Avg score</p>
                        <p className="text-xl font-bold font-mono-num text-foreground">
                          {fmtScore(t.avg_score)}
                        </p>
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                      {range && (
                        <span className="inline-flex items-center rounded-full border border-border bg-secondary px-2.5 py-0.5 text-xs font-semibold font-mono-num text-foreground">
                          {range}
                        </span>
                      )}
                      <span className="inline-flex items-center gap-1 rounded-full bg-success/15 border border-success/40 px-2.5 py-0.5 text-xs font-semibold text-success">
                        <TrendingUp className="h-3 w-3" /> {t.improving ?? 0} improving
                      </span>
                      <span className="inline-flex items-center gap-1 rounded-full bg-warning/15 border border-warning/40 px-2.5 py-0.5 text-xs font-semibold text-warning">
                        <Flag className="h-3 w-3" /> {t.follow_up ?? 0} follow-up
                      </span>
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
