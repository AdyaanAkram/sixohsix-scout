import { cn } from "@/lib/utils";

const STYLES = {
  // event statuses
  "Draft": "bg-[hsl(var(--divider))] text-[hsl(var(--foreground))] border-[hsl(var(--border-strong))]",
  "Registration Open": "bg-[hsl(var(--info) / 0.15)] text-[hsl(var(--brand-secondary))] border-[hsl(var(--info) / 0.4)]",
  "Registration Closed": "bg-[hsl(var(--divider))] text-[hsl(var(--foreground))] border-[hsl(var(--border-strong))]",
  "Check-In Open": "bg-warning/15 text-warning border-warning/40",
  "Evaluation Active": "bg-success/15 text-success border-success/40",
  "Evaluation Complete": "bg-[hsl(var(--info) / 0.15)] text-info border-[hsl(var(--info) / 0.4)]",
  "Reports Under Review": "bg-[hsl(var(--info) / 0.15)] text-info border-[hsl(var(--info) / 0.4)]",
  "Closed": "bg-secondary text-muted-foreground border-border",
  // evaluation statuses
  draft: "bg-[hsl(var(--divider))] text-[hsl(var(--foreground))] border-[hsl(var(--border-strong))]",
  submitted: "bg-[hsl(var(--info) / 0.15)] text-[hsl(var(--brand-secondary))] border-[hsl(var(--info) / 0.4)]",
  approved: "bg-success/15 text-success border-success/40",
  returned: "bg-destructive/15 text-destructive border-destructive/40",
  not_started: "bg-card text-muted-foreground border-border",
  // check-in
  registered: "bg-[hsl(var(--divider))] text-[hsl(var(--foreground))] border-[hsl(var(--border-strong))]",
  checked_in: "bg-success/15 text-success border-success/40",
  absent: "bg-destructive/15 text-destructive border-destructive/40",
  // goals
  "Not Started": "bg-[hsl(var(--divider))] text-[hsl(var(--foreground))] border-[hsl(var(--border-strong))]",
  "Active": "bg-[hsl(var(--info) / 0.15)] text-[hsl(var(--brand-secondary))] border-[hsl(var(--info) / 0.4)]",
  "Improving": "bg-success/15 text-success border-success/40",
  "Needs Attention": "bg-warning/15 text-warning border-warning/40",
  "Completed": "bg-[hsl(var(--info) / 0.15)] text-info border-[hsl(var(--info) / 0.4)]",
  "Archived": "bg-secondary text-muted-foreground border-border",
  // athlete
  active: "bg-success/15 text-success border-success/40",
  archived: "bg-secondary text-muted-foreground border-border",
  merged: "bg-secondary text-muted-foreground border-border",
};

const LABELS = {
  draft: "Draft",
  submitted: "Submitted",
  approved: "Approved",
  returned: "Returned",
  not_started: "Not Started",
  registered: "Registered",
  checked_in: "Checked In",
  absent: "Absent",
  active: "Active",
  archived: "Archived",
  merged: "Merged",
};

export const StatusBadge = ({ status, className, testId }) => {
  if (!status) return null;
  return (
    <span
      data-testid={testId || "status-badge"}
      className={cn(
        "inline-flex items-center whitespace-nowrap rounded-full border px-2.5 py-0.5 text-xs font-semibold",
        STYLES[status] || "bg-secondary text-foreground border-border",
        className
      )}
    >
      {LABELS[status] || status}
    </span>
  );
};
