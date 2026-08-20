import { useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/common/EmptyState";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import {
  CalendarDays, Camera, CheckCircle2, ClipboardCheck, ClipboardList, FileDown, FileText,
  Flag, KeyRound, Layers, LogIn, Mail, ScrollText, Settings, Target, Trash2, Undo2,
  Unlock, Upload, UserCog, UserPlus, Users,
} from "lucide-react";

const ACTION_LABELS = {
  login: "Signed in", evaluation_submitted: "Evaluation submitted", evaluation_approved: "Evaluation approved",
  evaluation_returned: "Evaluation returned", evaluation_unlocked: "Evaluation unlocked (authorized revision)",
  athlete_created: "Player created", athlete_updated: "Player updated", athlete_archived: "Player archived",
  athletes_imported: "Players imported", athletes_exported: "Players exported", athletes_merged: "Players merged",
  event_created: "Event created", event_updated: "Event updated", event_status_changed: "Event status changed",
  check_in_updated: "Check-in updated", walk_up_added: "Walk-up player added", roster_updated: "Roster updated",
  evaluator_assigned: "Evaluator assigned", invite_sent: "Invitation sent", invite_accepted: "Invitation accepted",
  staff_updated: "Staff updated", goal_created: "Goal created", goal_updated: "Goal updated",
  assessment_added: "Assessment added", scout_assessment_added: "Scout assessment added",
  media_uploaded: "Media uploaded", media_deleted: "Media deleted", results_exported: "Results exported",
  player_report_generated: "Player report generated", password_reset_requested: "Password reset requested",
  organization_updated: "Organization updated", athlete_flagged: "Player flagged", athlete_unflagged: "Player unflagged",
  roster_player_removed: "Player removed from roster", station_created: "Station created", template_created: "Template created", template_updated: "Template updated",
};

/* --------------------------- action categorisation --------------------------- */

// One tinted icon square per kind of action, so a page of 200 entries can be
// triaged by colour before a single label is read. Reversals and deletions are
// deliberately the loud tints — those are the entries an admin scans for.
const CATEGORIES = {
  auth: { icon: LogIn, tint: "bg-info/15 text-info", group: "Access" },
  security: { icon: KeyRound, tint: "bg-warning/15 text-warning", group: "Security" },
  invite: { icon: Mail, tint: "bg-info/15 text-info", group: "Invitations" },
  evaluation: { icon: ClipboardCheck, tint: "bg-brand/15 text-brand", group: "Evaluation" },
  approval: { icon: CheckCircle2, tint: "bg-success/15 text-success", group: "Approval" },
  returned: { icon: Undo2, tint: "bg-warning/15 text-warning", group: "Reversal" },
  unlocked: { icon: Unlock, tint: "bg-warning/15 text-warning", group: "Reversal" },
  athleteNew: { icon: UserPlus, tint: "bg-brand/15 text-brand", group: "Players" },
  athlete: { icon: Users, tint: "bg-brand/15 text-brand", group: "Players" },
  removal: { icon: Trash2, tint: "bg-destructive/15 text-destructive", group: "Removal" },
  dataIn: { icon: Upload, tint: "bg-success/15 text-success", group: "Import" },
  dataOut: { icon: FileDown, tint: "bg-info/15 text-info", group: "Export" },
  event: { icon: CalendarDays, tint: "bg-info/15 text-info", group: "Events" },
  staff: { icon: UserCog, tint: "bg-info/15 text-info", group: "Staff" },
  goal: { icon: Target, tint: "bg-success/15 text-success", group: "Development" },
  media: { icon: Camera, tint: "bg-secondary text-foreground", group: "Media" },
  report: { icon: FileText, tint: "bg-info/15 text-info", group: "Reports" },
  settings: { icon: Settings, tint: "bg-secondary text-foreground", group: "Settings" },
  flagOn: { icon: Flag, tint: "bg-warning/15 text-warning", group: "Flags" },
  flagOff: { icon: Flag, tint: "bg-success/15 text-success", group: "Flags" },
  station: { icon: Layers, tint: "bg-brand/15 text-brand", group: "Setup" },
  template: { icon: ClipboardList, tint: "bg-brand/15 text-brand", group: "Setup" },
  other: { icon: ScrollText, tint: "bg-secondary text-muted-foreground", group: "Activity" },
};

const ACTION_CATEGORY = {
  login: "auth", password_reset_requested: "security",
  invite_sent: "invite", invite_accepted: "invite",
  evaluation_submitted: "evaluation", assessment_added: "evaluation", scout_assessment_added: "evaluation",
  evaluation_approved: "approval",
  evaluation_returned: "returned", evaluation_unlocked: "unlocked",
  athlete_created: "athleteNew", athlete_updated: "athlete", athletes_merged: "athlete",
  athlete_archived: "removal", media_deleted: "removal", roster_player_removed: "removal",
  athletes_imported: "dataIn",
  athletes_exported: "dataOut", results_exported: "dataOut",
  event_created: "event", event_updated: "event", event_status_changed: "event",
  check_in_updated: "event", walk_up_added: "event", roster_updated: "event",
  evaluator_assigned: "staff", staff_updated: "staff",
  goal_created: "goal", goal_updated: "goal",
  media_uploaded: "media",
  player_report_generated: "report",
  organization_updated: "settings",
  athlete_flagged: "flagOn", athlete_unflagged: "flagOff",
  station_created: "station", template_created: "template", template_updated: "template",
};

const categoryFor = (action) => CATEGORIES[ACTION_CATEGORY[action]] || CATEGORIES.other;

/* --------------------------------- formatting -------------------------------- */

const parseDate = (iso) => {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
};

const clockTime = (d) => d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });

// Relative for anything inside a week — "3 hr ago" is what an admin actually
// wants to know. Older entries fall back to a plain date; the exact timestamp is
// always on the title attribute.
const relTime = (d) => {
  const diff = Date.now() - d.getTime();
  if (diff < 0) return clockTime(d);
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs} hr ago`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days} d ago`;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
};

const dayLabel = (d) => {
  if (!d) return "Undated";
  const today = new Date();
  const yesterday = new Date(today.getTime() - 86400000);
  if (d.toDateString() === today.toDateString()) return "Today";
  if (d.toDateString() === yesterday.toDateString()) return "Yesterday";
  const opts = { weekday: "short", month: "short", day: "numeric" };
  if (d.getFullYear() !== today.getFullYear()) opts.year = "numeric";
  return d.toLocaleDateString("en-US", opts);
};

const MAX_VALUE_CHARS = 180;

// reset_token must never be surfaced — it is a live credential in the payload.
const detailPairs = (details) =>
  Object.entries(details || {})
    .filter(([k]) => k !== "reset_token")
    .map(([k, v]) => {
      const text = typeof v === "object" ? JSON.stringify(v) : String(v);
      return [
        k.replace(/_/g, " "),
        text.length > MAX_VALUE_CHARS ? `${text.slice(0, MAX_VALUE_CHARS)}…` : text,
      ];
    });

const PanelLabel = ({ children }) => (
  <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">{children}</p>
);

/* ----------------------------------- entry ----------------------------------- */

const AuditEntry = ({ log }) => {
  const cat = categoryFor(log.action);
  const Icon = cat.icon;
  const d = parseDate(log.created_at);
  const pairs = detailPairs(log.details);
  const entity = log.entity_type ? String(log.entity_type).replace(/_/g, " ") : null;

  return (
    <div
      className="flex gap-3 border-b border-border px-3 py-3 last:border-b-0 sm:px-4"
      data-testid={`audit-entry-${log.id}`}
    >
      <div className={cn("h-10 w-10 shrink-0 rounded-lg grid place-items-center", cat.tint)}>
        <Icon className="h-5 w-5" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-2">
          <p className="min-w-0 text-sm font-semibold text-foreground">
            {ACTION_LABELS[log.action] || log.action}
          </p>
          <span
            className="shrink-0 whitespace-nowrap text-[11px] text-muted-foreground"
            title={d ? d.toLocaleString() : undefined}
          >
            {d ? relTime(d) : "Undated"}
          </span>
        </div>

        <p className="mt-0.5 text-xs text-muted-foreground">
          <span className="font-semibold text-foreground">{log.actor_name || "System"}</span>
          {log.actor_role ? <span className="capitalize"> · {log.actor_role}</span> : null}
          {d ? <span> · {clockTime(d)}</span> : null}
        </p>

        {entity && (
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            <span className="capitalize">{entity}</span>
            {log.entity_id ? (
              <>
                {" · "}
                <span className="font-mono-num break-all">{log.entity_id}</span>
              </>
            ) : null}
          </p>
        )}

        {pairs.length > 0 && (
          <div className="mt-1.5 flex flex-wrap gap-1">
            {pairs.map(([k, v]) => (
              <span
                key={k}
                className="inline-flex min-w-0 max-w-full items-baseline gap-1 rounded-full bg-secondary px-2 py-0.5 text-[11px]"
              >
                <span className="shrink-0 uppercase tracking-wide text-muted-foreground">{k}</span>
                <span className="min-w-0 break-all text-foreground">{v}</span>
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

/* ----------------------------------- page ------------------------------------ */

export default function AuditLog() {
  const [logs, setLogs] = useState(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    api.get("/audit-logs", { params: { limit: 200 } })
      .then((r) => setLogs(r.data))
      .catch(() => { setFailed(true); setLogs([]); });
  }, []);

  // The endpoint already returns newest-first, so a single pass builds the day
  // buckets in order. Every hook stays above the loading return below.
  const days = useMemo(() => {
    const out = [];
    (logs || []).forEach((l) => {
      const d = parseDate(l.created_at);
      const key = d ? d.toDateString() : "undated";
      const last = out[out.length - 1];
      if (last && last.key === key) last.items.push(l);
      else out.push({ key, label: dayLabel(d), items: [l] });
    });
    return out;
  }, [logs]);

  const header = (
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        <h1 className="font-display text-3xl sm:text-4xl text-foreground">Audit Log</h1>
        <p className="text-sm text-muted-foreground">Record of sensitive actions across the organization.</p>
      </div>
      {logs && logs.length > 0 && (
        <span className="rounded-full bg-brand/15 px-2.5 py-0.5 text-[11px] font-mono-num font-bold text-brand">
          {logs.length} {logs.length === 1 ? "entry" : "entries"}
        </span>
      )}
    </div>
  );

  if (!logs) {
    return (
      <div className="space-y-4">
        {header}
        <div className="space-y-2">
          {[...Array(6)].map((_, i) => <Skeleton key={i} className="h-16 rounded-2xl" />)}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {header}
      {failed ? (
        <EmptyState
          icon={ScrollText}
          title="Audit log unavailable"
          hint="The audit log could not be loaded. Refresh the page — if it keeps failing, your account may not have permission to read it."
        />
      ) : logs.length === 0 ? (
        <EmptyState icon={ScrollText} title="No audit entries" hint="Actions like sign-ins, submissions, and exports are recorded here." />
      ) : (
        <div className="space-y-3" data-testid="audit-log-table">
          {days.map((day, i) => (
            // Index in the key too: if the feed ever comes back out of order the
            // same day can open a second bucket, and the keys must stay unique.
            <Card key={`${day.key}-${i}`} className="rounded-2xl border-border bg-card overflow-hidden">
              <CardContent className="p-0">
                <div className="flex items-center justify-between gap-2 border-b border-border bg-secondary px-3 py-2 sm:px-4">
                  <PanelLabel>{day.label}</PanelLabel>
                  <span className="shrink-0 font-mono-num text-[11px] font-semibold text-muted-foreground">
                    {day.items.length}
                  </span>
                </div>
                {day.items.map((l) => <AuditEntry key={l.id} log={l} />)}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
