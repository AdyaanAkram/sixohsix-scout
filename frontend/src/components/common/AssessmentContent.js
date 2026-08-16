/**
 * Read-only renderer for an AI assessment's content payload.
 * Shared between the staff PlayerProfile tab and the athlete/parent MyId portal —
 * the family must see exactly what staff approved.
 *
 * Renders BOTH content generations defensively:
 *  - the original 4-section shape ({summary, strengths, development_priorities, next_steps})
 *  - the 12-section professional recap ({evaluation_summary, verified_measurements,
 *    position_assessments, athletic_profile, hitting_assessment, defensive_assessment,
 *    strengths, development_priorities, next_steps, development_trend, coach_summary,
 *    parent_summary})
 * Every field may be missing, null, or of the wrong shape; an empty section is
 * skipped rather than rendered as a header with no body.
 */

const TREND_CHIP_STYLES = {
  // same chip tokens used across the app (see StatusBadge.js)
  Improved: "bg-success/15 text-success border-success/40",
  Stable: "bg-secondary text-muted-foreground border-border",
  "Needs Attention": "bg-warning/15 text-warning border-warning/40",
};

const asArray = (v) => (Array.isArray(v) ? v.filter(Boolean) : []);
const asText = (v) => (typeof v === "string" && v.trim() ? v : null);

function SectionLabel({ children, tone = "text-muted-foreground" }) {
  return (
    <p className={`text-xs uppercase tracking-wide font-semibold mb-1.5 ${tone}`}>{children}</p>
  );
}

function TextSection({ label, text }) {
  if (!text) return null;
  return (
    <div>
      <SectionLabel>{label}</SectionLabel>
      <p className="text-sm text-foreground whitespace-pre-line">{text}</p>
    </div>
  );
}

export function AssessmentContent({ content, finalComment }) {
  const c = content || {};

  // New shape falls back to the legacy 4-section shape.
  const summary = asText(c.evaluation_summary) || asText(c.summary);
  const measurements = asArray(c.verified_measurements).filter((m) => typeof m === "object");
  const positions = asArray(c.position_assessments).filter((p) => typeof p === "object");
  const athleticProfile = asText(c.athletic_profile);
  const hitting = asText(c.hitting_assessment);
  const defense = asText(c.defensive_assessment);
  const strengths = asArray(c.strengths);
  const priorities = asArray(c.development_priorities);
  const nextSteps = asArray(c.next_steps);
  const trend = asArray(c.development_trend).filter((t) => typeof t === "object");
  const coachSummary = asText(c.coach_summary);
  const parentSummary = asText(c.parent_summary);

  const hasAny =
    summary || measurements.length > 0 || positions.length > 0 || athleticProfile ||
    hitting || defense || strengths.length > 0 || priorities.length > 0 ||
    nextSteps.length > 0 || trend.length > 0 || coachSummary || parentSummary || finalComment;
  if (!hasAny) return null;

  return (
    <div className="space-y-4" data-testid="assessment-content">
      {summary && (
        <div>
          <SectionLabel>{asText(c.evaluation_summary) ? "Evaluation Summary" : "Summary"}</SectionLabel>
          <p className="text-sm text-foreground whitespace-pre-line">{summary}</p>
        </div>
      )}

      {measurements.length > 0 && (
        <div>
          <SectionLabel>Verified Measurements</SectionLabel>
          <div className="rounded-md border border-border divide-y divide-border">
            {measurements.map((m, i) => (
              <div key={i} className="flex items-center justify-between gap-3 px-3 py-1.5 text-sm">
                <span className="text-foreground">{m.metric || "—"}</span>
                <span className="flex items-center gap-2">
                  <span className="font-semibold text-foreground tabular-nums">
                    {m.value != null ? String(m.value) : "—"}
                    {m.unit ? <span className="font-normal text-muted-foreground"> {m.unit}</span> : null}
                  </span>
                  <span
                    className={`inline-flex items-center whitespace-nowrap rounded-full border px-2 py-0 text-[10px] font-semibold uppercase tracking-wide ${
                      m.verified
                        ? "bg-success/15 text-success border-success/40"
                        : "border-dashed border-border-strong bg-transparent text-muted-foreground"
                    }`}
                  >
                    {m.verified ? "Verified" : "Unverified"}
                  </span>
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {positions.length > 0 && (
        <div>
          <SectionLabel>Position Assessments</SectionLabel>
          <div className="space-y-2">
            {positions.map((p, i) => (
              <div key={i} className="text-sm">
                <p className="font-semibold text-foreground">{p.position || "—"}</p>
                {p.summary && <p className="text-muted-foreground whitespace-pre-line">{p.summary}</p>}
              </div>
            ))}
          </div>
        </div>
      )}

      <TextSection label="Athletic Profile" text={athleticProfile} />
      <TextSection label="Hitting Assessment" text={hitting} />
      <TextSection label="Defensive Assessment" text={defense} />

      {strengths.length > 0 && (
        <div>
          <SectionLabel tone="text-success">Strengths</SectionLabel>
          <ul className="space-y-1">
            {strengths.map((s, i) => (
              <li key={i} className="text-sm">
                {typeof s === "string" ? (
                  <span className="text-muted-foreground">{s}</span>
                ) : (
                  <>
                    <span className="font-semibold text-foreground">{s.area || "—"}</span>
                    {s.detail && <span className="text-muted-foreground"> — {s.detail}</span>}
                  </>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {priorities.length > 0 && (
        <div>
          <SectionLabel tone="text-warning">Development Priorities</SectionLabel>
          <ul className="space-y-2">
            {priorities.map((p, i) => (
              <li key={i} className="text-sm">
                {typeof p === "string" ? (
                  <span className="text-muted-foreground">{p}</span>
                ) : (
                  <>
                    <p className="font-semibold text-foreground">{p.area || "—"}</p>
                    {p.why && <p className="text-muted-foreground">{p.why}</p>}
                    {p.focus && <p className="italic text-muted-foreground">{p.focus}</p>}
                  </>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {nextSteps.length > 0 && (
        <div>
          <SectionLabel>Next Steps</SectionLabel>
          <ul className="list-disc pl-4 space-y-1 text-sm text-muted-foreground">
            {nextSteps.map((s, i) => (
              <li key={i}>{typeof s === "string" ? s : JSON.stringify(s)}</li>
            ))}
          </ul>
        </div>
      )}

      {trend.length > 0 && (
        <div>
          <SectionLabel>Development Trend</SectionLabel>
          <ul className="space-y-1.5">
            {trend.map((t, i) => (
              <li key={i} className="text-sm flex items-start gap-2">
                <span
                  className={`mt-0.5 inline-flex items-center whitespace-nowrap rounded-full border px-2 py-0 text-[10px] font-semibold uppercase tracking-wide ${
                    TREND_CHIP_STYLES[t.status] || "bg-secondary text-muted-foreground border-border"
                  }`}
                >
                  {t.status || "—"}
                </span>
                <span>
                  <span className="font-semibold text-foreground">{t.area || "—"}</span>
                  {t.evidence && <span className="text-muted-foreground"> — {t.evidence}</span>}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {coachSummary && (
        <div className="rounded-md border-l-4 border-brand bg-secondary/60 px-3 py-2.5">
          <SectionLabel tone="text-brand">Coach&apos;s Synopsis</SectionLabel>
          <p className="text-sm text-foreground whitespace-pre-line">{coachSummary}</p>
        </div>
      )}

      {parentSummary && (
        <div>
          <SectionLabel>For the Family</SectionLabel>
          <p className="text-sm text-foreground whitespace-pre-line">{parentSummary}</p>
        </div>
      )}

      {finalComment && (
        <div>
          <SectionLabel tone="text-brand">Coach&apos;s note</SectionLabel>
          <p className="text-sm text-foreground whitespace-pre-line">{finalComment}</p>
        </div>
      )}
    </div>
  );
}
