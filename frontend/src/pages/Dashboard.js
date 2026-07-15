import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusBadge } from "@/components/common/StatusBadge";
import { PlayerAvatar } from "@/components/common/PlayerAvatar";
import { EmptyState } from "@/components/common/EmptyState";
import {
  CalendarPlus, Upload, UserCog, ClipboardCheck, ArrowRight, Users,
  CheckCircle2, ClipboardList, Flag, Activity, CalendarDays, Trophy, FileDown,
} from "lucide-react";
import { signedUrl } from "@/lib/api";

const StatCard = ({ label, value, icon: Icon, accent = "#0B1E3A", testId }) => (
  <Card className="rounded-2xl card-shadow border-[#E7E1D6]" data-testid={testId}>
    <CardContent className="pt-5 pb-5 flex items-center gap-3.5">
      <div className="h-11 w-11 rounded-xl flex items-center justify-center shrink-0" style={{ backgroundColor: `${accent}14` }}>
        <Icon className="h-5.5 w-5 h-5" style={{ color: accent }} />
      </div>
      <div className="min-w-0">
        <p className="text-2xl font-bold text-[#0B1E3A] leading-none font-mono-num">{value ?? "—"}</p>
        <p className="text-xs text-slate-500 mt-1.5">{label}</p>
      </div>
    </CardContent>
  </Card>
);

const QuickAction = ({ to, onClick, icon: Icon, label, testId }) => {
  const inner = (
    <div className="flex items-center gap-3 rounded-xl border bg-white px-4 py-3.5 hover:bg-[hsl(var(--secondary))] transition-colors active:scale-[0.98] cursor-pointer">
      <Icon className="h-5 w-5 text-[#0B1E3A]" />
      <span className="text-sm font-semibold text-slate-700 flex-1">{label}</span>
      <ArrowRight className="h-4 w-4 text-slate-300" />
    </div>
  );
  if (to) return <Link to={to} data-testid={testId}>{inner}</Link>;
  return <button onClick={onClick} data-testid={testId} className="w-full text-left">{inner}</button>;
};

export default function Dashboard() {
  const { user } = useAuth();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  useEffect(() => {
    api.get("/dashboard").then((r) => setData(r.data)).finally(() => setLoading(false));
  }, []);

  if (loading)
    return (
      <div className="space-y-4">
        <Skeleton className="h-10 w-56" />
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-24 rounded-2xl" />)}
        </div>
        <Skeleton className="h-64 rounded-2xl" />
      </div>
    );

  const role = data?.role || user?.role;

  // -------- EVALUATOR DASHBOARD --------
  if (role === "evaluator") {
    const assignments = data?.assignments || [];
    return (
      <div className="space-y-5" data-testid="evaluator-dashboard">
        <div>
          <h1 className="font-display text-4xl text-[#0B1E3A]">My Evaluations</h1>
          <p className="text-sm text-slate-500">Welcome back, {user?.full_name?.split(" ")[0]}. Here are your station assignments.</p>
        </div>
        {assignments.length === 0 ? (
          <EmptyState icon={ClipboardCheck} title="No assignments yet" hint="Your administrator will assign you to an event station. Check back soon." />
        ) : (
          <div className="grid gap-4 md:grid-cols-2">
            {assignments.map((a) => (
              <Card key={a.assignment_id} className="rounded-2xl card-shadow border-[#E7E1D6] overflow-hidden">
                <div className="bg-[#0B1E3A] px-5 py-3 flex items-center justify-between">
                  <p className="text-white font-semibold text-sm truncate">{a.event?.name}</p>
                  <StatusBadge status={a.event?.status} />
                </div>
                <CardContent className="pt-4 pb-5 space-y-3">
                  <div className="grid grid-cols-2 gap-3 text-sm">
                    <div>
                      <p className="text-xs text-slate-400 uppercase tracking-wide">My Station</p>
                      <p className="font-semibold text-[#0B1E3A]">{a.station_name}</p>
                    </div>
                    <div>
                      <p className="text-xs text-slate-400 uppercase tracking-wide">My Groups</p>
                      <p className="font-semibold text-[#0B1E3A] truncate">{(a.group_names || []).join(", ") || "All groups"}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-4">
                    <div className="flex-1 h-2.5 rounded-full bg-[hsl(var(--muted))] overflow-hidden">
                      <div className="h-full rounded-full bg-[#1F7A4D] transition-all" style={{ width: `${a.expected ? Math.round((a.completed / a.expected) * 100) : 0}%` }} />
                    </div>
                    <p className="text-xs font-mono-num text-slate-600 whitespace-nowrap">{a.completed}/{a.expected} done</p>
                  </div>
                  {a.last_saved && <p className="text-xs text-slate-400">Last saved: {new Date(a.last_saved).toLocaleString()}</p>}
                  <Button
                    className="w-full h-12 rounded-xl bg-[#0B1E3A] hover:bg-[#102A4F] text-base font-semibold active:scale-[0.98]"
                    onClick={() => navigate(`/evaluate/${a.assignment_id}`)}
                    data-testid={`continue-evaluating-${a.assignment_id}`}
                  >
                    {a.completed > 0 ? "Continue Evaluating" : "Start Evaluating"}
                    <ArrowRight className="h-4 w-4 ml-1" />
                  </Button>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>
    );
  }

  // -------- HEAD SCOUT DASHBOARD --------
  if (role === "head_scout") {
    return (
      <div className="space-y-5" data-testid="head-scout-dashboard">
        <div>
          <h1 className="font-display text-4xl text-[#0B1E3A]">Scout Dashboard</h1>
          <p className="text-sm text-slate-500">Review submitted evaluations and track top performers.</p>
        </div>
        <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
          <StatCard label="Awaiting Review" value={data.awaiting_review} icon={ClipboardList} accent="#B45309" testId="stat-awaiting-review" />
          <StatCard label="Approved" value={data.approved} icon={CheckCircle2} accent="#1F7A4D" testId="stat-approved" />
          <StatCard label="Flagged for Follow-Up" value={data.flagged_players} icon={Flag} accent="#C81D25" testId="stat-flagged" />
        </div>
        <div className="grid gap-4 lg:grid-cols-2">
          <Card className="rounded-2xl card-shadow border-[#E7E1D6]">
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center justify-between text-base">
                <span className="flex items-center gap-2"><Trophy className="h-4 w-4 text-[#F4B400]" /> Top Players</span>
                <Link to="/reports" className="text-xs text-[#1F4AA8] hover:underline font-normal">View leaderboard</Link>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {(data.top_players || []).length === 0 && <p className="text-sm text-slate-400 py-4 text-center">No scored evaluations yet.</p>}
              {(data.top_players || []).map((p, i) => (
                <Link key={p.athlete.id} to={`/players/${p.athlete.id}`} className="flex items-center gap-3 rounded-xl px-2 py-2 hover:bg-[hsl(var(--secondary))] transition-colors" data-testid={`top-player-${i}`}>
                  <span className="font-display text-xl text-[#F4B400] w-6 text-center">{i + 1}</span>
                  <PlayerAvatar firstName={p.athlete.first_name} lastName={p.athlete.last_name} size="sm" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-[#0B1E3A] truncate">{p.athlete.first_name} {p.athlete.last_name}</p>
                    <p className="text-xs text-slate-500">{p.athlete.age_group} · {p.athlete.primary_position}</p>
                  </div>
                  <span className="font-mono-num font-bold text-[#0B1E3A]">{p.overall_score}</span>
                </Link>
              ))}
            </CardContent>
          </Card>
          <Card className="rounded-2xl card-shadow border-[#E7E1D6]">
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center justify-between text-base">
                <span>Recent Staff Notes</span>
                <Link to="/review" className="text-xs text-[#1F4AA8] hover:underline font-normal">Open review queue</Link>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {(data.recent_notes || []).length === 0 && <p className="text-sm text-slate-400 py-4 text-center">No notes yet.</p>}
              {(data.recent_notes || []).map((n) => (
                <div key={n.id} className="rounded-xl border px-3.5 py-2.5">
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-semibold text-[#0B1E3A]">{n.athlete_name}</p>
                    <span className="text-[11px] text-slate-400">{(n.created_at || "").slice(0, 10)}</span>
                  </div>
                  <p className="text-xs text-slate-500 mt-0.5 line-clamp-2">{n.summary || n.strengths || n.assessment_type}</p>
                  <p className="text-[11px] text-slate-400 mt-1">{n.author_name}</p>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>
        <Button onClick={() => navigate("/review")} className="h-12 rounded-xl bg-[#0B1E3A] hover:bg-[#102A4F] px-6" data-testid="open-review-queue-button">
          Open Review Queue <ArrowRight className="h-4 w-4 ml-1" />
        </Button>
      </div>
    );
  }

  // -------- ADMIN / OWNER / COACH DASHBOARD --------
  const ev = data?.upcoming_event;
  const stats = data?.event_stats || {};
  const isAdmin = role === "owner" || role === "admin";
  return (
    <div className="space-y-5" data-testid="admin-dashboard">
      <div>
        <h1 className="font-display text-4xl text-[#0B1E3A]">Dashboard</h1>
        <p className="text-sm text-slate-500">Welcome back, {user?.full_name?.split(" ")[0]}.</p>
      </div>

      {ev ? (
        <Card className="rounded-2xl card-shadow border-[#E7E1D6] overflow-hidden">
          <div className="hero-sweep px-5 py-4 border-b flex flex-wrap items-center justify-between gap-2">
            <div>
              <p className="text-xs uppercase tracking-widest text-slate-500">Upcoming / Active Event</p>
              <Link to={`/events/${ev.id}`} className="font-display text-2xl text-[#0B1E3A] hover:underline" data-testid="dashboard-event-link">{ev.name}</Link>
              <p className="text-xs text-slate-500 flex items-center gap-1 mt-0.5"><CalendarDays className="h-3.5 w-3.5" /> {ev.date} · {ev.location}</p>
            </div>
            <StatusBadge status={ev.status} testId="event-status-badge" />
          </div>
          <CardContent className="pt-4 pb-5">
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              <StatCard label="Registered Players" value={stats.registered} icon={Users} testId="stat-registered" />
              <StatCard label="Checked In" value={stats.checked_in} icon={CheckCircle2} accent="#1F7A4D" testId="stat-checked-in" />
              <StatCard label="Evaluations Completed" value={stats.evaluations_completed} icon={ClipboardCheck} accent="#1F4AA8" testId="stat-evals-completed" />
              <StatCard label="Drafts In Progress" value={stats.evaluations_draft} icon={Activity} accent="#B45309" testId="stat-evals-draft" />
            </div>
          </CardContent>
        </Card>
      ) : (
        <EmptyState icon={CalendarDays} title="No events yet" hint="Create your first evaluation event to get started."
          action={isAdmin && <Button onClick={() => navigate("/events")} className="rounded-xl bg-[#0B1E3A]">Create Event</Button>} />
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        {isAdmin && (
          <Card className="rounded-2xl card-shadow border-[#E7E1D6]">
            <CardHeader className="pb-2"><CardTitle className="text-base">Quick Actions</CardTitle></CardHeader>
            <CardContent className="space-y-2">
              <QuickAction to="/events" icon={CalendarPlus} label="Create Event" testId="quick-action-create-event" />
              <QuickAction to="/players/import" icon={Upload} label="Import Players" testId="quick-action-import-players" />
              {ev && <QuickAction to={`/events/${ev.id}?tab=evaluators`} icon={UserCog} label="Assign Evaluators" testId="quick-action-assign-evaluators" />}
              {ev && <QuickAction to={`/events/${ev.id}?tab=checkin`} icon={ClipboardCheck} label="Open Check-In" testId="quick-action-open-checkin" />}
              {ev && <QuickAction to={`/events/${ev.id}?tab=progress`} icon={Activity} label="View Live Progress" testId="quick-action-live-progress" />}
              {ev && <QuickAction onClick={() => window.open(signedUrl(`/reports/event-results/${ev.id}/csv`), "_blank")} icon={FileDown} label="Export Results" testId="quick-action-export-results" />}
            </CardContent>
          </Card>
        )}
        <Card className="rounded-2xl card-shadow border-[#E7E1D6]">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center justify-between text-base">
              <span>Recently Added Players</span>
              <Link to="/players" className="text-xs text-[#1F4AA8] hover:underline font-normal">View all ({data?.total_players})</Link>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-1.5">
            {(data?.recent_players || []).map((p) => (
              <Link key={p.id} to={`/players/${p.id}`} className="flex items-center gap-3 rounded-xl px-2 py-2 hover:bg-[hsl(var(--secondary))] transition-colors">
                <PlayerAvatar firstName={p.first_name} lastName={p.last_name} size="sm" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-[#0B1E3A] truncate">{p.first_name} {p.last_name}</p>
                  <p className="text-xs text-slate-500">{p.age_group} · {p.primary_position}</p>
                </div>
                <ArrowRight className="h-4 w-4 text-slate-300" />
              </Link>
            ))}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
