import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { api, errMsg } from "@/lib/api";
import { cn, formatPermanentId } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { PlayerAvatar, resolvePhotoSrc } from "@/components/common/PlayerAvatar";
import { IdRadarChart } from "@/components/common/IdRadarChart";
import { VerificationBadge } from "@/components/common/StatusBadge";
import { toast } from "sonner";
import { ArrowLeft, Check, GitCompare, Search } from "lucide-react";
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

// Which direction "better" points for a metric row. Anything not listed gets
// no winner highlight — a best value is never invented for an unknown metric.
const HIGHER_IS_BETTER = new Set(["exit_velocity", "throwing_velocity"]);
const LOWER_IS_BETTER = new Set(["sixty_yard_dash"]); // it's a time

// Indices holding the best numeric value for a row. Empty set when fewer than
// two comparable numbers exist, when the direction is unknown, or when every
// value ties — no winner is declared in those cases.
const winnerSet = (values, dir) => {
  if (!dir) return new Set();
  const nums = values.map((v) => {
    const n = v === null || v === undefined || v === "" ? NaN : Number(v);
    return Number.isFinite(n) ? n : null;
  });
  const present = nums.filter((n) => n !== null);
  if (present.length < 2) return new Set();
  const best = dir === "high" ? Math.max(...present) : Math.min(...present);
  const worst = dir === "high" ? Math.min(...present) : Math.max(...present);
  if (best === worst) return new Set(); // all tied — nobody "wins"
  return new Set(nums.map((n, i) => (n === best ? i : -1)).filter((i) => i >= 0));
};

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

/* Photo header for the picker card — same idiom as the Athletes directory and
   Scout (CardPhoto isn't exported from either, so it's re-declared here at
   module level). Real photo when the athlete has one, otherwise a branded
   monogram panel with a faded position watermark, so the many photo-less
   athletes on a roster still look intentional rather than broken. */
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

/* One selectable athlete card in the picker. The whole card is the toggle;
   `disabled` is the max-four cap biting on an unselected card, in which case
   clicks and keyboard activation are ignored. The roster payload carries no
   evaluation score, so this card deliberately has no score chip — an empty
   "—" chip would read as a real (zero) score. */
const PickerCard = ({ p, checked, disabled, onToggle }) => {
  const classLine = [p.graduation_year ? `Class of ${p.graduation_year}` : null, p.age_group || null]
    .filter(Boolean)
    .join(" · ");
  const activate = () => { if (!disabled) onToggle(p.id); };
  return (
    <Card
      role="button"
      tabIndex={disabled ? -1 : 0}
      aria-pressed={checked}
      aria-disabled={disabled || undefined}
      onClick={activate}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") { e.preventDefault(); activate(); }
      }}
      className={cn(
        "h-full overflow-hidden rounded-2xl transition-all",
        checked
          ? "border-brand ring-2 ring-brand/50"
          : "border-border hover:border-brand/50 hover:shadow-lg hover:-translate-y-0.5",
        disabled ? "cursor-not-allowed opacity-50" : "cursor-pointer"
      )}
      data-testid={`compare-player-card-${p.id}`}
    >
      <div className="relative aspect-[4/3] w-full overflow-hidden">
        <CardPhoto p={p} />
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-14 bg-gradient-to-t from-black/55 to-transparent" />
        {/* Selection affordance: filled brand check when picked, hollow ring otherwise. */}
        <span
          aria-hidden="true"
          className={cn(
            "absolute right-2 top-2 flex h-7 w-7 items-center justify-center rounded-full border-2 transition-colors",
            checked
              ? "border-brand bg-brand text-white shadow-md"
              : "border-white/85 bg-black/30 backdrop-blur-sm"
          )}
        >
          {checked && <Check className="h-4 w-4" strokeWidth={3} />}
        </span>
      </div>
      <CardContent className="p-4 pt-3">
        <div className="min-w-0">
          <p className="font-display text-lg leading-tight text-foreground truncate">
            {p.first_name} {p.last_name}
          </p>
          <p className="text-xs text-muted-foreground truncate">
            {p.primary_position || "—"} · {p.bats || "—"}/{p.throws || "—"}
          </p>
          {classLine && <p className="text-xs text-muted-foreground truncate">{classLine}</p>}
        </div>
      </CardContent>
    </Card>
  );
};

/* Sticky first column of the comparison table: the metric name, kept visible
   while the athlete columns scroll horizontally on narrow screens. */
const MetricLabelCell = ({ children }) => (
  <th
    scope="row"
    className="sticky left-0 z-10 whitespace-nowrap rounded-l-xl bg-card px-3.5 py-2.5 text-left text-[10px] font-semibold uppercase tracking-wide text-muted-foreground"
  >
    {children}
  </th>
);

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

  // Union of measurement keys across the loaded players, in first-seen order,
  // so a metric one player lacks still gets a row (the others just show "–").
  const measurementRows = useMemo(() => {
    const rows = [];
    loaded.forEach((c) => {
      (c.payload.measurements || []).forEach((m) => {
        if (!rows.some((r) => r.key === m.metric_key)) rows.push({ key: m.metric_key, label: m.label });
      });
    });
    return rows;
  }, [loaded]);

  // Grouped bar: overall evaluation score per player.
  const overallData = loaded.map((c, i) => ({
    name: shortName(c.payload.athlete),
    overall: c.payload.overall_score ?? null,
    color: SERIES[i % SERIES.length],
  }));
  const hasOverallScores = overallData.some((d) => d.overall !== null && d.overall !== undefined);

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

  // ---- comparison table rows -----------------------------------------------
  // Each column: { id, payload, roster, a } where `a` prefers the compare
  // payload's athlete but falls back to the roster row while loading.
  const cols = cards.map((c) => ({ ...c, a: c.payload?.athlete || c.roster }));

  const overallWinners = winnerSet(cols.map((c) => c.payload?.overall_score), "high");

  const numCell = (i, winners) =>
    cn("bg-card px-3.5 py-2.5 text-sm font-mono-num last:rounded-r-xl",
      winners?.has(i) ? "text-success font-semibold" : "text-foreground");

  const textCell = "bg-card px-3.5 py-2.5 text-sm text-foreground last:rounded-r-xl";

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

      {/* Picker: search + a selectable grid of the app's standard athlete card. */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative min-w-[200px] flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search players…"
            className="h-11 rounded-xl bg-card pl-9"
            data-testid="compare-search"
          />
        </div>
        <p className="text-xs font-semibold text-muted-foreground" data-testid="compare-selected-count">
          <span className="font-mono-num text-foreground">{selected.length}</span> of 4 selected
        </p>
        {selected.length > 0 && (
          <Button
            variant="outline"
            className="h-11 rounded-xl"
            onClick={() => setSelected([])}
            data-testid="compare-clear"
          >
            Clear
          </Button>
        )}
      </div>

      {/* Capped at four, so unselected cards go inert once the cap is reached. */}
      <div className="max-h-[70vh] overflow-y-auto pr-1">
        {filtered.length === 0 ? (
          <p className="py-6 text-sm text-muted-foreground">No players match “{q.trim()}”.</p>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3" data-testid="compare-player-grid">
            {filtered.map((p) => {
              const checked = selected.includes(p.id);
              return (
                <PickerCard
                  key={p.id}
                  p={p}
                  checked={checked}
                  disabled={!checked && selected.length >= 4}
                  onToggle={toggle}
                />
              );
            })}
          </div>
        )}
      </div>

      {selected.length > 0 && (
        <>
          {/* Side-by-side comparison table — athlete columns, striped metric
              rows, best value per row in success green when a winner exists. */}
          <div>
            <p className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Side by Side</p>
            <div className="overflow-x-auto rounded-2xl" data-testid="compare-table">
              <table className="w-full border-separate [border-spacing:0_6px]">
                <thead>
                  <tr>
                    <th className="sticky left-0 z-10 bg-background" aria-hidden="true" />
                    {cols.map(({ id, a }) => a && (
                      <th key={id} className="min-w-[170px] px-3.5 pb-1 text-left align-bottom font-normal" data-testid="compare-card">
                        <div className="flex items-center gap-3">
                          <PlayerAvatar firstName={a.first_name} lastName={a.last_name} photoUrl={a.photo_url} size="lg" />
                          <div className="min-w-0">
                            <Link to={`/players/${id}`} className="font-display text-base leading-tight text-foreground hover:underline block truncate">
                              {a.first_name} {a.last_name}
                            </Link>
                            <p className="text-[11px] text-muted-foreground truncate">
                              {a.graduation_year ? `Class of ${a.graduation_year}` : "No grad year"} · {a.primary_position || "—"}
                            </p>
                            <p className="text-[10px] font-mono-num uppercase tracking-wide text-brand truncate">
                              {formatPermanentId(id)}
                            </p>
                          </div>
                        </div>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  <tr data-testid="compare-row-overall">
                    <MetricLabelCell>Overall Score</MetricLabelCell>
                    {cols.map((c, i) => (
                      <td key={c.id} className={numCell(i, overallWinners)}>
                        {c.payload?.overall_score !== null && c.payload?.overall_score !== undefined ? (
                          c.payload.overall_score
                        ) : (
                          <span className="font-sans text-xs text-muted-foreground">
                            {c.payload ? ((c.payload.evaluation_count ?? 0) > 0 ? "Evaluated · metrics on file" : "No eval yet") : (busy ? "Loading…" : "–")}
                          </span>
                        )}
                      </td>
                    ))}
                  </tr>
                  <tr data-testid="compare-row-evals">
                    <MetricLabelCell>Evaluations</MetricLabelCell>
                    {cols.map((c, i) => (
                      <td key={c.id} className={numCell(i)}>
                        {c.payload?.evaluation_count ?? <span className="font-sans text-xs text-muted-foreground">–</span>}
                      </td>
                    ))}
                  </tr>
                  <tr data-testid="compare-row-videos">
                    <MetricLabelCell>Videos</MetricLabelCell>
                    {cols.map((c, i) => (
                      <td key={c.id} className={numCell(i)}>
                        {c.payload?.video_count ?? <span className="font-sans text-xs text-muted-foreground">–</span>}
                      </td>
                    ))}
                  </tr>
                  <tr data-testid="compare-row-height">
                    <MetricLabelCell>Height</MetricLabelCell>
                    {cols.map((c) => <td key={c.id} className={textCell}>{c.a?.height || "–"}</td>)}
                  </tr>
                  <tr data-testid="compare-row-weight">
                    <MetricLabelCell>Weight</MetricLabelCell>
                    {cols.map((c) => <td key={c.id} className={textCell}>{c.a?.weight || "–"}</td>)}
                  </tr>
                  <tr data-testid="compare-row-bats-throws">
                    <MetricLabelCell>Bats / Throws</MetricLabelCell>
                    {cols.map((c) => (
                      <td key={c.id} className={cn(textCell, "font-mono-num")}>{c.a?.bats || "–"}/{c.a?.throws || "–"}</td>
                    ))}
                  </tr>
                  <tr data-testid="compare-row-grad">
                    <MetricLabelCell>Grad Year</MetricLabelCell>
                    {cols.map((c) => (
                      <td key={c.id} className={cn(textCell, "font-mono-num")}>{c.a?.graduation_year || "–"}</td>
                    ))}
                  </tr>
                  {measurementRows.map(({ key, label }) => {
                    const dir = HIGHER_IS_BETTER.has(key) ? "high" : LOWER_IS_BETTER.has(key) ? "low" : null;
                    const winners = winnerSet(cols.map((c) => metricValue(c.payload, key)?.value), dir);
                    return (
                      <tr key={key} data-testid={`compare-row-${key}`}>
                        <MetricLabelCell>{label}</MetricLabelCell>
                        {cols.map((c, i) => {
                          const m = metricValue(c.payload, key);
                          return (
                            <td key={c.id} className={numCell(i, winners)}>
                              {m?.value != null ? (
                                <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
                                  {m.value}{m.unit ? ` ${m.unit}` : ""}
                                  <VerificationBadge source={m.source} iconOnly />
                                </span>
                              ) : (
                                <span className="font-sans text-xs text-muted-foreground">–</span>
                              )}
                            </td>
                          );
                        })}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {busy && loaded.length === 0 && (
              <p className="mt-2 text-xs text-muted-foreground">Loading comparison…</p>
            )}
          </div>

          {/* Category comparison: radar for ≤2 players, grouped bar for >2 */}
          {loaded.length > 0 && (
            <Card className="rounded-2xl border-border">
              <CardContent className="pt-5 pb-5">
                <p className="mb-3 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Category Scores</p>
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
                ) : categoryData.length === 0 ? (
                  <p className="text-xs text-muted-foreground">No scored evaluations yet.</p>
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

          {/* Overall score grouped bar — only when at least one real score
              exists; a chart of nothing is never drawn. */}
          {overallData.length >= 2 && (
            <Card className="rounded-2xl border-border">
              <CardContent className="pt-5 pb-5">
                <p className="mb-3 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Overall Evaluation Score</p>
                {!hasOverallScores ? (
                  <p className="text-xs text-muted-foreground">No scored evaluations yet.</p>
                ) : (
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
                )}
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
                      <p className="mb-3 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                        {km.label}{unit ? ` (${unit})` : ""}
                      </p>
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
