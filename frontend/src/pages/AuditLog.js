import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { EmptyState } from "@/components/common/EmptyState";
import { Skeleton } from "@/components/ui/skeleton";
import { ScrollText } from "lucide-react";

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

export default function AuditLog() {
  const [logs, setLogs] = useState(null);

  useEffect(() => {
    api.get("/audit-logs", { params: { limit: 200 } }).then((r) => setLogs(r.data)).catch(() => setLogs([]));
  }, []);

  if (!logs) return <Skeleton className="h-64 rounded-2xl" />;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="font-display text-3xl sm:text-4xl text-foreground">Audit Log</h1>
        <p className="text-sm text-muted-foreground">Record of sensitive actions across the organization.</p>
      </div>
      {logs.length === 0 ? (
        <EmptyState icon={ScrollText} title="No audit entries" hint="Actions like sign-ins, submissions, and exports are recorded here." />
      ) : (
        <Card className="rounded-2xl border-border overflow-hidden">
          <div className="overflow-x-auto">
            <Table data-testid="audit-log-table">
              <TableHeader>
                <TableRow className="bg-secondary">
                  <TableHead>When</TableHead><TableHead>Who</TableHead><TableHead>Action</TableHead><TableHead>Details</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {logs.map((l) => (
                  <TableRow key={l.id}>
                    <TableCell className="text-xs text-muted-foreground whitespace-nowrap">{new Date(l.created_at).toLocaleString()}</TableCell>
                    <TableCell className="text-sm font-medium whitespace-nowrap">{l.actor_name || "System"}</TableCell>
                    <TableCell className="text-sm">{ACTION_LABELS[l.action] || l.action}</TableCell>
                    <TableCell className="text-xs text-muted-foreground max-w-[300px] truncate">
                      {l.details && Object.keys(l.details).length > 0 ? Object.entries(l.details).filter(([k]) => k !== "reset_token").map(([k, v]) => `${k}: ${typeof v === "object" ? JSON.stringify(v) : v}`).join(" · ") : "—"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </Card>
      )}
    </div>
  );
}
