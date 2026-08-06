import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { api, errMsg } from "@/lib/api";
import { formatPermanentId } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { PlayerAvatar } from "@/components/common/PlayerAvatar";
import { IdRadarChart } from "@/components/common/IdRadarChart";
import { VerificationBadge } from "@/components/common/StatusBadge";
import { toast } from "sonner";
import { ArrowLeft, GitCompare } from "lucide-react";
import {
  ResponsiveContainer, BarChart, Bar, Cell, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
} from "recharts";

// Up to four distinct series colors, all theme tokens (black/white/red system).
const SERIES = [
  "hsl(var(--brand))",
  "hsl(var(--brand-secondary))",
  "hsl(var(--info))",
  "hsl(var(--warning))",
];

// Key verified metrics surfaced as grouped bars. Keys match the backend's
// COMPARE_KEY_METRICS; units differ, so each metric gets its own chart.
const KEY_METRICS = [
  { key: "exit_velocity", label: "Exit Velocity" },
  { key: "throwing_velocity", label: "Throwing Velocity" },
  { key: "sixty_yard_dash", label: "60-Yard Dash" },
];

const shortName = (a) =>
  a ? `${a.first_name?.[0] || ""}. ${a.last_name || ""}`.trim() : "";

const catList = (categoryScores) =>
  Object.entries(categoryScores || {}).map(([category, v]) => ({
    category,
    score: Number(v?.score ?? v ?? 0),
  }));

const TOOLTIP_STYLE = {
  background: "hsl(var(--card))",
  border: "1px solid hsl(var(--border))",
  borderRadius: 12,
  color: "hsl(var(--foreground))",
};

export default function PlayerCompare() {
  const [players, setPlayers] = useState([]);
  const [q, setQ] = useState("");
  const [selected, setSelected] = useState([]);
  const [data, setData] = useState([]); // player payloads from /athletes/compare
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.get("/athletes", { params: { limit: 200 } })
      .then((r) => setPlayers(r.data?.athletes || r.data || []))
      .catch((e) => toast.error(errMsg(e)));
  }, []);

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return players;
    return players.filter((p) =>
      `${p.first_name} ${p.last_name} ${p.primary_position || ""} ${p.age_group || ""}`.toLowerCase().includes(s)
    );
  }, [players, q]);

  const toggle = (id) => {
    setSelected((prev) => {
      if (prev.includes(id)) return prev.filter((x) => x !== id);
      if (prev.length >= 4) {
        toast.error("Compare up to four players.");
        return prev;
      }
      return [...prev, id];
    });
  };

  // One authorized comparison call instead of N per-player summary fetches.
  useEffect(() => {
    let cancelled = false;
    if (selected.length === 0) {
      setData([]);
      return;
    }
    (async () => {
      setBusy(true);
      try {
        const r = await api.post("/athletes/compare", { athlete_ids: selected });
        if (!cancelled) setData(r.data?.players || []);
      } catch (e) {
        if (!cancelled) toast.error(errMsg(e));
      } finally {
        if (!cancelled) setBusy(false);
      }
    })();
    return () => { cancelled = true; };
  }, [selected]);

  // Preserve the picker order; carry the roster row as a fallback for the header.
  const cards = selected.map((id) => ({
    id,
    payload: data.find((p) => p.athlete?.id === id) || null,
    roster: players.find((p) => p.id === id) || null,
  }));

  const loaded = cards.filter((c) => c.payload);

  // Grouped bar: overall evaluation score per player.
  const overallData = loaded.map((c, i) => ({
    name: shortName(c.payload.athlete),
    overall: c.payload.overall_score ?? null,
    color: SERIES[i % SERIES.length],
  }));

  // Multi-series category comparison. Union of category names across players so
  // a category one player lacks still appears (that player just has no bar).
  const categoryData = useMemo(() => {
    const names = [];
    loaded.forEach((c) => {
      Object.keys(c.payload.category_scores || {}).forEach((n) => {
        if (!names.includes(n)) names.push(n);
      });
    });
    return names.map((category) => {
      const row = { category };
      loaded.forEach((c) => {
        const v = c.payload.category_scores?.[category]?.score;
        row[c.id] = v != null ? Number(v) : null;
      });
      return row;
    });
  }, [loaded]);

  const overlayRadar = () => {
    // 1–2 players: the signature radar (2nd player overlaid as the benchmark
    // series). >2 players fall back to the grouped bar below.
    const a = loaded[0], b = loaded[1];
    const data0 = catList(a.payload.category_scores);
    if (data0.length < 3) return null;
    return (
      <IdRadarChart
        data={data0}
        benchmarkData={b ? catList(b.payload.category_scores) : null}
        height={300}
      />
    );
  };

  const metricValue = (payload, key) =>
    payload?.measurements?.find((m) => m.metric_key === key) || null;

  return (
    <div className="space-y-5" data-testid="player-compare-page">
      <div className="flex items-start gap-3">
        <Button variant="ghost" size="icon" asChild className="mt-1">
          <Link to="/scout"><ArrowLeft className="h-5 w-5" /></Link>
        </Button>
        <div>
          <p className="text-[10px] uppercase tracking-[0.16em] text-brand font-semibold flex items-center gap-1">
            <GitCompare className="h-3 w-3" /> Scout Mode
          </p>
          <h1 className="font-display text-4xl text-foreground">Compare Players</h1>
          <p className="text-sm text-muted-foreground">Select up to four athletes for a visual side-by-side.</p>
        </div>
      </div>

      <Input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Search players…"
        className="h-11 rounded-xl max-w-md"
        data-testid="compare-search"
      />

      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3 max-h-56 overflow-y-auto rounded-2xl border border-border p-3">
        {filtered.map((p) => (
          <label key={p.id} className="flex items-center gap-2 rounded-xl px-2 py-2 hover:bg-secondary cursor-pointer">
            <Checkbox checked={selected.includes(p.id)} onCheckedChange={() => toggle(p.id)} />
            <PlayerAvatar firstName={p.first_name} lastName={p.last_name} photoUrl={p.photo_url} size="sm" />
            <div className="min-w-0">
              <p className="text-sm font-semibold truncate">{p.first_name} {p.last_name}</p>
              <p className="text-[11px] text-muted-foreground">{p.age_group} · {p.primary_position}</p>
            </div>
          </label>
        ))}
      </div>

      {selected.length > 0 && (
        <>
          {/* Side-by-side player cards */}
          <div className={`grid gap-3 ${selected.length === 1 ? "grid-cols-1" : selected.length === 2 ? "md:grid-cols-2" : "md:grid-cols-2 xl:grid-cols-4"}`}>
            {cards.map(({ id, payload, roster }) => {
              const a = payload?.athlete || roster;
              if (!a) return null;
              return (
                <Card key={id} className="rounded-2xl border-border overflow-hidden" data-testid="compare-card">
                  <div className="h-36 bg-surface-3 relative">
                    {a.photo_url && a.photo_url.startsWith("http") ? (
                      <img src={a.photo_url} alt="" className="absolute inset-0 w-full h-full object-cover opacity-80" />
                    ) : null}
                    <div className="absolute inset-0 bg-gradient-to-t from-background via-background/40 to-transparent" />
                    <div className="absolute bottom-3 left-3 right-3 flex items-end gap-3">
                      <PlayerAvatar firstName={a.first_name} lastName={a.last_name} photoUrl={a.photo_url} size="lg" />
                      <div className="min-w-0">
                        <Link to={`/players/${id}`} className="font-semibold text-foreground hover:underline">
                          {a.first_name} {a.last_name}
                        </Link>
                        <p className="text-xs text-muted-foreground">{a.primary_position || "—"} · {a.age_group || "—"}</p>
                        <p className="text-[10px] font-mono-num uppercase tracking-wide text-brand">
                          {formatPermanentId(id)}
                        </p>
                      </div>
                    </div>
                  </div>
                  <CardContent className="pt-4 pb-4 space-y-3">
                    <div className="grid grid-cols-3 gap-2 text-center">
                      <div className="rounded-xl bg-secondary px-2 py-2">
                        <p className="text-xl font-bold font-mono-num">{payload?.overall_score ?? "—"}</p>
                        <p className="text-[10px] text-muted-foreground uppercase">Overall</p>
                      </div>
                      <div className="rounded-xl bg-secondary px-2 py-2">
                        <p className="text-xl font-bold font-mono-num">{payload?.evaluation_count ?? "—"}</p>
                        <p className="text-[10px] text-muted-foreground uppercase">Evals</p>
                      </div>
                      <div className="rounded-xl bg-secondary px-2 py-2">
                        <p className="text-xl font-bold font-mono-num">{payload?.video_count ?? "—"}</p>
                        <p className="text-[10px] text-muted-foreground uppercase">Videos</p>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-2 text-center text-[11px] text-muted-foreground">
                      <div className="rounded-xl bg-secondary/60 px-2 py-1.5">
                        <p className="text-foreground font-semibold">{a.height || "—"}</p>
                        <p className="uppercase">Height</p>
                      </div>
                      <div className="rounded-xl bg-secondary/60 px-2 py-1.5">
                        <p className="text-foreground font-semibold">{a.weight || "—"}</p>
                        <p className="uppercase">Weight</p>
                      </div>
                      <div className="rounded-xl bg-secondary/60 px-2 py-1.5">
                        <p className="text-foreground font-semibold">{a.bats || "—"}/{a.throws || "—"}</p>
                        <p className="uppercase">Bats/Throws</p>
                      </div>
                      <div className="rounded-xl bg-secondary/60 px-2 py-1.5">
                        <p className="text-foreground font-semibold">{a.graduation_year || "—"}</p>
                        <p className="uppercase">Grad</p>
                      </div>
                    </div>

                    {/* Verified measurements — trust source shown, never a guessed value */}
                    <div className="space-y-1.5">
                      <p className="text-[10px] uppercase tracking-wide text-muted-foreground font-semibold">Verified Measurements</p>
                      {payload?.measurements?.length ? (
                        payload.measurements.map((m) => (
                          <div key={m.metric_key} className="flex items-center justify-between gap-2">
                            <span className="text-xs text-muted-foreground truncate">{m.label}</span>
                            <span className="flex items-center gap-1.5 shrink-0">
                              <span className="text-sm font-semibold font-mono-num">
                                {m.value != null ? `${m.value}${m.unit ? ` ${m.unit}` : ""}` : "—"}
                              </span>
                              <VerificationBadge source={m.source} compact />
                            </span>
                          </div>
                        ))
                      ) : (
                        <p className="text-xs text-muted-foreground">{busy && !payload ? "Loading…" : "No verified measurements."}</p>
                      )}
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>

          {/* Category comparison: radar for ≤2 players, grouped bar for >2 */}
          {loaded.length > 0 && (
            <Card className="rounded-2xl border-border">
              <CardContent className="pt-5 pb-5">
                <p className="text-sm font-semibold mb-3">Category scores</p>
                {loaded.length <= 2 ? (
                  <>
                    {overlayRadar() || (
                      <p className="text-xs text-muted-foreground">Need at least 3 scored categories for the radar.</p>
                    )}
                    {loaded.length === 2 && (
                      <p className="mt-2 text-[11px] text-muted-foreground">
                        <span className="text-brand font-semibold">{shortName(loaded[0].payload.athlete)}</span>
                        {" vs "}
                        <span className="font-semibold">{shortName(loaded[1].payload.athlete)}</span> (dashed)
                      </p>
                    )}
                  </>
                ) : (
                  <div className="h-72" data-testid="category-bar">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={categoryData}>
                        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                        <XAxis dataKey="category" stroke="hsl(var(--muted-foreground))" fontSize={12} />
                        <YAxis domain={[0, 10]} stroke="hsl(var(--muted-foreground))" fontSize={12} />
                        <Tooltip contentStyle={TOOLTIP_STYLE} />
                        <Legend />
                        {loaded.map((c, i) => (
                          <Bar
                            key={c.id}
                            dataKey={c.id}
                            name={shortName(c.payload.athlete)}
                            fill={SERIES[i % SERIES.length]}
                            radius={[6, 6, 0, 0]}
                          />
                        ))}
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {/* Overall score grouped bar */}
          {overallData.length >= 2 && (
            <Card className="rounded-2xl border-border">
              <CardContent className="pt-5 pb-5">
                <p className="text-sm font-semibold mb-3">Overall evaluation score</p>
                <div className="h-56" data-testid="overall-bar">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={overallData}>
                      <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                      <XAxis dataKey="name" stroke="hsl(var(--muted-foreground))" fontSize={12} />
                      <YAxis domain={[0, 10]} stroke="hsl(var(--muted-foreground))" fontSize={12} />
                      <Tooltip contentStyle={TOOLTIP_STYLE} />
                      <Bar dataKey="overall" name="Overall" radius={[6, 6, 0, 0]}>
                        {overallData.map((d) => (
                          <Cell key={d.name} fill={d.color} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Key verified metrics — one grouped bar per metric (units differ) */}
          {loaded.length >= 2 && (
            <div className="grid gap-3 md:grid-cols-3">
              {KEY_METRICS.map((km) => {
                const rows = loaded.map((c, i) => {
                  const m = metricValue(c.payload, km.key);
                  return {
                    name: shortName(c.payload.athlete),
                    value: m?.value != null ? Number(m.value) : null,
                    unit: m?.unit || "",
                    color: SERIES[i % SERIES.length],
                  };
                });
                if (!rows.some((r) => r.value != null)) return null;
                const unit = rows.find((r) => r.unit)?.unit || "";
                return (
                  <Card key={km.key} className="rounded-2xl border-border">
                    <CardContent className="pt-5 pb-5">
                      <p className="text-sm font-semibold mb-3">{km.label}{unit ? ` (${unit})` : ""}</p>
                      <div className="h-48">
                        <ResponsiveContainer width="100%" height="100%">
                          <BarChart data={rows}>
                            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                            <XAxis dataKey="name" stroke="hsl(var(--muted-foreground))" fontSize={11} />
                            <YAxis stroke="hsl(var(--muted-foreground))" fontSize={11} />
                            <Tooltip contentStyle={TOOLTIP_STYLE} />
                            <Bar dataKey="value" name={km.label} radius={[6, 6, 0, 0]}>
                              {rows.map((d) => (
                                <Cell key={d.name} fill={d.color} />
                              ))}
                            </Bar>
                          </BarChart>
                        </ResponsiveContainer>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </>
      )}
    </div>
  );
}
