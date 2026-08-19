import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { api, errMsg } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { PlayerAvatar } from "@/components/common/PlayerAvatar";
import { StatusBadge } from "@/components/common/StatusBadge";
import { EmptyState } from "@/components/common/EmptyState";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import { AlertTriangle, BarChart3, Calendar, CheckCircle2, ChevronDown, ChevronUp, ClipboardList, Clock, Loader2, Mail, MailWarning, Send, Undo2, Unlock, Users, XCircle } from "lucide-react";
import { cn } from "@/lib/utils";

/* ---------------------------------- helpers ---------------------------------- */

const scrollToQueue = () => {
  document.getElementById("review-queue")?.scrollIntoView({ behavior: "smooth", block: "start" });
};

const shortDate = (iso) => {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
};

const teamInitials = (team) =>
  (team || "").split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join("").toUpperCase() || "—";

const DONUT_COLORS = [
  "hsl(var(--success))",
  "hsl(var(--brand))",
  "hsl(var(--warning))",
  "hsl(var(--info))",
  "hsl(var(--brand-secondary))",
];
const DONUT_OTHER_COLOR = "hsl(var(--muted-foreground))";

// Review actions all POST { note } to /evaluations/{id}/{action}; only the
// confirmation copy differs, so keep the wording in one place.
const ACT_TOASTS = {
  approve: "Evaluation approved.",
  return: "Returned to evaluator for revision.",
  unlock: "Approval withdrawn — the evaluation is a draft again.",
};

/* ------------------------------ existing detail ------------------------------ */

const EvalDetail = ({ ev }) => {
  const metricMap = useMemo(() => {
    const m = {};
    (ev.template_metrics || []).forEach((x) => { m[x.id] = x; });
    return m;
  }, [ev]);
  const results = ev.computed?.metric_results || {};
  return (
    <div className="mt-3 border-t pt-3 space-y-1.5">
      {Object.entries(results).map(([mid, r]) => (
        <div key={mid} className="flex items-center justify-between text-xs">
          <span className="text-muted-foreground">{metricMap[mid]?.name || ev.metric_names?.[mid] || mid.slice(0, 8)}</span>
          <span className="font-mono-num font-semibold">
            {r.not_observed ? "Not observed" : `${r.raw ?? "—"}${r.normalized !== null && r.normalized !== undefined ? ` → ${r.normalized}` : " (raw)"}`}
          </span>
        </div>
      ))}
      {ev.comments?.strengths && <p className="text-xs mt-2"><span className="font-semibold text-success">Strengths:</span> {ev.comments.strengths}</p>}
      {ev.comments?.development_needs && <p className="text-xs"><span className="font-semibold text-warning">Needs:</span> {ev.comments.development_needs}</p>}
      {(ev.comments?.quick_tags || []).length > 0 && (
        <div className="flex flex-wrap gap-1 mt-1">{ev.comments.quick_tags.map((t) => <span key={t} className="rounded-full bg-secondary px-2 py-0.5 text-[10px] font-semibold">{t}</span>)}</div>
      )}
    </div>
  );
};

/* -------------------------------- analytics UI ------------------------------- */

const StatCard = ({ icon: Icon, tint, value, label, sub, onClick, to, testId }) => {
  const body = (
    <Card className={cn("rounded-2xl border-border bg-card h-full", (onClick || to) && "transition-colors hover:bg-secondary/50 hover:border-brand/40")} data-testid={testId}>
      <CardContent className="pt-4 pb-4 flex flex-col items-start gap-2 sm:flex-row sm:items-center sm:gap-3">
        <div className={cn("h-10 w-10 rounded-lg grid place-items-center shrink-0", tint)}>
          <Icon className="h-5 w-5" />
        </div>
        <div className="min-w-0">
          <p className="font-mono-num font-bold text-2xl text-foreground leading-none">{value ?? "—"}</p>
          {/* Labels wrap to two lines rather than truncating to "Evalu…". */}
          <p className="mt-1 text-xs font-semibold leading-snug text-foreground [display:-webkit-box] [-webkit-box-orient:vertical] [-webkit-line-clamp:2] overflow-hidden">{label}</p>
          {sub && <p className="text-[10px] text-muted-foreground truncate">{sub}</p>}
        </div>
      </CardContent>
    </Card>
  );
  if (to) return <Link to={to} className="block h-full">{body}</Link>;
  if (onClick) return <button type="button" onClick={onClick} className="block w-full h-full text-left cursor-pointer">{body}</button>;
  return body;
};

const PanelLabel = ({ children }) => (
  <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">{children}</p>
);

const TopPerformersCard = ({ performers }) => (
  <Card className="rounded-2xl border-border bg-card" data-testid="evals-top-performers">
    <CardContent className="pt-4 pb-4">
      <PanelLabel>Top performers</PanelLabel>
      {performers.length === 0 ? (
        <p className="text-sm text-muted-foreground py-6 text-center">No scored evaluations yet.</p>
      ) : (
        <div className="mt-2 space-y-1">
          {performers.slice(0, 5).map((p, i) => {
            const change = Number(p.score_change);
            const showTrend = p.score_change !== null && p.score_change !== undefined && Number.isFinite(change) && change !== 0;
            const sub = [
              p.primary_position || "—",
              p.graduation_year ? `Class of ${p.graduation_year}` : (p.age_group || ""),
              `${p.bats || "—"}/${p.throws || "—"}`,
            ].filter(Boolean).join(" · ");
            return (
              <Link
                key={p.id}
                to={`/players/${p.athlete_id}`}
                className="flex items-center gap-2.5 rounded-lg px-2 py-2 hover:bg-secondary transition-colors"
              >
                <span className={cn("w-5 text-center font-mono-num font-bold text-sm shrink-0", i === 0 ? "text-primary" : "text-muted-foreground")}>{i + 1}</span>
                <PlayerAvatar firstName={p.first_name} lastName={p.last_name} photoUrl={p.photo_url} size="sm" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-foreground truncate">{p.first_name} {p.last_name}</p>
                  <p className="text-xs text-muted-foreground truncate">{sub}</p>
                </div>
                {showTrend && (
                  <span className={cn("text-[11px] font-mono-num font-semibold shrink-0", change > 0 ? "text-success" : "text-warning")}>
                    {change > 0 ? `↑ +${change}` : `↓ ${change}`}
                  </span>
                )}
                <span className="rounded-lg bg-success/15 px-2 py-0.5 font-mono-num font-bold text-success shrink-0">{p.latest_overall ?? "—"}</span>
              </Link>
            );
          })}
        </div>
      )}
      <Link to="/scout" className="mt-2 inline-block text-xs font-semibold text-primary hover:underline">View full leaderboard →</Link>
    </CardContent>
  </Card>
);

const TopTeamsCard = ({ teams }) => {
  if (!teams || teams.length === 0) return null;
  return (
    <Card className="rounded-2xl border-border bg-card" data-testid="evals-top-teams">
      <CardContent className="pt-4 pb-4">
        <PanelLabel>Top teams</PanelLabel>
        <div className="mt-2 space-y-1">
          {teams.map((t) => (
            <div key={t.team} className="flex items-center gap-3 rounded-lg px-2 py-2">
              <div className="h-9 w-9 rounded-lg bg-secondary grid place-items-center font-bold text-xs text-foreground shrink-0">
                {teamInitials(t.team)}
              </div>
              <p className="flex-1 min-w-0 text-sm font-semibold text-foreground truncate">{t.team}</p>
              <div className="flex items-center gap-4 shrink-0">
                <div className="text-right">
                  <p className="font-mono-num font-bold text-foreground leading-none">{t.avg_score ?? "—"}</p>
                  <p className="text-[10px] uppercase text-muted-foreground mt-0.5">Avg</p>
                </div>
                <div className="text-right">
                  <p className="font-mono-num font-bold text-foreground leading-none">{t.athletes ?? "—"}</p>
                  <p className="text-[10px] uppercase text-muted-foreground mt-0.5">Athletes</p>
                </div>
              </div>
            </div>
          ))}
        </div>
        <Link to="/teams" className="mt-2 inline-block text-xs font-semibold text-primary hover:underline">View all teams →</Link>
      </CardContent>
    </Card>
  );
};

const PositionDonutCard = ({ byPosition }) => {
  // "Other" can come from the backend (athletes without a position) AND from the
  // tail beyond the top 5 — merge them into one slice so the legend never shows
  // two "Other" rows. Named positions rank first so real positions get colors.
  const rows = byPosition || [];
  const named = rows.filter((p) => p.position !== "Other");
  const backendOther = rows.filter((p) => p.position === "Other");
  const top = named.slice(0, 5);
  const rest = [...named.slice(5), ...backendOther];
  const slices = top.map((p, i) => ({ label: p.position, count: p.count, pct: p.pct, color: DONUT_COLORS[i] }));
  if (rest.length > 0) {
    slices.push({
      label: "Other",
      count: rest.reduce((s, p) => s + (p.count || 0), 0),
      pct: rest.reduce((s, p) => s + (p.pct || 0), 0),
      color: DONUT_OTHER_COLOR,
    });
  }
  const total = slices.reduce((s, x) => s + (x.count || 0), 0);
  const C = 2 * Math.PI * 46;
  let acc = 0;
  const arcs = slices.map((s) => {
    const len = total > 0 ? (s.count / total) * C : 0;
    const arc = { ...s, len, offset: acc };
    acc += len;
    return arc;
  });
  return (
    <Card className="rounded-2xl border-border bg-card" data-testid="evals-position-donut">
      <CardContent className="pt-4 pb-4">
        <PanelLabel>Evaluations by position</PanelLabel>
        {total === 0 ? (
          <p className="text-sm text-muted-foreground py-6 text-center">No position data yet.</p>
        ) : (
          <div className="mt-3 flex flex-wrap items-center gap-4">
            <svg viewBox="0 0 120 120" className="h-32 w-32 shrink-0" role="img" aria-label="Evaluations by position">
              <circle cx="60" cy="60" r="46" fill="none" stroke="hsl(var(--secondary))" strokeWidth="14" />
              <g transform="rotate(-90 60 60)">
                {arcs.map((a) => (
                  <circle
                    key={a.label}
                    cx="60"
                    cy="60"
                    r="46"
                    fill="none"
                    stroke={a.color}
                    strokeWidth="14"
                    strokeDasharray={`${a.len} ${C - a.len}`}
                    strokeDashoffset={-a.offset}
                  />
                ))}
              </g>
              <text x="60" y="62" textAnchor="middle" className="font-mono-num" fontSize="24" fontWeight="700" fill="hsl(var(--foreground))">{total}</text>
              <text x="60" y="78" textAnchor="middle" fontSize="9" fill="hsl(var(--muted-foreground))">Total</text>
            </svg>
            <div className="flex-1 min-w-[140px] space-y-1.5">
              {arcs.map((a) => (
                <div key={a.label} className="flex items-center gap-2 text-xs">
                  <span className="h-2.5 w-2.5 rounded-full shrink-0" style={{ backgroundColor: a.color }} />
                  <span className="flex-1 truncate text-foreground">{a.label}</span>
                  <span className="font-mono-num text-muted-foreground shrink-0">
                    {Math.round(a.pct ?? (a.count / total) * 100)}% ({a.count})
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
};

const RecentEvalCard = ({ r }) => {
  const a = r.athlete;
  const sub = [
    a?.graduation_year,
    a?.primary_position || "—",
    `${a?.bats || "—"}/${a?.throws || "—"}`,
  ].filter(Boolean).join(" · ");
  return (
    <Link
      to={`/evaluation/${r.id}/results`}
      data-testid={`evals-recent-${r.id}`}
      className="min-w-[240px] max-w-[260px] shrink-0 snap-start rounded-2xl border border-border bg-card p-4 hover:bg-secondary/50 transition-colors flex flex-col gap-3"
    >
      <div className="flex items-center gap-3">
        <PlayerAvatar firstName={a?.first_name} lastName={a?.last_name} photoUrl={a?.photo_url} size="sm" />
        <div className="min-w-0">
          <p className="text-sm font-semibold text-foreground truncate">{a ? `${a.first_name} ${a.last_name}` : "Athlete"}</p>
          <p className="text-[11px] text-muted-foreground truncate">{sub}</p>
          {a?.current_team && <p className="text-[11px] text-muted-foreground truncate">{a.current_team}</p>}
        </div>
      </div>
      <div className="text-center">
        {r.overall_score !== null && r.overall_score !== undefined ? (
          <span className="inline-block rounded-xl bg-success/15 px-3 py-1 font-mono-num text-2xl font-bold text-success">{r.overall_score}</span>
        ) : (
          <span className="inline-block rounded-xl bg-secondary px-3 py-1.5 text-xs font-semibold text-muted-foreground">Metrics recorded</span>
        )}
        {r.station_name && <p className="text-[10px] text-muted-foreground mt-1 truncate">{r.station_name}</p>}
      </div>
      {(r.top_categories || []).length > 0 && (
        <div className="grid grid-cols-2 gap-2">
          {r.top_categories.map((c) => (
            <div key={c.name} className="min-w-0">
              <p className="text-[10px] uppercase text-muted-foreground truncate">{c.name}</p>
              <p className="font-mono-num font-semibold text-sm text-foreground">{c.score}</p>
            </div>
          ))}
        </div>
      )}
      <div className="mt-auto flex items-center justify-between gap-2">
        <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
          <Calendar className="h-3 w-3" /> {shortDate(r.submitted_at)}
        </span>
        {r.status === "approved" ? (
          <span className="rounded-full bg-success/15 px-2 py-0.5 text-[10px] font-semibold text-success">Verified</span>
        ) : (
          <span className="rounded-full bg-warning/15 px-2 py-0.5 text-[10px] font-semibold text-warning">Pending</span>
        )}
      </div>
    </Link>
  );
};

/* ------------------------- bulk assessment publishing ------------------------ */

// Module-level on purpose: this dialog owns an <Input>, and an inline component
// would be a new type on every parent render, remounting the field and losing
// focus after each keystroke. State lives in the card and comes down as props.
const PublishAllDialog = ({
  open,
  onOpenChange,
  readiness,
  confirmText,
  onConfirmTextChange,
  onlyWithEmail,
  onOnlyWithEmailChange,
  publishing,
  onConfirm,
}) => {
  const drafts = readiness?.drafts ?? 0;
  const willEmail = readiness?.will_email ?? 0;
  const noEmail = readiness?.no_email ?? 0;
  const canConfirm = confirmText.trim() === "PUBLISH" && !publishing;
  return (
    <Dialog open={open} onOpenChange={(v) => { if (!publishing) onOpenChange(v); }}>
      <DialogContent className="rounded-2xl max-w-md">
        <DialogHeader>
          <DialogTitle className="font-display text-2xl text-foreground">Publish assessments &amp; email families</DialogTitle>
        </DialogHeader>
        <div className="space-y-2 text-sm text-muted-foreground">
          {onlyWithEmail ? (
            <p>
              Only athletes with an email on file will publish — <span className="font-semibold text-foreground font-mono-num">{willEmail}</span> families receive an email immediately.
              {noEmail > 0 ? ` The ${noEmail} athletes with no email on file are held back and stay as drafts.` : ""}
            </p>
          ) : (
            <p>
              All <span className="font-semibold text-foreground font-mono-num">{drafts}</span> assessments publish now and <span className="font-semibold text-foreground font-mono-num">{willEmail}</span> families receive an email immediately.
              {noEmail > 0 ? ` The ${noEmail} athletes with no email on file are released in-app only — nobody is notified.` : ""}
            </p>
          )}
          {readiness?.mail_configured === false && (
            <p className="font-semibold text-destructive">Email is not configured — assessments are released in-app but no message is sent.</p>
          )}
          <p className="font-semibold text-destructive">This cannot be undone. Published assessments cannot be edited, regenerated or recalled, and the emails go to real parents.</p>
        </div>
        <label className="flex items-start gap-2 rounded-xl border border-border bg-secondary/40 px-3 py-2 text-sm text-foreground">
          <Checkbox
            checked={onlyWithEmail}
            onCheckedChange={(v) => onOnlyWithEmailChange(v === true)}
            disabled={publishing}
            className="mt-0.5"
            data-testid="assessments-only-with-email"
          />
          <span>
            Only publish athletes who have an email on file
            {noEmail > 0 && <span className="text-muted-foreground"> (hold back the other {noEmail})</span>}
          </span>
        </label>
        <div className="space-y-1.5">
          <p className="text-xs font-semibold text-foreground">Type PUBLISH to confirm</p>
          <Input
            value={confirmText}
            onChange={(e) => onConfirmTextChange(e.target.value)}
            placeholder="PUBLISH"
            autoComplete="off"
            spellCheck={false}
            disabled={publishing}
            className="rounded-xl h-11"
            data-testid="assessments-publish-input"
          />
        </div>
        <DialogFooter>
          <Button
            className="w-full rounded-xl bg-primary h-11"
            onClick={onConfirm}
            disabled={!canConfirm}
            data-testid="assessments-publish-confirm"
          >
            {publishing ? (
              <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Publishing…</>
            ) : (
              <><Send className="h-4 w-4 mr-2" /> Publish &amp; notify families</>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

const AssessmentsPublishCard = ({ onPublished }) => {
  const [readiness, setReadiness] = useState(null);
  const [showMissing, setShowMissing] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [confirmText, setConfirmText] = useState("");
  const [onlyWithEmail, setOnlyWithEmail] = useState(false);
  const [publishing, setPublishing] = useState(false);

  const loadReadiness = useCallback(() => {
    // Owner/admin only — a 403 (or any failure) simply hides the whole card.
    api.get("/assessments/publish-readiness")
      .then((r) => setReadiness(r.data))
      .catch(() => setReadiness(null));
  }, []);
  useEffect(() => { loadReadiness(); }, [loadReadiness]);

  const publishAll = async () => {
    // Guard as well as disable: 75 records take a while and a second POST would
    // be a second irreversible release.
    if (publishing || confirmText.trim() !== "PUBLISH") return;
    setPublishing(true);
    try {
      const r = await api.post("/assessments/publish-all", {
        confirm: "PUBLISH",
        only_with_email: onlyWithEmail,
        event_id: null,
      });
      const published = r.data?.published ?? 0;
      const emailed = r.data?.families_emailed ?? 0;
      const skipped = r.data?.skipped_no_email ?? 0;
      toast.success(
        `Published ${published} ${published === 1 ? "assessment" : "assessments"} · ${emailed} ${emailed === 1 ? "family" : "families"} emailed · ${skipped} skipped with no email on file`
      );
      setDialogOpen(false);
      setConfirmText("");
      loadReadiness();
      if (onPublished) onPublished();
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setPublishing(false);
    }
  };

  const drafts = readiness?.drafts ?? 0;
  const willEmail = readiness?.will_email ?? 0;
  const noEmail = readiness?.no_email ?? 0;
  const missing = readiness?.missing_email_athletes || [];
  const mailConfigured = readiness?.mail_configured !== false;

  // Every hook above this line. Nothing renders when readiness failed (or the
  // role can't publish) and nothing renders when there is no draft left.
  if (!readiness || drafts === 0) return null;

  return (
    <Card className="rounded-2xl border-border bg-card" data-testid="assessments-publish-card">
      <CardContent className="pt-4 pb-4">
        <div className="flex items-center justify-between gap-2">
          <PanelLabel>Assessments ready to publish</PanelLabel>
          {readiness.athletes !== null && readiness.athletes !== undefined && (
            <span className="rounded-full bg-brand/15 px-2 py-0.5 text-[11px] font-mono-num font-bold text-brand">
              {readiness.athletes} athletes
            </span>
          )}
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-4">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-lg grid place-items-center shrink-0 bg-brand/15 text-brand">
              <Send className="h-5 w-5" />
            </div>
            <div>
              <p className="font-mono-num font-bold text-3xl text-foreground leading-none">{drafts}</p>
              <p className="mt-1 text-xs font-semibold text-foreground">assessments ready</p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-1.5 rounded-lg bg-success/15 px-2.5 py-1.5 text-xs font-semibold text-success">
              <Mail className="h-3.5 w-3.5" />
              <span className="font-mono-num font-bold">{willEmail}</span> families will be emailed
            </span>
            {noEmail > 0 && (
              <span className="inline-flex items-center gap-1.5 rounded-lg bg-warning/15 px-2.5 py-1.5 text-xs font-semibold text-warning">
                <MailWarning className="h-3.5 w-3.5" />
                <span className="font-mono-num font-bold">{noEmail}</span> have no email on file
              </span>
            )}
          </div>
          <div className="flex-1" />
          <Button
            className="rounded-xl bg-primary hover:bg-brand-secondary h-11"
            onClick={() => setDialogOpen(true)}
            disabled={publishing}
            data-testid="assessments-publish-button"
          >
            {publishing ? (
              <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Publishing…</>
            ) : (
              <><Send className="h-4 w-4 mr-2" /> Publish all &amp; notify families</>
            )}
          </Button>
        </div>

        {!mailConfigured && (
          <div className="mt-3 flex items-start gap-2 rounded-xl border border-destructive/40 bg-destructive/10 px-3 py-2.5 text-sm font-semibold text-destructive">
            <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
            <span>Email is not configured — publishing will release assessments in-app but send nothing.</span>
          </div>
        )}

        {missing.length > 0 && (
          <div className="mt-3">
            <button
              type="button"
              onClick={() => setShowMissing((v) => !v)}
              className="inline-flex items-center gap-1 text-xs font-semibold text-info"
              data-testid="assessments-missing-toggle"
            >
              {showMissing ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
              {showMissing ? "Hide who has no email" : `Who has no email (${missing.length})`}
            </button>
            {showMissing && (
              <div className="mt-2 max-h-64 overflow-y-auto rounded-xl border border-border">
                {missing.map((m) => (
                  <Link
                    key={m.athlete_id}
                    to={`/players/${m.athlete_id}`}
                    className="flex items-center justify-between gap-2 border-b border-border px-3 py-2 last:border-b-0 hover:bg-secondary transition-colors"
                  >
                    <span className="text-sm text-foreground truncate">{m.name || "Athlete"}</span>
                    <span className="text-[11px] font-semibold text-primary shrink-0">Add an email →</span>
                  </Link>
                ))}
              </div>
            )}
          </div>
        )}

        <PublishAllDialog
          open={dialogOpen}
          onOpenChange={(v) => { setDialogOpen(v); if (!v) setConfirmText(""); }}
          readiness={readiness}
          confirmText={confirmText}
          onConfirmTextChange={setConfirmText}
          onlyWithEmail={onlyWithEmail}
          onOnlyWithEmailChange={setOnlyWithEmail}
          publishing={publishing}
          onConfirm={publishAll}
        />
      </CardContent>
    </Card>
  );
};

/* ----------------------------------- page ----------------------------------- */

export default function ReviewQueue() {
  const [queue, setQueue] = useState(null);
  const [events, setEvents] = useState([]);
  const [eventFilter, setEventFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("submitted");
  const [expanded, setExpanded] = useState({});
  const [templates, setTemplates] = useState({});
  // One reason dialog serves both review actions: "return" and "unlock".
  const [reviewFor, setReviewFor] = useState(null);
  const [reviewAction, setReviewAction] = useState("return");
  const [reviewNote, setReviewNote] = useState("");
  const [pendingAwards, setPendingAwards] = useState([]);
  const [awardAthletes, setAwardAthletes] = useState({});
  const [disagreements, setDisagreements] = useState(null);
  const [insights, setInsights] = useState(null);
  const [insightsLoading, setInsightsLoading] = useState(true);

  const load = useCallback(() => {
    const params = {};
    if (eventFilter !== "all") params.event_id = eventFilter;
    api.get("/review/queue", { params }).then((r) => setQueue(r.data)).catch((e) => toast.error(errMsg(e)));
  }, [eventFilter]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    api.get("/events").then((r) => setEvents(r.data));
    api.get("/templates").then((r) => {
      const map = {};
      r.data.forEach((t) => t.metrics.forEach((m) => { map[m.id] = m; }));
      setTemplates(map);
    });
  }, []);
  useEffect(() => {
    // Analytics are additive — if the endpoint fails, hide the sections and keep the queue.
    api.get("/evaluations/insights")
      .then((r) => setInsights(r.data))
      .catch(() => setInsights(null))
      .finally(() => setInsightsLoading(false));
  }, []);
  const loadPendingAwards = useCallback(() => {
    // Review-only endpoint — a 403 for other roles simply hides the section.
    api.get("/awards/pending")
      .then(async (r) => {
        const rows = r.data || [];
        setPendingAwards(rows);
        if (rows.length === 0) return;
        // /awards/pending returns bare award docs with no athlete embedded, so
        // pull the directory once to put a face and a name on each row.
        try {
          const dir = await api.get("/athletes", { params: { limit: 500 } });
          const map = {};
          (dir.data || []).forEach((a) => { map[a.id] = a; });
          setAwardAthletes(map);
        } catch { /* names are a nicety — rows still render and still act */ }
      })
      .catch(() => setPendingAwards([]));
  }, []);
  useEffect(() => { loadPendingAwards(); }, [loadPendingAwards]);
  useEffect(() => {
    if (eventFilter !== "all") {
      api.get(`/reports/disagreement/${eventFilter}`).then((r) => setDisagreements(r.data)).catch(() => setDisagreements(null));
    } else setDisagreements(null);
  }, [eventFilter]);

  const act = async (evId, action, note) => {
    try {
      await api.post(`/evaluations/${evId}/${action}`, { note: note || null });
      toast.success(ACT_TOASTS[action] || "Evaluation updated.");
      setReviewFor(null);
      setReviewNote("");
      load();
    } catch (e) { toast.error(errMsg(e)); }
  };

  const openReview = (ev, action) => {
    // Reasons are per-action — never carry a return note into an unlock, or back.
    if (action !== reviewAction) setReviewNote("");
    setReviewAction(action);
    setReviewFor(ev);
  };

  const decideAward = async (awardId, approve) => {
    try {
      if (approve) await api.post(`/awards/${awardId}/approve`);
      else await api.post(`/awards/${awardId}/reject`, { reason: "Not verified" });
      toast.success(approve ? "Award approved." : "Award rejected.");
      loadPendingAwards();
    } catch (e) { toast.error(errMsg(e)); }
  };

  const totals = insights?.totals || null;
  // The review-queue endpoint is slow (per-evaluation joins); insights already
  // knows how many are submitted-but-not-approved, so show that immediately and
  // let the exact queue count refine it rather than parking a dash on the tile.
  const awaiting = queue
    ? queue.filter((q) => q.status === "submitted").length
    : (totals ? Math.max(0, (totals.evaluations || 0) - (totals.verified || 0)) : null);
  const verifiedPct = totals && totals.evaluations > 0 ? Math.round((totals.verified / totals.evaluations) * 100) : 0;
  // Top Performers and the position donut always render; Top Teams only when
  // some athlete carries a team. Drives the insight grid's column count.
  const panelCount = 2 + ((insights?.top_teams || []).length > 0 ? 1 : 0);
  const recent = insights?.recent || [];
  const filtered = (queue || []).filter((q) => statusFilter === "all" || q.status === statusFilter);

  return (
    <div className="space-y-5">
      {/* A — Header + queue filters */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-3xl sm:text-4xl text-foreground">Evaluations</h1>
          <p className="text-sm text-muted-foreground">Discover. Compare. Elevate.</p>
        </div>
        <div className="flex flex-col items-start sm:items-end gap-1">
          <div className="flex flex-wrap gap-2">
            <Select value={eventFilter} onValueChange={setEventFilter}>
              <SelectTrigger className="h-10 sm:h-11 w-[calc(60%-0.25rem)] sm:w-[220px] rounded-xl bg-card" data-testid="review-event-filter"><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="all">All events</SelectItem>{events.map((e) => <SelectItem key={e.id} value={e.id}>{e.name}</SelectItem>)}</SelectContent>
            </Select>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="h-10 sm:h-11 w-[calc(40%-0.25rem)] sm:w-[150px] rounded-xl bg-card" data-testid="review-status-filter"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="submitted">Submitted</SelectItem>
                <SelectItem value="approved">Approved</SelectItem>
                <SelectItem value="all">All</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <p className="text-[10px] uppercase tracking-widest text-muted-foreground">Filters apply to the review queue</p>
        </div>
      </div>

      {/* B — Stat card row */}
      {insightsLoading && (
        <div className="grid grid-cols-2 xl:grid-cols-4 gap-2">
          {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-20 rounded-2xl" />)}
        </div>
      )}
      {/* Four tiles, not five: Verified folded into Evaluations as its own
          sub-line, so the row stays balanced (2-up on phones, 4-up on desktop)
          and every tile goes somewhere. */}
      {totals && (
        <div className="grid grid-cols-2 xl:grid-cols-4 gap-2" data-testid="evals-stat-row">
          <StatCard icon={ClipboardList} tint="bg-brand/15 text-brand" value={totals.evaluations}
            label="Evaluations" sub={`${totals.verified} verified · ${verifiedPct}%`} onClick={scrollToQueue} />
          <StatCard icon={Clock} tint="bg-warning/15 text-warning" value={awaiting}
            label="Awaiting review" sub="In the queue" onClick={scrollToQueue} />
          <StatCard icon={Users} tint="bg-success/15 text-success" value={totals.athletes_evaluated}
            label="Athletes" sub="Evaluated" to="/players" />
          <StatCard icon={Calendar} tint="bg-info/15 text-info" value={totals.events_this_season}
            label="Events" sub="This season" to="/events" />
        </div>
      )}

      {/* C — Insight panels. The column count follows how many panels actually
          render: Top Teams disappears when no athlete has a team, and a fixed
          3-col grid would leave the survivors squeezed beside dead space. */}
      {insights && (
        <div className={cn("grid grid-cols-1 gap-3", panelCount === 3 ? "md:grid-cols-2 xl:grid-cols-3" : "md:grid-cols-2")}>
          <TopPerformersCard performers={insights.top_performers || []} />
          <TopTeamsCard teams={insights.top_teams || []} />
          <PositionDonutCard byPosition={insights.by_position || []} />
        </div>
      )}

      {/* D — Recent evaluations rail */}
      {recent.length > 0 && (
        <div>
          <div className="flex items-center justify-between gap-2">
            <PanelLabel>Recent evaluations</PanelLabel>
            <button
              type="button"
              onClick={() => { setStatusFilter("all"); scrollToQueue(); }}
              className="text-xs font-semibold text-primary hover:underline"
            >
              View all →
            </button>
          </div>
          <div className="mt-2 flex gap-3 overflow-x-auto pb-2 snap-x">
            {recent.map((r) => <RecentEvalCard key={r.id} r={r} />)}
          </div>
        </div>
      )}

      {/* D1.5 — Bulk assessment publishing. Renders nothing unless the role can
          read readiness and there is at least one draft waiting. */}
      <AssessmentsPublishCard onPublished={load} />

      {/* D2 — Pending awards. Nothing renders when the queue is empty (or when
          the role can't review awards) — this page is already dense. */}
      {pendingAwards.length > 0 && (
        <Card className="rounded-2xl border-border bg-card" data-testid="evals-pending-awards">
          <CardContent className="pt-4 pb-4">
            <div className="flex items-center justify-between gap-2">
              <PanelLabel>Pending awards</PanelLabel>
              <span className="rounded-full bg-warning/15 px-2 py-0.5 text-[11px] font-mono-num font-bold text-warning">
                {pendingAwards.length}
              </span>
            </div>
            <div className="mt-2 space-y-1">
              {pendingAwards.map((aw) => {
                const a = awardAthletes[aw.athlete_id];
                const submitted = shortDate(aw.created_at);
                const sub = [aw.category, aw.submitted_by_name && `by ${aw.submitted_by_name}`].filter(Boolean).join(" · ");
                return (
                  <div key={aw.id} className="flex flex-wrap items-center gap-3 rounded-lg px-2 py-2">
                    <PlayerAvatar firstName={a?.first_name} lastName={a?.last_name} photoUrl={a?.photo_url} size="sm" />
                    <div className="flex-1 min-w-[160px]">
                      <Link to={`/players/${aw.athlete_id}`} className="text-sm font-semibold text-foreground hover:underline">
                        {a ? `${a.first_name} ${a.last_name}` : "Athlete"}
                      </Link>
                      <p className="text-sm text-foreground truncate">{aw.title}</p>
                      {sub && <p className="text-xs text-muted-foreground capitalize truncate">{sub}</p>}
                    </div>
                    {submitted !== "—" && (
                      <span className="flex items-center gap-1 text-[11px] text-muted-foreground shrink-0">
                        <Calendar className="h-3 w-3" /> {submitted}
                      </span>
                    )}
                    <div className="flex items-center gap-2 shrink-0">
                      <Button size="sm" variant="outline" className="rounded-lg h-9" onClick={() => decideAward(aw.id, false)} data-testid={`award-reject-${aw.id}`}>
                        <XCircle className="h-3.5 w-3.5 mr-1" /> Reject
                      </Button>
                      <Button size="sm" className="rounded-lg h-9 bg-success hover:bg-[hsl(var(--success))]" onClick={() => decideAward(aw.id, true)} data-testid={`award-approve-${aw.id}`}>
                        <CheckCircle2 className="h-3.5 w-3.5 mr-1" /> Approve
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      {/* E — Review queue */}
      <div id="review-queue" className="space-y-3 scroll-mt-4">
        <div className="flex items-center gap-2.5">
          <h2 className="font-display text-2xl text-foreground">Review queue</h2>
          {queue && (
            <span className="rounded-full bg-warning/15 px-2.5 py-0.5 text-xs font-mono-num font-bold text-warning">
              {awaiting} awaiting
            </span>
          )}
        </div>

        {disagreements && disagreements.length > 0 && (
          <Card className="rounded-2xl border-warning/40 bg-warning/10">
            <CardContent className="py-4">
              <p className="font-semibold text-sm text-warning flex items-center gap-2"><AlertTriangle className="h-4 w-4" /> Evaluator disagreements (largest spread first)</p>
              <div className="mt-2 space-y-1.5">
                {disagreements.slice(0, 5).map((d, i) => (
                  <div key={i} className="flex items-center justify-between text-xs">
                    <span>{d.athlete?.first_name} {d.athlete?.last_name} · {d.station_name}</span>
                    <span className="font-mono-num font-semibold">spread {d.spread} ({d.scores.map((s) => s.score).join(" vs ")})</span>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        {queue === null ? (
          <div className="space-y-2">{[...Array(5)].map((_, i) => <Skeleton key={i} className="h-20 rounded-2xl" />)}</div>
        ) : filtered.length === 0 ? (
          <EmptyState icon={ClipboardList} title="Queue is clear" hint="Submitted evaluations will appear here for review and approval." />
        ) : (
          <div className="space-y-2">
            {filtered.map((ev) => (
              <Card key={ev.id} className="rounded-2xl border-border" data-testid={`review-item-${ev.id}`}>
                <CardContent className="py-4">
                  <div className="flex items-center gap-3">
                    <PlayerAvatar firstName={ev.athlete?.first_name} lastName={ev.athlete?.last_name} size="sm" />
                    <div className="flex-1 min-w-0">
                      <Link to={`/players/${ev.athlete_id}`} className="text-sm font-semibold text-foreground hover:underline">
                        {ev.athlete?.first_name} {ev.athlete?.last_name}
                      </Link>
                      <p className="text-xs text-muted-foreground">{ev.station_name} · {ev.event_name} · by {ev.evaluator_name}</p>
                    </div>
                    <p className="font-mono-num font-bold text-lg text-foreground">{ev.computed?.overall_score ?? "—"}</p>
                    <StatusBadge status={ev.status} />
                  </div>
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <button
                      onClick={() => setExpanded((x) => ({ ...x, [ev.id]: !x[ev.id] }))}
                      className="inline-flex items-center gap-1 text-xs font-semibold text-info"
                      data-testid={`review-expand-${ev.id}`}
                    >
                      {expanded[ev.id] ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />} {expanded[ev.id] ? "Hide detail" : "View detail"}
                    </button>
                    <Link
                      to={`/evaluation/${ev.id}/results`}
                      className="inline-flex items-center gap-1 text-xs font-semibold text-brand"
                      data-testid={`review-results-${ev.id}`}
                    >
                      <BarChart3 className="h-3.5 w-3.5" /> Results summary
                    </Link>
                    <div className="flex-1" />
                    {ev.status === "submitted" && (
                      <>
                        <Button size="sm" variant="outline" className="rounded-lg h-9" onClick={() => openReview(ev, "return")} data-testid="review-return-button">
                          <Undo2 className="h-3.5 w-3.5 mr-1" /> Return
                        </Button>
                        <Button size="sm" className="rounded-lg h-9 bg-success hover:bg-[hsl(var(--success))]" onClick={() => act(ev.id, "approve")} data-testid="review-approve-button">
                          <CheckCircle2 className="h-3.5 w-3.5 mr-1" /> Approve
                        </Button>
                      </>
                    )}
                    {ev.status === "approved" && (
                      <Button size="sm" variant="outline" className="rounded-lg h-9" onClick={() => openReview(ev, "unlock")} data-testid="review-unlock-button">
                        <Unlock className="h-3.5 w-3.5 mr-1" /> Unlock
                      </Button>
                    )}
                  </div>
                  {expanded[ev.id] && <EvalDetail ev={{ ...ev, template_metrics: Object.values(templates).filter((m) => (ev.computed?.metric_results || {})[m.id]) }} />}
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>

      <Dialog open={!!reviewFor} onOpenChange={(v) => !v && setReviewFor(null)}>
        <DialogContent className="rounded-2xl max-w-sm">
          <DialogHeader>
            <DialogTitle className="font-display text-2xl text-foreground">
              {reviewAction === "unlock" ? "Unlock evaluation" : "Return for Revision"}
            </DialogTitle>
          </DialogHeader>
          {reviewAction === "unlock" ? (
            <p className="text-sm text-muted-foreground">
              This evaluation goes back to {reviewFor?.evaluator_name} as a draft and its approval is withdrawn. Add a reason — it is recorded in the audit log.
            </p>
          ) : (
            <p className="text-sm text-muted-foreground">The evaluation will be unlocked and sent back to {reviewFor?.evaluator_name}. Add a note explaining what needs revision.</p>
          )}
          <Textarea
            value={reviewNote}
            onChange={(e) => setReviewNote(e.target.value)}
            rows={3}
            className="rounded-xl"
            placeholder={reviewAction === "unlock" ? "Reason for unlocking…" : "Reason for return…"}
            data-testid="review-return-reason-textarea"
          />
          <DialogFooter>
            <Button
              className="w-full rounded-xl bg-primary h-11"
              onClick={() => act(reviewFor.id, reviewAction, reviewNote)}
              disabled={!reviewNote.trim()}
              data-testid={reviewAction === "unlock" ? "review-unlock-confirm" : "review-return-confirm"}
            >
              {reviewAction === "unlock" ? "Unlock evaluation" : "Return Evaluation"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
