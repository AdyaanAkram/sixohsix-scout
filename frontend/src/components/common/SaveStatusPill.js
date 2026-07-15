import { CheckCircle2, CloudOff, Loader2, RefreshCw, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";

const CONFIG = {
  idle: { label: "Ready", icon: CheckCircle2, cls: "bg-slate-100 text-slate-600 border-slate-200" },
  saving: { label: "Saving", icon: Loader2, cls: "bg-[#E0F2FE] text-[#0E7490] border-[#BAE6FD]", spin: true },
  saved: { label: "Saved", icon: CheckCircle2, cls: "bg-[#EAF7EF] text-[#1F7A4D] border-[#BFE6CC]" },
  offline: { label: "Offline", icon: CloudOff, cls: "bg-[#FFF7E6] text-[#B45309] border-[#FFD9A3]" },
  sync_pending: { label: "Sync Pending", icon: RefreshCw, cls: "bg-[#FEF3C7] text-[#92400E] border-[#FDE68A]" },
  error: { label: "Save Error", icon: AlertTriangle, cls: "bg-[#FDECEC] text-[#7F1D1D] border-[#F8B4B4]" },
};

export const SaveStatusPill = ({ status = "idle", lastSaved }) => {
  const c = CONFIG[status] || CONFIG.idle;
  const Icon = c.icon;
  return (
    <span
      data-testid="evaluation-save-status"
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold whitespace-nowrap",
        c.cls
      )}
    >
      <Icon className={cn("h-3.5 w-3.5", c.spin && "animate-spin")} />
      {c.label}
      {status === "saved" && lastSaved && (
        <span className="font-normal opacity-75">· {lastSaved}</span>
      )}
    </span>
  );
};
