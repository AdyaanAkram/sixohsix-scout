import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { signedUrl } from "@/lib/api";

const COLORS = [
  "bg-[hsl(var(--brand-secondary))] text-white",
  "bg-destructive text-white",
  "bg-[hsl(var(--info))] text-white",
  "bg-[hsl(var(--warning))] text-white",
  "bg-success text-white",
];

function resolvePhotoSrc(photoUrl) {
  if (!photoUrl) return null;
  if (photoUrl.startsWith("http://") || photoUrl.startsWith("https://") || photoUrl.startsWith("data:")) {
    return photoUrl;
  }
  // Stored as /api/media/{id}/file — strip /api prefix for signedUrl helper
  const path = photoUrl.startsWith("/api/") ? photoUrl.slice(4) : photoUrl;
  return signedUrl(path);
}

export const PlayerAvatar = ({ firstName = "", lastName = "", photoUrl, size = "md", bib, className }) => {
  const [imgFailed, setImgFailed] = useState(false);
  useEffect(() => { setImgFailed(false); }, [photoUrl]);
  const initials = `${(firstName || "?")[0] || ""}${(lastName || "")[0] || ""}`.toUpperCase();
  const colorIdx = (firstName?.charCodeAt(0) || 0 + (lastName?.charCodeAt(0) || 0)) % COLORS.length;
  const sizes = {
    sm: "h-9 w-9 text-xs",
    md: "h-11 w-11 text-sm",
    lg: "h-16 w-16 text-lg",
    xl: "h-24 w-24 text-2xl",
    hero: "h-40 w-40 text-4xl",
  };
  const src = !imgFailed ? resolvePhotoSrc(photoUrl) : null;
  const rounded = size === "hero" ? "rounded-2xl ring-2 ring-brand/40" : "rounded-full ring-2 ring-white";

  return (
    <div className={cn("relative shrink-0", className)}>
      <div
        className={cn(
          "flex items-center justify-center font-bold overflow-hidden",
          rounded,
          sizes[size],
          COLORS[colorIdx]
        )}
      >
        {src ? (
          <img
            src={src}
            alt={`${firstName} ${lastName}`.trim() || "Player"}
            className="h-full w-full object-cover"
            onError={() => setImgFailed(true)}
          />
        ) : (
          initials
        )}
      </div>
      {bib && (
        <span className="absolute -bottom-1 -right-1 rounded-full bg-warning text-background text-xs font-mono-num font-bold px-1.5 py-0.5 leading-none ring-2 ring-background min-w-[1.5rem] text-center">
          #{bib}
        </span>
      )}
    </div>
  );
};
