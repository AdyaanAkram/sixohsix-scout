import { CheckCircle2, CloudOff, Loader2, RefreshCw, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";

const CONFIG = {
  idle: { label: "Ready", icon: CheckCircle2, cls: "bg-secondary text-muted-foreground border-border" },
  saving: { label: "Saving", icon: Loader2, cls: "bg-[hsl(var(--info) / 0.2)] text-[hsl(var(--info))] border-[hsl(var(--info) / 0.3)]", spin: true },
  saved: { label: "Synced", icon: CheckCircle2, cls: "bg-success/15 text-success border-success/40" },
  offline: { label: "On device", icon: CloudOff, cls: "bg-warning/15 text-warning border-warning/40" },
  sync_pending: { label: "Sync pending", icon: RefreshCw, cls: "bg-[hsl(var(--warning) / 0.2)] text-[hsl(var(--warning))] border-[hsl(var(--warning) / 0.35)]" },
  error: { label: "Tap to retry", icon: AlertTriangle, cls: "bg-destructive/15 text-destructive border-destructive/40" },
};

export const SaveStatusPill = ({ status = "idle", lastSaved, onRetry }) => {
  const c = CONFIG[status] || CONFIG.idle;
  const Icon = c.icon;
  const canRetry = status === "error" || status === "sync_pending" || status === "offline";
  const Comp = canRetry && onRetry ? "button" : "span";
  return (
    <Comp
      type={Comp === "button" ? "button" : undefined}
      onClick={canRetry && onRetry ? onRetry : undefined}
      data-testid="evaluation-save-status"
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1.5 text-xs font-semibold whitespace-nowrap min-h-[32px]",
        c.cls,
        Comp === "button" && "active:scale-[0.97] cursor-pointer"
      )}
    >
      <Icon className={cn("h-3.5 w-3.5", c.spin && "animate-spin")} />
      {c.label}
      {status === "saved" && lastSaved && (
        <span className="font-normal opacity-75">· {lastSaved}</span>
      )}
    </Comp>
  );
};
