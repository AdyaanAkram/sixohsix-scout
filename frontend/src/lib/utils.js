import { clsx } from "clsx";
import { twMerge } from "tailwind-merge"

export function cn(...inputs) {
  return twMerge(clsx(inputs));
}

/** Permanent 60'6" athlete ID: 606-{first 8 chars of UUID}. */
export function formatPermanentId(id) {
  return `606-${String(id || "").slice(0, 8).toUpperCase()}`;
}
