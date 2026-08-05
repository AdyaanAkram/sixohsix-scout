import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { api, errMsg, signedUrl } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { EmptyState } from "@/components/common/EmptyState";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import { Trophy, FileDown, AlertTriangle, ClipboardList } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Cell,
} from "recharts";

const AGE_GROUPS = ["7U", "8U", "9U", "10U", "11U", "12U", "13U", "14U", "15U", "16U", "17U", "18U", "College", "Pro"];
const POSITIONS = ["P", "C", "1B", "2B", "3B", "SS", "LF", "CF", "RF"];
const CATEGORIES = ["Hitting", "Defense", "Athleticism", "Arm Strength", "Baseball IQ", "Coachability"];

export default function Reports() {
  const [events, setEvents] = useState([]);
  const [eventId, setEventId] = useState("");
  const [ageGroup, setAgeGroup] = useState("all");
  const [position, setPosition] = useState("all");
  const [category, setCategory] = useState("overall");
  const [leaderboard, setLeaderboard] = useState(null);
  const [completion, setCompletion] = useState(null);
  const [disagreement, setDisagreement] = useState(null);
  const [tab, setTab] = useState("leaderboard");

  useEffect(() => {
    api.get("/events").then((r) => {
      setEvents(r.data);
      if (r.data.length > 0) setEventId(r.data[0].id);
    });
  }, []);

  useEffect(() => {
    if (!eventId) return;
    const params = { event_id: eventId };
    if (ageGroup !== "all") params.age_group = ageGroup;
    if (position !== "all") params.position = position;
    if (category !== "overall") params.category = category;
    setLeaderboard(null);
    api.get("/reports/leaderboard", { params }).then((r) => setLeaderboard(r.data)).catch((e) => { toast.error(errMsg(e)); setLeaderboard([]); });
  }, [eventId, ageGroup, position, category]);

  useEffect(() => {
    if (!eventId) return;
    if (tab === "completion" && !completion) {
      api.get(`/reports/event-completion/${eventId}`).then((r) => setCompletion(r.data)).catch(() => setCompletion({ rows: [] }));
    }
    if (tab === "disagreement" && !disagreement) {
      api.get(`/reports/disagreement/${eventId}`).then((r) => setDisagreement(r.data)).catch(() => setDisagreement([]));
    }
  }, [tab, eventId, completion, disagreement]);

  useEffect(() => { setCompletion(null); setDisagreement(null); }, [eventId]);

  const leaderboardChart = useMemo(() => {
    if (!leaderboard?.length) return [];
    return leaderboard.slice(0, 10).map((r) => ({
      name: `${r.athlete?.first_name?.[0] || ""}. ${r.athlete?.last_name || ""}`,
      score: Number(r.score) || 0,
      rank: r.rank,
    }));
  }, [leaderboard]);

  const completionChart = useMemo(() => {
    if (!completion?.rows?.length || !completion?.station_names?.length) return [];
    return completion.station_names.map((name) => {
      let complete = 0;
      let draft = 0;
      let missing = 0;
      completion.rows.forEach((r) => {
        const st = r.stations?.[name];
        if (st === "complete") complete += 1;
        else if (st === "draft") draft += 1;
        else if (st === "missing") missing += 1;
      });
      const applicable = complete + draft + missing;
      return {
        name: name.length > 14 ? `${name.slice(0, 12)}…` : name,
        complete,
        draft,
        missing,
        pct: applicable ? Math.round((complete / applicable) * 100) : 0,
      };
    });
  }, [completion]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-4xl text-foreground">Reports</h1>
          <p className="text-sm text-muted-foreground">Internal rankings and completion reports. Not for public distribution.</p>
        </div>
        {eventId && (
          <Button variant="outline" className="rounded-xl h-11" onClick={() => window.open(signedUrl(`/reports/event-results/${eventId}/csv`), "_blank")} data-testid="reports-export-csv-button">
            <FileDown className="h-4 w-4 mr-1" /> Export CSV
          </Button>
        )}
      </div>

      <div className="flex flex-wrap gap-2">
        <Select value={eventId} onValueChange={setEventId}>
          <SelectTrigger className="w-[240px] h-11 rounded-xl bg-card" data-testid="reports-event-select"><SelectValue placeholder="Select event" /></SelectTrigger>
          <SelectContent>{events.map((e) => <SelectItem key={e.id} value={e.id}>{e.name}</SelectItem>)}</SelectContent>
        </Select>
        <Select value={ageGroup} onValueChange={setAgeGroup}>
          <SelectTrigger className="w-[110px] h-11 rounded-xl bg-card" data-testid="reports-age-filter"><SelectValue /></SelectTrigger>
          <SelectContent><SelectItem value="all">All ages</SelectItem>{AGE_GROUPS.map((a) => <SelectItem key={a} value={a}>{a}</SelectItem>)}</SelectContent>
        </Select>
        <Select value={position} onValueChange={setPosition}>
          <SelectTrigger className="w-[130px] h-11 rounded-xl bg-card" data-testid="reports-position-filter"><SelectValue /></SelectTrigger>
          <SelectContent><SelectItem value="all">All positions</SelectItem>{POSITIONS.map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}</SelectContent>
        </Select>
        <Select value={category} onValueChange={setCategory}>
          <SelectTrigger className="w-[150px] h-11 rounded-xl bg-card" data-testid="reports-category-filter"><SelectValue /></SelectTrigger>
          <SelectContent><SelectItem value="overall">Overall score</SelectItem>{CATEGORIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
        </Select>
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="rounded-xl bg-secondary h-11">
          <TabsTrigger value="leaderboard" className="rounded-lg px-4 data-[state=active]:bg-primary data-[state=active]:text-white" data-testid="reports-tab-leaderboard">Leaderboard</TabsTrigger>
          <TabsTrigger value="completion" className="rounded-lg px-4 data-[state=active]:bg-primary data-[state=active]:text-white" data-testid="reports-tab-completion">Completion</TabsTrigger>
          <TabsTrigger value="disagreement" className="rounded-lg px-4 data-[state=active]:bg-primary data-[state=active]:text-white" data-testid="reports-tab-disagreement">Disagreement</TabsTrigger>
        </TabsList>

        <TabsContent value="leaderboard" className="mt-4 space-y-4">
          {!leaderboard ? <Skeleton className="h-64 rounded-2xl" /> : leaderboard.length === 0 ? (
            <EmptyState icon={Trophy} title="No ranked players" hint="Rankings appear when evaluations are submitted for this event and filters." />
          ) : (
            <>
              {leaderboardChart.length > 0 && (
                <Card className="rounded-2xl border-border" data-testid="leaderboard-chart">
                  <CardContent className="pt-5 pb-4">
                    <p className="text-sm font-semibold mb-3">Top scores</p>
                    <div className="h-64">
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={leaderboardChart} margin={{ top: 8, right: 8, left: 0, bottom: 8 }}>
                          <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                          <XAxis dataKey="name" stroke="hsl(var(--muted-foreground))" fontSize={11} tickLine={false} />
                          <YAxis stroke="hsl(var(--muted-foreground))" fontSize={11} tickLine={false} domain={[0, 10]} />
                          <Tooltip
                            contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 12 }}
                            formatter={(v) => [v, category === "overall" ? "Overall" : category]}
                          />
                          <Bar dataKey="score" radius={[6, 6, 0, 0]}>
                            {leaderboardChart.map((entry) => (
                              <Cell key={entry.rank} fill={entry.rank <= 3 ? "hsl(var(--warning))" : "hsl(var(--brand))"} />
                            ))}
                          </Bar>
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                  </CardContent>
                </Card>
              )}
              <Card className="rounded-2xl border-border overflow-hidden">
                <Table data-testid="leaderboard-table">
                  <TableHeader>
                    <TableRow className="bg-secondary">
                      <TableHead className="w-14">Rank</TableHead><TableHead>Player</TableHead>
                      <TableHead>Age</TableHead><TableHead>Pos</TableHead><TableHead>Team</TableHead>
                      <TableHead className="text-right">{category === "overall" ? "Overall" : category}</TableHead>
                      <TableHead className="text-right"># Evals</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {leaderboard.map((r) => (
                      <TableRow key={r.athlete.id}>
                        <TableCell>
                          <span className={cn("font-display text-xl", r.rank <= 3 ? "text-warning" : "text-muted-foreground")}>{r.rank}</span>
                        </TableCell>
                        <TableCell><Link to={`/players/${r.athlete.id}`} className="font-semibold text-foreground hover:underline">{r.athlete.first_name} {r.athlete.last_name}</Link></TableCell>
                        <TableCell>{r.athlete.age_group}</TableCell>
                        <TableCell>{r.athlete.primary_position}</TableCell>
                        <TableCell className="text-muted-foreground">{r.athlete.current_team || "—"}</TableCell>
                        <TableCell className="text-right font-mono-num font-bold">{r.score}</TableCell>
                        <TableCell className="text-right font-mono-num text-muted-foreground">{r.evaluation_count}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </Card>
            </>
          )}
        </TabsContent>

        <TabsContent value="completion" className="mt-4 space-y-4">
          {!completion ? <Skeleton className="h-64 rounded-2xl" /> : (completion.rows || []).length === 0 ? (
            <EmptyState icon={ClipboardList} title="No completion data" hint="Add players to the event roster to see per-station completion." />
          ) : (
            <>
              {completionChart.length > 0 && (
                <Card className="rounded-2xl border-border" data-testid="completion-chart">
                  <CardContent className="pt-5 pb-4">
                    <p className="text-sm font-semibold mb-3">Station completion %</p>
                    <div className="h-64">
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={completionChart} margin={{ top: 8, right: 8, left: 0, bottom: 8 }}>
                          <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                          <XAxis dataKey="name" stroke="hsl(var(--muted-foreground))" fontSize={11} tickLine={false} />
                          <YAxis stroke="hsl(var(--muted-foreground))" fontSize={11} tickLine={false} domain={[0, 100]} unit="%" />
                          <Tooltip
                            contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 12 }}
                            formatter={(v) => [`${v}%`, "Complete"]}
                          />
                          <Bar dataKey="pct" name="Complete %" fill="hsl(var(--brand))" radius={[6, 6, 0, 0]} />
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                  </CardContent>
                </Card>
              )}
              <Card className="rounded-2xl border-border overflow-hidden">
                <div className="overflow-x-auto">
                  <Table data-testid="completion-table">
                    <TableHeader>
                      <TableRow className="bg-secondary">
                        <TableHead>Player</TableHead><TableHead>Bib</TableHead><TableHead>Check-In</TableHead>
                        {(completion.station_names || []).map((s) => <TableHead key={s} className="text-center text-xs">{s}</TableHead>)}
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {completion.rows.map((r) => (
                        <TableRow key={r.athlete.id}>
                          <TableCell className="font-semibold whitespace-nowrap">{r.athlete.first_name} {r.athlete.last_name}</TableCell>
                          <TableCell className="font-mono-num">{r.bib_number || "—"}</TableCell>
                          <TableCell><span className={cn("text-xs font-semibold", r.check_in_status === "checked_in" ? "text-success" : "text-muted-foreground")}>{r.check_in_status === "checked_in" ? "In" : r.check_in_status}</span></TableCell>
                          {(completion.station_names || []).map((s) => {
                            const st = r.stations[s];
                            return (
                              <TableCell key={s} className="text-center">
                                <span className={cn("inline-block h-2.5 w-2.5 rounded-full",
                                  st === "complete" ? "bg-success" : st === "draft" ? "bg-warning" : st === "missing" ? "bg-destructive" : "bg-slate-200")} title={st} />
                              </TableCell>
                            );
                          })}
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
                <div className="px-4 py-3 border-t flex gap-4 text-xs text-muted-foreground">
                  <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-success inline-block" /> Complete</span>
                  <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-warning inline-block" /> Draft</span>
                  <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-destructive inline-block" /> Missing</span>
                  <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-slate-200 inline-block" /> N/A</span>
                </div>
              </Card>
            </>
          )}
        </TabsContent>

        <TabsContent value="disagreement" className="mt-4">
          {!disagreement ? <Skeleton className="h-64 rounded-2xl" /> : disagreement.length === 0 ? (
            <EmptyState icon={AlertTriangle} title="No disagreements found" hint="When two evaluators score the same player at the same station, differences appear here." />
          ) : (
            <div className="space-y-2">
              {disagreement.map((d, i) => (
                <Card key={i} className="rounded-2xl border-border">
                  <CardContent className="py-4">
                    <div className="flex items-center justify-between">
                      <div>
                        <Link to={`/players/${d.athlete?.id}`} className="font-semibold text-foreground hover:underline">{d.athlete?.first_name} {d.athlete?.last_name}</Link>
                        <p className="text-xs text-muted-foreground">{d.station_name}</p>
                      </div>
                      <span className="font-mono-num font-bold text-destructive">Δ {d.spread}</span>
                    </div>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {d.scores.map((s, j) => (
                        <span key={j} className="rounded-full bg-secondary px-3 py-1 text-xs font-medium">{s.evaluator}: <span className="font-mono-num font-bold">{s.score}</span></span>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
