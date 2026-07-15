import { cn } from "@/lib/utils";

const COLORS = [
  "bg-[#102A4F] text-white",
  "bg-[#C81D25] text-white",
  "bg-[#1F4AA8] text-white",
  "bg-[#B8860B] text-white",
  "bg-[#1F7A4D] text-white",
];

export const PlayerAvatar = ({ firstName = "", lastName = "", photoUrl, size = "md", bib, className }) => {
  const initials = `${(firstName || "?")[0] || ""}${(lastName || "")[0] || ""}`.toUpperCase();
  const colorIdx = (firstName?.charCodeAt(0) || 0 + (lastName?.charCodeAt(0) || 0)) % COLORS.length;
  const sizes = {
    sm: "h-9 w-9 text-xs",
    md: "h-11 w-11 text-sm",
    lg: "h-16 w-16 text-lg",
    xl: "h-24 w-24 text-2xl",
  };
  return (
    <div className={cn("relative shrink-0", className)}>
      <div
        className={cn(
          "flex items-center justify-center rounded-full font-bold overflow-hidden ring-2 ring-white",
          sizes[size],
          COLORS[colorIdx]
        )}
      >
        {initials}
      </div>
      {bib && (
        <span className="absolute -bottom-1 -right-1 rounded-full bg-[#F4B400] text-[#0F172A] text-[10px] font-mono-num font-bold px-1.5 py-0.5 leading-none ring-2 ring-white">
          #{bib}
        </span>
      )}
    </div>
  );
};
