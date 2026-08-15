/**
 * Read-only renderer for an AI assessment's content payload
 * ({summary, strengths[], development_priorities[], next_steps[]} + final_comment).
 * Shared between the staff PlayerProfile tab and the athlete/parent MyId portal —
 * the family must see exactly what staff approved.
 *
 * Defensive by design: every field may be missing or of the wrong shape, and an
 * empty section is skipped rather than rendered as a header with no body.
 */
export function AssessmentContent({ content, finalComment }) {
  const c = content || {};
  const strengths = (Array.isArray(c.strengths) ? c.strengths : []).filter(Boolean);
  const priorities = (Array.isArray(c.development_priorities) ? c.development_priorities : []).filter(Boolean);
  const nextSteps = (Array.isArray(c.next_steps) ? c.next_steps : []).filter(Boolean);
  const hasAny = c.summary || strengths.length > 0 || priorities.length > 0 || nextSteps.length > 0 || finalComment;
  if (!hasAny) return null;

  return (
    <div className="space-y-4" data-testid="assessment-content">
      {c.summary && (
        <div>
          <p className="text-xs uppercase tracking-wide text-muted-foreground font-semibold mb-1">Summary</p>
          <p className="text-sm text-foreground whitespace-pre-line">{c.summary}</p>
        </div>
      )}
      {strengths.length > 0 && (
        <div>
          <p className="text-xs uppercase tracking-wide text-success font-semibold mb-1.5">Strengths</p>
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
          <p className="text-xs uppercase tracking-wide text-warning font-semibold mb-1.5">Development Priorities</p>
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
          <p className="text-xs uppercase tracking-wide text-muted-foreground font-semibold mb-1.5">Next Steps</p>
          <ul className="list-disc pl-4 space-y-1 text-sm text-muted-foreground">
            {nextSteps.map((s, i) => (
              <li key={i}>{typeof s === "string" ? s : JSON.stringify(s)}</li>
            ))}
          </ul>
        </div>
      )}
      {finalComment && (
        <div>
          <p className="text-xs uppercase tracking-wide text-brand font-semibold mb-1">Coach&apos;s note</p>
          <p className="text-sm text-foreground whitespace-pre-line">{finalComment}</p>
        </div>
      )}
    </div>
  );
}
