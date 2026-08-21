import { CheckCircle2, CloudOff, Loader2, RefreshCw, AlertTriangle, HardDrive } from "lucide-react";
import { cn } from "@/lib/utils";

// The one question this pill answers for an evaluator mid-session is "is my
// work safe?" — so every state that IS safe says "Saved" first, and only a
// genuine failure says otherwise. "Synced" / "Sync pending" / "On device" were
// accurate but left a coach guessing which of them meant they had lost a rep.
// `title` carries the longer reassurance for anyone who wants it.
const CONFIG = {
  idle: {
    label: "Ready", icon: CheckCircle2,
    title: "Ready to score. Everything you tap saves by itself.",
    cls: "bg-secondary text-muted-foreground border-border",
  },
  saving: {
    label: "Saving…", icon: Loader2,
    title: "Saving your scores now.",
    cls: "bg-[hsl(var(--info) / 0.2)] text-[hsl(var(--info))] border-[hsl(var(--info) / 0.3)]", spin: true,
  },
  saved: {
    label: "Saved", icon: CheckCircle2,
    title: "Saved. Your scores are safely stored.",
    cls: "bg-success/15 text-success border-success/40",
  },
  offline: {
    label: "Saved on device", icon: CloudOff,
    title: "No signal. Your scores are saved on this device and will send by themselves once you are back online — nothing is lost.",
    cls: "bg-warning/15 text-warning border-warning/40",
  },
  sync_pending: {
    label: "Saved · sending", icon: RefreshCw,
    title: "Saved on this device and still sending. Tap to try again now.",
    cls: "bg-[hsl(var(--warning) / 0.2)] text-[hsl(var(--warning))] border-[hsl(var(--warning) / 0.35)]",
  },
  error: {
    label: "Tap to retry", icon: AlertTriangle,
    title: "Could not send your scores. They are still on this device — tap to try again.",
    cls: "bg-destructive/15 text-destructive border-destructive/40",
  },
};

export const SaveStatusPill = ({ status = "idle", lastSaved, onRetry, warning }) => {
  const c = CONFIG[status] || CONFIG.idle;
  const Icon = c.icon;
  const canRetry = status === "error" || status === "sync_pending" || status === "offline";
  const Comp = canRetry && onRetry ? "button" : "span";
  return (
    <span className="inline-flex items-center gap-1.5 shrink-0">
      <Comp
        type={Comp === "button" ? "button" : undefined}
        onClick={canRetry && onRetry ? onRetry : undefined}
        data-testid="evaluation-save-status"
        title={c.title}
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
      {/* Storage pressure is reported alongside, never instead of, save state —
          a full device does not mean the save failed. */}
      {warning && (
        <span
          title={warning}
          aria-label={warning}
          data-testid="evaluation-storage-warning"
          className="inline-flex items-center justify-center rounded-full border border-warning/40 bg-warning/15 text-warning h-8 w-8"
        >
          <HardDrive className="h-3.5 w-3.5" />
        </span>
      )}
    </span>
  );
};
