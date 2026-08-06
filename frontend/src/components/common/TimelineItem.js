import { Card, CardContent } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { VerificationBadge } from "@/components/common/StatusBadge";
import {
  ExternalLink, Film, Image as ImageIcon, ClipboardList, Gauge, Trophy, Sparkles,
  StickyNote, Flag, Target, CalendarClock, UserPlus, Shuffle, Users,
} from "lucide-react";

/*
  Shared renderer for one unified ID Story / timeline item (spec §7). The item
  shape is produced by the backend `_story_entries` builder and is identical for
  the public Story page and the staff Timeline tab — only the set of items and a
  few staff-only flags differ. Each item shows: date, kind, title, short detail,
  verification status, a related photo/video thumbnail when present, and a deep
  link to the full record when one is supplied.
*/

const KIND_ICONS = {
  evaluation: ClipboardList,
  metric: Gauge,
  milestone: Sparkles,
  personal_best: Sparkles,
  achievement: Trophy,
  media: ImageIcon,
  joined: UserPlus,
  season_started: CalendarClock,
  position_change: Shuffle,
  team_change: Users,
  note: StickyNote,
  scout_note: Flag,
  goal: Target,
};

const KIND_LABELS = {
  personal_best: "Personal best",
  season_started: "Season",
  position_change: "Position change",
  team_change: "New team",
  scout_note: "Scout note",
};

const kindLabel = (kind) => KIND_LABELS[kind] || (kind || "").replace(/_/g, " ");

// Only surface a verification badge when the item genuinely carries a source.
// Chronology items (joined / season / notes / goals) have no verification meaning
// and must not be mislabelled "Unverified".
export const entrySource = (e) =>
  e.verification_source || (e.verified && e.kind === "evaluation" ? "coach_submitted" : undefined);

// The full-information deep link, tolerant of the various keys the API may use.
export const entryLink = (e) => e.link_url || e.url || e.href || null;

const EntryDetails = ({ entry }) => {
  const link = entryLink(entry);
  if (!entry.detail && !link) return null;
  return (
    <Collapsible className="mt-2">
      <CollapsibleTrigger className="text-xs text-info hover:underline">View Details</CollapsibleTrigger>
      <CollapsibleContent className="pt-2 space-y-1">
        {entry.detail && <p className="text-xs text-muted-foreground">{entry.detail}</p>}
        {link && (
          <a href={link} target={/^https?:/.test(link) ? "_blank" : undefined} rel="noreferrer"
             className="inline-flex items-center gap-1 text-xs text-info hover:underline">
            Full information <ExternalLink className="h-3 w-3" />
          </a>
        )}
      </CollapsibleContent>
    </Collapsible>
  );
};

export function TimelineItem({ entry }) {
  const Icon = KIND_ICONS[entry.kind] || StickyNote;
  const source = entrySource(entry);
  const isVideo = (entry.subtitle || "").includes("video");
  return (
    <Card className="rounded-2xl border-border" data-testid="story-entry">
      <CardContent className="py-3">
        <div className="flex gap-3">
          {/* Consent is enforced server-side; the public payload never carries an
              unapproved thumbnail. Staff items pass a signed thumbnail_url when set. */}
          {entry.thumbnail_url ? (
            <img
              src={entry.thumbnail_url}
              alt={entry.title || "Story media"}
              loading="lazy"
              className="h-16 w-16 rounded-xl object-cover border border-border shrink-0"
              data-testid="story-entry-thumb"
            />
          ) : entry.kind === "media" ? (
            <div className="h-16 w-16 rounded-xl border border-border bg-surface-3 flex items-center justify-center shrink-0">
              {isVideo ? <Film className="h-5 w-5 text-muted-foreground" /> : <ImageIcon className="h-5 w-5 text-muted-foreground" />}
            </div>
          ) : null}
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="text-xs text-muted-foreground capitalize flex items-center gap-1.5">
                  <Icon className="h-3.5 w-3.5 text-brand shrink-0" />
                  {kindLabel(entry.kind)} · {(entry.date || "").slice(0, 10) || "—"}
                </p>
                <p className="text-sm font-semibold text-foreground">{entry.title}</p>
                {entry.subtitle && <p className="text-xs text-muted-foreground mt-0.5">{entry.subtitle}</p>}
                {entry.author && <p className="text-[11px] text-muted-foreground mt-0.5">{entry.author}</p>}
              </div>
              <div className="flex flex-col items-end gap-1 shrink-0">
                {source && <VerificationBadge source={source} compact />}
                {entry.private && (
                  <span className="rounded-full border border-border-strong bg-transparent px-1.5 py-0 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Private</span>
                )}
                {entry.consent_pending && (
                  <span className="rounded-full border border-warning/40 bg-warning/15 px-1.5 py-0 text-[10px] font-semibold uppercase tracking-wide text-warning">Consent pending</span>
                )}
              </div>
            </div>
            <EntryDetails entry={entry} />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export default TimelineItem;
