import { cn } from "@/lib/utils";

const STYLES = {
  // event statuses
  "Draft": "bg-[#EFE7D7] text-[#0F172A] border-[#E6D9C2]",
  "Registration Open": "bg-[#E6F0FF] text-[#102A4F] border-[#BBD6FF]",
  "Registration Closed": "bg-[#EFE7D7] text-[#0F172A] border-[#E6D9C2]",
  "Check-In Open": "bg-[#FFF7E6] text-[#7C2D12] border-[#FFD9A3]",
  "Evaluation Active": "bg-[#EAF7EF] text-[#14532D] border-[#BFE6CC]",
  "Evaluation Complete": "bg-[#EEF2FF] text-[#1E3A8A] border-[#C7D2FE]",
  "Reports Under Review": "bg-[#EEF2FF] text-[#1E3A8A] border-[#C7D2FE]",
  "Closed": "bg-slate-100 text-slate-600 border-slate-200",
  // evaluation statuses
  draft: "bg-[#EFE7D7] text-[#0F172A] border-[#E6D9C2]",
  submitted: "bg-[#E6F0FF] text-[#102A4F] border-[#BBD6FF]",
  approved: "bg-[#EAF7EF] text-[#14532D] border-[#BFE6CC]",
  returned: "bg-[#FDECEC] text-[#7F1D1D] border-[#F8B4B4]",
  not_started: "bg-white text-slate-500 border-slate-200",
  // check-in
  registered: "bg-[#EFE7D7] text-[#0F172A] border-[#E6D9C2]",
  checked_in: "bg-[#EAF7EF] text-[#14532D] border-[#BFE6CC]",
  absent: "bg-[#FDECEC] text-[#7F1D1D] border-[#F8B4B4]",
  // goals
  "Not Started": "bg-[#EFE7D7] text-[#0F172A] border-[#E6D9C2]",
  "Active": "bg-[#E6F0FF] text-[#102A4F] border-[#BBD6FF]",
  "Improving": "bg-[#EAF7EF] text-[#14532D] border-[#BFE6CC]",
  "Needs Attention": "bg-[#FFF7E6] text-[#7C2D12] border-[#FFD9A3]",
  "Completed": "bg-[#EEF2FF] text-[#1E3A8A] border-[#C7D2FE]",
  "Archived": "bg-slate-100 text-slate-600 border-slate-200",
  // athlete
  active: "bg-[#EAF7EF] text-[#14532D] border-[#BFE6CC]",
  archived: "bg-slate-100 text-slate-600 border-slate-200",
  merged: "bg-slate-100 text-slate-600 border-slate-200",
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
        STYLES[status] || "bg-slate-100 text-slate-700 border-slate-200",
        className
      )}
    >
      {LABELS[status] || status}
    </span>
  );
};
