import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { api, errMsg } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { PlayerAvatar } from "@/components/common/PlayerAvatar";
import { IdRadarChart } from "@/components/common/IdRadarChart";
import { toast } from "sonner";
import { ArrowLeft, GitCompare } from "lucide-react";
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
} from "recharts";

export default function PlayerCompare() {
  const [players, setPlayers] = useState([]);
  const [q, setQ] = useState("");
  const [selected, setSelected] = useState([]);
  const [summaries, setSummaries] = useState({});
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

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setBusy(true);
      const next = { ...summaries };
      for (const id of selected) {
        if (next[id]) continue;
        try {
          const r = await api.get(`/athletes/${id}/summary`);
          if (!cancelled) next[id] = r.data;
        } catch { /* skip */ }
      }
      // drop deselected
      Object.keys(next).forEach((id) => {
        if (!selected.includes(id)) delete next[id];
      });
      if (!cancelled) setSummaries(next);
      setBusy(false);
    })();
    return () => { cancelled = true; };
  }, [selected]); // eslint-disable-line react-hooks/exhaustive-deps

  const barData = selected.map((id) => {
    const s = summaries[id];
    const a = s?.athlete || players.find((p) => p.id === id);
    return {
      name: a ? `${a.first_name?.[0] || ""}. ${a.last_name || ""}` : id.slice(0, 6),
      score: s?.latest_overall ?? s?.latest_score ?? 0,
      previous: s?.previous_overall ?? s?.score_change != null
        ? (s?.latest_overall ?? 0) - (s?.score_change ?? 0)
        : 0,
    };
  });

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
          <div className={`grid gap-3 ${selected.length === 1 ? "grid-cols-1" : selected.length === 2 ? "md:grid-cols-2" : "md:grid-cols-2 xl:grid-cols-4"}`}>
            {selected.map((id) => {
              const s = summaries[id];
              const a = s?.athlete || players.find((p) => p.id === id);
              if (!a) return null;
              return (
                <Card key={id} className="rounded-2xl border-border overflow-hidden">
                  <div className="h-36 bg-surface-3 relative">
                    {a.photo_url ? (
                      <img src={a.photo_url.startsWith("http") ? a.photo_url : undefined} alt="" className="absolute inset-0 w-full h-full object-cover opacity-80" />
                    ) : null}
                    <div className="absolute inset-0 bg-gradient-to-t from-background via-background/40 to-transparent" />
                    <div className="absolute bottom-3 left-3 right-3 flex items-end gap-3">
                      <PlayerAvatar firstName={a.first_name} lastName={a.last_name} photoUrl={a.photo_url} size="lg" />
                      <div>
                        <Link to={`/players/${id}`} className="font-semibold text-foreground hover:underline">
                          {a.first_name} {a.last_name}
                        </Link>
                        <p className="text-xs text-muted-foreground">{a.primary_position} · {a.age_group}</p>
                      </div>
                    </div>
                  </div>
                  <CardContent className="pt-4 pb-4 space-y-2">
                    <div className="grid grid-cols-2 gap-2 text-center">
                      <div className="rounded-xl bg-secondary px-2 py-2">
                        <p className="text-xl font-bold font-mono-num">{s?.latest_overall ?? s?.latest_score ?? "—"}</p>
                        <p className="text-[10px] text-muted-foreground uppercase">Overall</p>
                      </div>
                      <div className="rounded-xl bg-secondary px-2 py-2">
                        <p className="text-xl font-bold font-mono-num text-brand">
                          {s?.score_change != null ? `${s.score_change > 0 ? "+" : ""}${s.score_change}` : "—"}
                        </p>
                        <p className="text-[10px] text-muted-foreground uppercase">Change</p>
                      </div>
                    </div>
                    {(() => {
                      const cats = s?.category_scores || s?.radar || s?.skill_radar;
                      const radar = Array.isArray(cats)
                        ? cats
                        : cats
                          ? Object.entries(cats).map(([category, score]) => ({ category, score: Number(score) || 0 }))
                          : null;
                      return radar && radar.length >= 3 ? (
                        <div className="h-44">
                          <IdRadarChart data={radar} height={176} />
                        </div>
                      ) : null;
                    })()}
                    {busy && !s && <p className="text-xs text-muted-foreground">Loading…</p>}
                  </CardContent>
                </Card>
              );
            })}
          </div>

          {barData.length >= 2 && (
            <Card className="rounded-2xl border-border">
              <CardContent className="pt-5 pb-5">
                <p className="text-sm font-semibold mb-3">Current vs previous overall</p>
                <div className="h-64">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={barData}>
                      <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                      <XAxis dataKey="name" stroke="hsl(var(--muted-foreground))" fontSize={12} />
                      <YAxis stroke="hsl(var(--muted-foreground))" fontSize={12} />
                      <Tooltip contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))" }} />
                      <Legend />
                      <Bar dataKey="previous" name="Previous" fill="hsl(var(--muted-foreground))" radius={[6, 6, 0, 0]} />
                      <Bar dataKey="score" name="Current" fill="hsl(var(--brand))" radius={[6, 6, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
