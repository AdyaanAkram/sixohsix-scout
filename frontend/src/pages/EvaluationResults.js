import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import { api, errMsg } from "@/lib/api";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import {
  Accordion, AccordionContent, AccordionItem, AccordionTrigger,
} from "@/components/ui/accordion";
import { PlayerAvatar } from "@/components/common/PlayerAvatar";
import { StatusBadge, VerificationBadge } from "@/components/common/StatusBadge";
import { IdRadarChart } from "@/components/common/IdRadarChart";
import { EmptyState } from "@/components/common/EmptyState";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import {
  ArrowLeft, CalendarClock, ClipboardList, Minus, TrendingDown, TrendingUp,
} from "lucide-react";

const fmt = (n) => (n === null || n === undefined ? "—" : Number(n).toFixed(1));
const fmtDate = (d) => (d ? String(d).slice(0, 10) : "—");

const ChangePill = ({ change }) => {
  if (change === null || change === undefined) {
    return <span className="text-sm text-muted-foreground">No prior evaluation</span>;
  }
  const up = change > 0;
  const flat = change === 0;
  const Icon = flat ? Minus : up ? TrendingUp : TrendingDown;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 text-sm font-semibold",
        flat ? "text-muted-foreground" : up ? "text-success" : "text-warning"
      )}
      data-testid="results-score-change"
    >
      <Icon className="h-4 w-4" />
      {up ? "+" : ""}{fmt(change)}
    </span>
  );
};

/** Level 1: the five-second read. */
const SummaryCards = ({ d }) => (
  <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
    <Card>
      <CardContent className="p-4">
        <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Overall</p>
        <p className="font-mono-num text-3xl font-bold text-brand" data-testid="results-overall">
          {fmt(d.overall_score)}
        </p>
        <p className="text-[11px] text-muted-foreground">out of 10</p>
      </CardContent>
    </Card>
    <Card>
      <CardContent className="p-4">
        <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Change</p>
        <div className="mt-2"><ChangePill change={d.score_change} /></div>
        {d.previous_overall_score !== null && d.previous_overall_score !== undefined && (
          <p className="text-[11px] text-muted-foreground mt-1">
            was {fmt(d.previous_overall_score)} on {fmtDate(d.previous_evaluation_date)}
          </p>
        )}
      </CardContent>
    </Card>
    <Card>
      <CardContent className="p-4">
        <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Evaluated as</p>
        <p className="text-lg font-semibold text-foreground mt-1">{d.evaluated_as_position || "—"}</p>
        <p className="text-[11px] text-muted-foreground">{d.station_name || "—"}</p>
      </CardContent>
    </Card>
    <Card>
      <CardContent className="p-4">
        <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Next evaluation</p>
        <p className="text-lg font-semibold text-foreground mt-1 flex items-center gap-1.5">
          <CalendarClock className="h-4 w-4 text-muted-foreground" />
          {fmtDate(d.next_evaluation_date)}
        </p>
      </CardContent>
    </Card>
  </div>
);

const Bullets = ({ title, items, tone }) => (
  <Card>
    <CardContent className="p-4">
      <p className={cn("text-[11px] uppercase tracking-wide font-semibold mb-2",
        tone === "up" ? "text-success" : "text-warning")}>
        {title}
      </p>
      {(items || []).length === 0 ? (
        <p className="text-sm text-muted-foreground">Not enough scored categories yet.</p>
      ) : (
        <ul className="space-y-1.5">
          {items.map((s) => (
            <li key={`${s.label}-${s.score}`} className="flex items-center justify-between gap-3 text-sm">
              <span className="text-foreground truncate">{s.label}</span>
              <span className="font-mono-num font-semibold shrink-0">{fmt(s.score)}</span>
            </li>
          ))}
        </ul>
      )}
    </CardContent>
  </Card>
);

export default function EvaluationResults() {
  const { evaluationId } = useParams();
  const [d, setD] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let alive = true;
    api.get(`/evaluations/${evaluationId}/results`)
      .then((r) => { if (alive) setD(r.data); })
      .catch((e) => {
        if (!alive) return;
        setError(errMsg(e));
        toast.error(errMsg(e));
      });
    return () => { alive = false; };
  }, [evaluationId]);

  if (error) {
    return (
      <EmptyState
        icon={ClipboardList}
        title="Results unavailable"
        description={error}
      />
    );
  }
  if (!d) return <Skeleton className="h-[60vh] w-full rounded-2xl" />;

  const a = d.athlete || {};
  const name = `${a.preferred_name || a.first_name || ""} ${a.last_name || ""}`.trim();
  const radar = (d.category_scores || []).map((c) => ({ category: c.category, score: c.score }));
  const compareBar = [
    { name: "Previous", score: d.previous_overall_score ?? 0 },
    { name: "Current", score: d.overall_score ?? 0 },
  ];
  const full = d.full_evaluation || {};
  const hasProse = full.strengths || full.development_needs || full.general;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="sm" asChild>
          <Link to={a.id ? `/players/${a.id}` : "/review"}>
            <ArrowLeft className="h-4 w-4 mr-1" /> Back
          </Link>
        </Button>
        <StatusBadge status={d.status} />
      </div>

      <Card>
        <CardContent className="p-4 sm:p-5 flex items-center gap-4">
          <PlayerAvatar athlete={a} size="lg" />
          <div className="min-w-0">
            <p className="font-display text-2xl text-foreground truncate">{name || "Player"}</p>
            <p className="text-sm text-muted-foreground truncate">
              {[a.age_group, a.primary_position, d.event_name].filter(Boolean).join(" · ")}
            </p>
            <p className="text-[11px] text-muted-foreground mt-0.5">
              Evaluated by {d.evaluator_name || "—"} on {fmtDate(d.submitted_at)}
            </p>
          </div>
        </CardContent>
      </Card>

      <SummaryCards d={d} />

      <div className="grid md:grid-cols-2 gap-3">
        <Bullets title="Top strengths" items={d.top_strengths} tone="up" />
        <Bullets title="Areas for improvement" items={d.top_improvements} tone="down" />
      </div>

      <div className="grid md:grid-cols-2 gap-3">
        <Card>
          <CardContent className="p-4">
            <p className="text-sm font-semibold text-foreground mb-2">Skill profile</p>
            <IdRadarChart data={radar} height={260} />
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-sm font-semibold text-foreground mb-2">Previous vs current</p>
            <ResponsiveContainer width="100%" height={130}>
              <BarChart data={compareBar} layout="vertical" margin={{ left: 8, right: 16 }}>
                <XAxis type="number" domain={[0, 10]} hide />
                <YAxis type="category" dataKey="name" width={70} tick={{ fontSize: 12 }} />
                <Tooltip cursor={false} />
                <Bar dataKey="score" fill="hsl(var(--brand))" radius={[0, 6, 6, 0]} barSize={18} />
              </BarChart>
            </ResponsiveContainer>
            {(d.progress_series || []).length > 1 && (
              <>
                <p className="text-sm font-semibold text-foreground mt-3 mb-1">Score over time</p>
                <ResponsiveContainer width="100%" height={120}>
                  <LineChart data={d.progress_series}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                    <XAxis dataKey="date" tickFormatter={fmtDate} tick={{ fontSize: 10 }} />
                    <YAxis domain={[0, 10]} tick={{ fontSize: 10 }} width={28} />
                    <Tooltip labelFormatter={fmtDate} />
                    <Line type="monotone" dataKey="overall_score" stroke="hsl(var(--brand))" strokeWidth={2} dot />
                  </LineChart>
                </ResponsiveContainer>
              </>
            )}
          </CardContent>
        </Card>
      </div>

      {(d.verified_measurements || []).length > 0 && (
        <Card>
          <CardContent className="p-4">
            <p className="text-sm font-semibold text-foreground mb-2">Verified measurements</p>
            <div className="space-y-1.5">
              {d.verified_measurements.map((m) => (
                <div key={`${m.metric_key}-${m.measured_at}`} className="flex items-center justify-between gap-3 text-sm">
                  <span className="text-muted-foreground truncate">{m.label}</span>
                  <span className="flex items-center gap-2 shrink-0">
                    <span className="font-mono-num font-semibold">{m.value} {m.unit}</span>
                    <VerificationBadge source={m.source} compact />
                    {m.in_evaluation_window === false && (
                      <span className="text-[10px] text-muted-foreground">earlier</span>
                    )}
                  </span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {d.recommendation && (
        <Card>
          <CardContent className="p-4">
            <p className="text-sm font-semibold text-foreground mb-1">Coach recommendation</p>
            <p className="text-sm text-muted-foreground whitespace-pre-wrap">{d.recommendation}</p>
          </CardContent>
        </Card>
      )}

      {/* Level 2: everything long lives behind this. */}
      <Accordion type="single" collapsible>
        <AccordionItem value="full" className="border rounded-xl px-4">
          <AccordionTrigger data-testid="view-full-evaluation">View Full Evaluation</AccordionTrigger>
          <AccordionContent className="space-y-3 pb-4">
            {hasProse ? (
              <div className="space-y-2">
                {full.strengths && (
                  <p className="text-sm"><span className="font-semibold text-success">Strengths: </span>{full.strengths}</p>
                )}
                {full.development_needs && (
                  <p className="text-sm"><span className="font-semibold text-warning">Development needs: </span>{full.development_needs}</p>
                )}
                {full.general && (
                  <p className="text-sm"><span className="font-semibold">Comments: </span>{full.general}</p>
                )}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">No written comments were recorded.</p>
            )}

            {(full.quick_tags || []).length > 0 && (
              <div className="flex flex-wrap gap-1">
                {full.quick_tags.map((t) => (
                  <span key={t} className="rounded-full bg-secondary px-2 py-0.5 text-[10px] font-semibold">{t}</span>
                ))}
              </div>
            )}

            {(full.metric_results || []).length > 0 && (
              <div className="border-t pt-3">
                <p className="text-xs font-semibold text-muted-foreground mb-1.5">
                  {full.template_name || "Template"} · every scored metric
                </p>
                <div className="space-y-1">
                  {full.metric_results.map((m) => (
                    <div key={m.metric_id} className="flex items-center justify-between gap-3 text-xs">
                      <span className="text-muted-foreground truncate">
                        {m.name}{m.category ? ` · ${m.category}` : ""}
                      </span>
                      <span className="font-mono-num font-semibold shrink-0">
                        {m.not_observed
                          ? "Not observed"
                          : `${m.raw ?? "—"}${m.normalized !== null && m.normalized !== undefined ? ` → ${m.normalized}` : ""}`}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {full.review_note && (
              <p className="text-xs text-muted-foreground border-t pt-2">
                Review note from {full.reviewed_by_name || "reviewer"}: {full.review_note}
              </p>
            )}
          </AccordionContent>
        </AccordionItem>
      </Accordion>
    </div>
  );
}
