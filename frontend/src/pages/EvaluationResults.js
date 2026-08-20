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
  AlertTriangle, ArrowLeft, CalendarClock, ClipboardList, Gauge, ListChecks,
  Minus, ShieldCheck, Target, TrendingDown, TrendingUp,
} from "lucide-react";

const fmt = (n) => (n === null || n === undefined ? "—" : Number(n).toFixed(1));
const fmtDate = (d) => (d ? String(d).slice(0, 10) : "—");
const has = (v) => v !== null && v !== undefined && v !== "";

// Rev 5 §17 evaluator states ride every metric row. A state is never a zero and
// never a blank — it is the answer, so spell it out rather than printing "—".
const STATE_LABELS = {
  not_observed: "Not observed",
  na: "Not applicable",
  dnp: "Did not participate",
  retest: "Needs retest",
};

/* ---------------------------------- anatomy ---------------------------------- */

const PanelLabel = ({ children }) => (
  <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">{children}</p>
);

const StatTile = ({ icon: Icon, tint, value, valueClass, label, sub, testId, valueTestId }) => (
  <Card className="rounded-2xl border-border bg-card h-full">
    <CardContent className="pt-4 pb-4 flex flex-col items-start gap-2 sm:flex-row sm:items-center sm:gap-3" data-testid={testId}>
      <div className={cn("h-10 w-10 rounded-lg grid place-items-center shrink-0", tint)}>
        <Icon className="h-5 w-5" />
      </div>
      <div className="min-w-0">
        <p
          className={cn("font-mono-num font-bold text-2xl text-foreground leading-none", valueClass)}
          data-testid={valueTestId}
        >
          {value}
        </p>
        <p className="mt-1 text-xs font-semibold leading-snug text-foreground [display:-webkit-box] [-webkit-box-orient:vertical] [-webkit-line-clamp:2] overflow-hidden">{label}</p>
        {sub && <p className="text-[10px] text-muted-foreground truncate">{sub}</p>}
      </div>
    </CardContent>
  </Card>
);

/** The headline number, or an honest statement of what is actually on file. */
const OverallTile = ({ d, recordedCount, measurementCount }) => {
  if (has(d.overall_score)) {
    return (
      <StatTile
        icon={Gauge}
        tint="bg-success/15 text-success"
        value={fmt(d.overall_score)}
        label="Overall score"
        sub="out of 10"
        testId="results-overall-tile"
        valueTestId="results-overall"
      />
    );
  }
  const sub = recordedCount
    ? `${recordedCount} metric${recordedCount > 1 ? "s" : ""} on file`
    : measurementCount
      ? `${measurementCount} verified measurement${measurementCount > 1 ? "s" : ""}`
      : "Raw entries only";
  return (
    <StatTile
      icon={ListChecks}
      tint="bg-secondary text-muted-foreground"
      value="Metrics recorded"
      valueClass="font-sans text-base font-bold leading-snug"
      label="Not scored yet"
      sub={sub}
      testId="results-overall-tile"
      valueTestId="results-overall"
    />
  );
};

const ChangeTile = ({ d }) => {
  const change = d.score_change;
  if (!has(change)) {
    return (
      <StatTile
        icon={Minus}
        tint="bg-secondary text-muted-foreground"
        value="No prior evaluation"
        valueClass="font-sans text-base font-bold leading-snug"
        label="Change vs previous"
        sub="First scored look on file"
      />
    );
  }
  const up = change > 0;
  const flat = change === 0;
  const Icon = flat ? Minus : up ? TrendingUp : TrendingDown;
  return (
    <StatTile
      icon={Icon}
      tint={flat ? "bg-secondary text-muted-foreground" : up ? "bg-success/15 text-success" : "bg-warning/15 text-warning"}
      value={
        <span
          className={cn(flat ? "text-muted-foreground" : up ? "text-success" : "text-warning")}
          data-testid="results-score-change"
        >
          {up ? "+" : ""}{fmt(change)}
        </span>
      }
      label="Change vs previous"
      sub={has(d.previous_overall_score) ? `was ${fmt(d.previous_overall_score)} · ${fmtDate(d.previous_evaluation_date)}` : null}
    />
  );
};

/** Top strengths / development needs — derived from scored items only. */
const RankedPanel = ({ title, items, tone, emptyHint }) => (
  <Card className="rounded-2xl border-border bg-card h-full">
    <CardContent className="pt-4 pb-4">
      <PanelLabel>{title}</PanelLabel>
      {(items || []).length === 0 ? (
        <p className="mt-2 text-sm text-muted-foreground">{emptyHint}</p>
      ) : (
        <ul className="mt-2 space-y-1">
          {items.map((s) => (
            <li
              key={`${s.label}-${s.score}`}
              className="flex min-h-[36px] items-center justify-between gap-3 rounded-lg px-2 py-1.5 hover:bg-secondary transition-colors"
            >
              <span className="min-w-0 flex-1 truncate text-sm font-semibold text-foreground">{s.label}</span>
              <span
                className={cn(
                  "shrink-0 rounded-lg px-2 py-0.5 font-mono-num text-sm font-bold",
                  tone === "up" ? "bg-success/15 text-success" : "bg-warning/15 text-warning"
                )}
              >
                {fmt(s.score)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </CardContent>
  </Card>
);

/** One template metric. Never renders a bare dash — it says what happened. */
const MetricResultRow = ({ m }) => {
  const state = m.state || (m.not_observed ? "not_observed" : null);
  const stateLabel = state ? STATE_LABELS[state] || state : null;
  const rawText = has(m.raw) ? `${m.raw}${m.unit ? ` ${m.unit}` : ""}` : null;
  return (
    <div className="flex min-h-[44px] items-center justify-between gap-3 rounded-xl bg-secondary/60 px-3 py-2">
      <div className="min-w-0 flex-1">
        <p className="truncate text-xs font-semibold text-foreground">{m.name}</p>
        {m.category && (
          <p className="truncate text-[10px] uppercase tracking-wide text-muted-foreground">{m.category}</p>
        )}
        {(m.tags || []).length > 0 && (
          <p className="truncate text-[10px] text-muted-foreground">{m.tags.join(" · ")}</p>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-1.5">
        {m.source && <VerificationBadge source={m.source} iconOnly />}
        {stateLabel ? (
          <span
            className={cn(
              "rounded-full px-2 py-0.5 text-[10px] font-semibold",
              state === "retest" ? "bg-warning/15 text-warning" : "bg-secondary text-muted-foreground"
            )}
          >
            {stateLabel}
          </span>
        ) : rawText ? (
          <span className="font-mono-num text-sm font-bold text-foreground">{rawText}</span>
        ) : (
          <span className="rounded-full bg-secondary px-2 py-0.5 text-[10px] font-semibold text-muted-foreground">Not recorded</span>
        )}
        {has(m.normalized) && (
          <span className="rounded-lg bg-success/15 px-1.5 py-0.5 font-mono-num text-[11px] font-bold text-success">{m.normalized}</span>
        )}
      </div>
    </div>
  );
};

const ProseBlock = ({ label, tone, children }) => (
  <div className="rounded-xl bg-secondary/60 px-3 py-2.5">
    <p
      className={cn(
        "text-[10px] font-semibold uppercase tracking-widest",
        tone === "up" ? "text-success" : tone === "down" ? "text-warning" : "text-muted-foreground"
      )}
    >
      {label}
    </p>
    <p className="mt-1 whitespace-pre-wrap text-sm text-foreground">{children}</p>
  </div>
);

/* ----------------------------------- page ------------------------------------ */

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

  const metricRows = full.metric_results || [];
  const recordedCount = metricRows.filter((m) => has(m.raw)).length;
  const measurements = d.verified_measurements || [];
  const retestCount = (d.retest_needed || []).length;
  // Charts only earn their space when there is something in them — an evaluation
  // carrying raw measurements alone has no category scores to plot.
  const showRadar = radar.some((r) => has(r.score));
  const showTrend = has(d.overall_score) || has(d.previous_overall_score);
  const showSeries = (d.progress_series || []).length > 1;
  const identity = [
    a.age_group,
    a.primary_position,
    d.evaluated_as_position ? `evaluated as ${d.evaluated_as_position}` : null,
  ].filter(Boolean).join(" · ");
  const context = [d.station_name, d.event_name].filter(Boolean).join(" · ");

  return (
    <div className="space-y-4">
      {/* A — identity: who, which station, which event, when */}
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="sm" asChild>
          <Link to={a.id ? `/players/${a.id}` : "/review"}>
            <ArrowLeft className="h-4 w-4 mr-1" /> Back
          </Link>
        </Button>
        <StatusBadge status={d.status} />
      </div>

      <Card className="rounded-2xl border-border bg-card">
        <CardContent className="pt-4 pb-4">
          <PanelLabel>Evaluation summary</PanelLabel>
          <div className="mt-2 flex items-center gap-3 sm:gap-4">
            <PlayerAvatar
              firstName={a.first_name}
              lastName={a.last_name}
              photoUrl={a.photo_url}
              size="lg"
            />
            <div className="min-w-0 flex-1">
              <p className="font-display text-2xl text-foreground truncate">{name || "Player"}</p>
              {identity && <p className="text-sm text-muted-foreground truncate">{identity}</p>}
              {context && <p className="mt-0.5 text-xs font-semibold text-foreground truncate">{context}</p>}
              <p className="mt-0.5 text-[11px] text-muted-foreground truncate">
                Evaluated by {d.evaluator_name || "an evaluator"} · {fmtDate(d.submitted_at)}
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {retestCount > 0 && (
        <div
          className="flex items-center gap-2 rounded-2xl border border-warning/40 bg-warning/10 px-4 py-3 text-sm text-warning"
          data-testid="results-retest-banner"
        >
          <AlertTriangle className="h-4 w-4 shrink-0" />
          <span className="min-w-0">
            {retestCount} metric{retestCount > 1 ? "s" : ""} flagged for retest — this record is incomplete until they are re-run.
          </span>
        </div>
      )}

      {/* B — headline numbers */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <OverallTile d={d} recordedCount={recordedCount} measurementCount={measurements.length} />
        <ChangeTile d={d} />
        <StatTile
          icon={Target}
          tint="bg-[hsl(var(--info)_/_0.15)] text-info"
          value={d.evaluated_as_position || a.primary_position || "Unlisted"}
          valueClass="font-sans text-base font-bold leading-snug"
          label="Evaluated as"
          sub={d.station_name || "Station not recorded"}
        />
        <StatTile
          icon={CalendarClock}
          tint="bg-brand/15 text-brand"
          value={d.next_evaluation_date ? fmtDate(d.next_evaluation_date) : "Not scheduled"}
          valueClass={d.next_evaluation_date ? "text-base" : "font-sans text-base font-bold leading-snug"}
          label="Next evaluation"
          sub={d.next_evaluation_date ? "Planned re-look" : "Book at the next camp"}
        />
      </div>

      {/* C — what the scores say */}
      <div className="grid md:grid-cols-2 gap-3">
        <RankedPanel
          title="Top strengths"
          items={d.top_strengths}
          tone="up"
          emptyHint="No normalized category scores on this evaluation — the metric results below are what is on file."
        />
        <RankedPanel
          title="Areas for improvement"
          items={d.top_improvements}
          tone="down"
          emptyHint="Nothing ranked yet. Scored categories appear here once this template is normalized."
        />
      </div>

      {(showRadar || showTrend || showSeries) && (
        <div className={cn("grid gap-3", showRadar && (showTrend || showSeries) && "md:grid-cols-2")}>
          {showRadar && (
            <Card className="rounded-2xl border-border bg-card">
              <CardContent className="pt-4 pb-4">
                <PanelLabel>Skill profile</PanelLabel>
                <div className="mt-2">
                  <IdRadarChart data={radar} height={260} />
                </div>
              </CardContent>
            </Card>
          )}
          {(showTrend || showSeries) && (
            <Card className="rounded-2xl border-border bg-card">
              <CardContent className="pt-4 pb-4">
                {showTrend && (
                  <>
                    <PanelLabel>Previous vs current</PanelLabel>
                    <div className="mt-2">
                      <ResponsiveContainer width="100%" height={130}>
                        <BarChart data={compareBar} layout="vertical" margin={{ left: 8, right: 16 }}>
                          <XAxis type="number" domain={[0, 10]} hide />
                          <YAxis type="category" dataKey="name" width={70} tick={{ fontSize: 12 }} />
                          <Tooltip cursor={false} />
                          <Bar dataKey="score" fill="hsl(var(--brand))" radius={[0, 6, 6, 0]} barSize={18} />
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                  </>
                )}
                {showSeries && (
                  <>
                    <div className={cn(showTrend && "mt-3")}>
                      <PanelLabel>Score over time</PanelLabel>
                    </div>
                    <div className="mt-2">
                      <ResponsiveContainer width="100%" height={120}>
                        <LineChart data={d.progress_series}>
                          <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                          <XAxis dataKey="date" tickFormatter={fmtDate} tick={{ fontSize: 10 }} />
                          <YAxis domain={[0, 10]} tick={{ fontSize: 10 }} width={28} />
                          <Tooltip labelFormatter={fmtDate} />
                          <Line type="monotone" dataKey="overall_score" stroke="hsl(var(--brand))" strokeWidth={2} dot />
                        </LineChart>
                      </ResponsiveContainer>
                    </div>
                  </>
                )}
              </CardContent>
            </Card>
          )}
        </div>
      )}

      {/* D — the raw record. For most evaluations this IS the result. */}
      {metricRows.length > 0 && (
        <Card className="rounded-2xl border-border bg-card" data-testid="results-metric-results">
          <CardContent className="pt-4 pb-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <PanelLabel>Metric results</PanelLabel>
              <span className="min-w-0 truncate text-[10px] text-muted-foreground">
                {full.template_name || "Template"}
                {full.template_version ? ` · v${full.template_version}` : ""}
              </span>
            </div>
            <div className="mt-2 grid gap-1.5 sm:grid-cols-2">
              {metricRows.map((m) => <MetricResultRow key={m.metric_id} m={m} />)}
            </div>
          </CardContent>
        </Card>
      )}

      {measurements.length > 0 && (
        <Card className="rounded-2xl border-border bg-card" data-testid="results-verified-measurements">
          <CardContent className="pt-4 pb-4">
            <div className="flex items-center gap-2">
              <div className="h-10 w-10 rounded-lg grid place-items-center shrink-0 bg-success/15 text-success">
                <ShieldCheck className="h-5 w-5" />
              </div>
              <div className="min-w-0">
                <PanelLabel>Verified measurements</PanelLabel>
                <p className="truncate text-[11px] text-muted-foreground">Independently captured around this evaluation</p>
              </div>
            </div>
            <div className="mt-3 grid gap-1.5 sm:grid-cols-2">
              {measurements.map((m) => (
                <div
                  key={`${m.metric_key}-${m.measured_at}`}
                  className="flex min-h-[44px] items-center justify-between gap-3 rounded-xl bg-secondary/60 px-3 py-2"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-xs font-semibold text-foreground">{m.label}</p>
                    {m.in_evaluation_window === false && (
                      <p className="truncate text-[10px] text-muted-foreground">Measured outside this event window</p>
                    )}
                  </div>
                  <span className="flex shrink-0 items-center gap-1.5">
                    <VerificationBadge source={m.source} iconOnly />
                    <span className="font-mono-num text-sm font-bold text-foreground">
                      {has(m.value) ? `${m.value}${m.unit ? ` ${m.unit}` : ""}` : "Not recorded"}
                    </span>
                  </span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {d.recommendation && (
        <Card className="rounded-2xl border-border bg-card">
          <CardContent className="pt-4 pb-4">
            <PanelLabel>Coach recommendation</PanelLabel>
            <p className="mt-2 whitespace-pre-wrap text-sm text-foreground">{d.recommendation}</p>
          </CardContent>
        </Card>
      )}

      {/* E — the long-form write-up stays one tap away */}
      <Accordion type="single" collapsible>
        <AccordionItem value="full" className="rounded-2xl border border-border bg-card px-4">
          <AccordionTrigger data-testid="view-full-evaluation" className="text-sm font-semibold">
            View Full Evaluation
          </AccordionTrigger>
          <AccordionContent className="space-y-3 pb-4">
            {hasProse ? (
              <div className="space-y-2">
                {full.strengths && <ProseBlock label="Strengths" tone="up">{full.strengths}</ProseBlock>}
                {full.development_needs && <ProseBlock label="Development needs" tone="down">{full.development_needs}</ProseBlock>}
                {full.general && <ProseBlock label="Comments">{full.general}</ProseBlock>}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">No written comments were recorded.</p>
            )}

            {(full.quick_tags || []).length > 0 && (
              <div>
                <PanelLabel>Quick tags</PanelLabel>
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {full.quick_tags.map((t) => (
                    <span key={t} className="rounded-full bg-secondary px-2.5 py-1 text-[11px] font-semibold text-foreground">{t}</span>
                  ))}
                </div>
              </div>
            )}

            {full.review_note && (
              <div className="rounded-xl border border-border bg-secondary/60 px-3 py-2.5">
                <PanelLabel>Review note</PanelLabel>
                <p className="mt-1 text-xs text-muted-foreground">
                  From {full.reviewed_by_name || "reviewer"}: {full.review_note}
                </p>
              </div>
            )}
          </AccordionContent>
        </AccordionItem>
      </Accordion>
    </div>
  );
}
