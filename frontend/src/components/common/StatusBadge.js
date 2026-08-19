import { cn } from "@/lib/utils";
import { BadgeCheck, ShieldCheck, CircleDashed } from "lucide-react";

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

/*
  Verification sources (spec §16). The keys are exactly what the backend stores on a
  measurement — do not localise or re-key them. Unverified tiers must stay visually
  weaker than verified tiers so a coach can triage trustworthiness at a glance.
*/
const VERIFICATION_SOURCES = {
  athlete_submitted: {
    label: "Athlete Submitted",
    verified: false,
    style: "border-dashed border-border-strong bg-transparent text-muted-foreground",
    Icon: CircleDashed,
  },
  parent_submitted: {
    label: "Parent Submitted",
    verified: false,
    style: "border-dashed border-border-strong bg-transparent text-muted-foreground",
    Icon: CircleDashed,
  },
  coach_submitted: {
    label: "Coach Submitted",
    verified: true,
    style: "bg-success/15 text-success border-success/40",
    Icon: BadgeCheck,
  },
  event_verified: {
    label: "Event Verified",
    verified: true,
    style: "bg-success/15 text-success border-success/40",
    Icon: BadgeCheck,
  },
  device_verified: {
    label: "Device Verified",
    verified: true,
    style: "bg-[hsl(var(--info)_/_0.15)] text-info border-[hsl(var(--info)_/_0.4)]",
    Icon: BadgeCheck,
  },
  id_verified: {
    label: "60'6\" Verified",
    verified: true,
    style: "bg-brand text-white border-brand",
    Icon: ShieldCheck,
  },
};

const UNKNOWN_VERIFICATION = {
  label: "Unverified",
  verified: false,
  style: "border-dashed border-border-strong bg-transparent text-muted-foreground",
  Icon: CircleDashed,
};

/** True only for the four trusted sources — never for unknown/missing input. */
export const isVerifiedSource = (source) => Boolean(VERIFICATION_SOURCES[source]?.verified);

export const verificationLabel = (source) =>
  (VERIFICATION_SOURCES[source] || UNKNOWN_VERIFICATION).label;

export const VerificationBadge = ({ source, compact, iconOnly, className, testId }) => {
  const cfg = VERIFICATION_SOURCES[source] || UNKNOWN_VERIFICATION;
  const { Icon } = cfg;
  const title = cfg.verified ? `${cfg.label} measurement` : `${cfg.label} — not independently verified`;
  if (iconOnly) {
    // Tight layouts (metric mini-grids): just the mark, full meaning on hover.
    return (
      <span
        data-testid={testId || "verification-badge"}
        data-source={VERIFICATION_SOURCES[source] ? source : "unknown"}
        data-verified={cfg.verified ? "true" : "false"}
        title={title}
        aria-label={title}
        className={cn("inline-flex shrink-0", cfg.verified ? "text-success" : "text-muted-foreground", className)}
      >
        <Icon className="h-3.5 w-3.5" />
      </span>
    );
  }
  return (
    <span
      data-testid={testId || "verification-badge"}
      data-source={VERIFICATION_SOURCES[source] ? source : "unknown"}
      data-verified={cfg.verified ? "true" : "false"}
      title={title}
      className={cn(
        "inline-flex items-center gap-1 whitespace-nowrap rounded-full border font-semibold uppercase tracking-wide",
        compact ? "px-1.5 py-0 text-[10px]" : "px-2.5 py-0.5 text-xs",
        cfg.style,
        className
      )}
    >
      <Icon className={compact ? "h-2.5 w-2.5 shrink-0" : "h-3 w-3 shrink-0"} />
      {cfg.label}
    </span>
  );
};
