import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, errMsg } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "sonner";
import { AlertTriangle, ArrowLeft, ArrowRight, CheckCircle2, Copy, FileSpreadsheet, FileWarning, RotateCcw, Upload, Users } from "lucide-react";
import { cn } from "@/lib/utils";

// `short` keeps the progress rail readable at 375px, where the full label of
// step 2 would otherwise truncate to something meaningless.
const STEPS = [
  { label: "Upload", short: "Upload" },
  { label: "Preview & Validate", short: "Preview" },
  { label: "Summary", short: "Done" },
];

const PanelLabel = ({ children }) => (
  <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">{children}</p>
);

const StatTile = ({ icon: Icon, tint, value, label, sub, testId }) => (
  <Card className="min-w-0 rounded-2xl border-border bg-card" data-testid={testId}>
    <CardContent className="flex flex-col items-start gap-2 pt-4 pb-4 sm:flex-row sm:items-center sm:gap-3">
      <div className={cn("h-10 w-10 shrink-0 rounded-lg grid place-items-center", tint)}>
        <Icon className="h-5 w-5" />
      </div>
      <div className="min-w-0">
        <p className="font-mono-num text-2xl font-bold leading-none text-foreground">{value}</p>
        <p className="mt-1 text-xs font-semibold leading-snug text-foreground">{label}</p>
        {sub && <p className="text-[10px] text-muted-foreground">{sub}</p>}
      </div>
    </CardContent>
  </Card>
);

export default function ImportPlayers() {
  const navigate = useNavigate();
  const [step, setStep] = useState(0);
  const [preview, setPreview] = useState(null);
  const [includeDuplicates, setIncludeDuplicates] = useState(false);
  const [summary, setSummary] = useState(null);
  const [busy, setBusy] = useState(false);

  const onFile = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const r = await api.post("/athletes/import/preview", fd);
      setPreview(r.data);
      setStep(1);
    } catch (err) {
      toast.error(errMsg(err));
    } finally {
      setBusy(false);
      e.target.value = "";
    }
  };

  const confirm = async () => {
    setBusy(true);
    try {
      const r = await api.post("/athletes/import/confirm", { rows: preview.rows, include_duplicates: includeDuplicates });
      setSummary(r.data);
      setStep(2);
      toast.success(r.data.message);
    } catch (err) {
      toast.error(errMsg(err));
    } finally {
      setBusy(false);
    }
  };

  const willImport = preview ? preview.valid_rows + (includeDuplicates ? preview.duplicate_rows : 0) : 0;

  return (
    <div className="max-w-4xl space-y-4">
      <div className="min-w-0">
        <button onClick={() => navigate("/players")} className="mb-2 inline-flex items-center gap-1 text-sm font-semibold text-info hover:underline" data-testid="import-back-button">
          <ArrowLeft className="h-3.5 w-3.5" /> Back to Athletes
        </button>
        <h1 className="font-display text-3xl sm:text-4xl text-foreground">Import Athletes</h1>
        <p className="text-sm text-muted-foreground">Upload a roster as CSV, Excel or Word. Invalid rows are never imported silently.</p>
      </div>

      {/* Progress rail — a segmented track rather than a chip row, so three steps
          always fit on a phone instead of scrolling the page sideways. */}
      <Card className="rounded-2xl border-border bg-card" data-testid="import-stepper">
        <CardContent className="pt-4 pb-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <PanelLabel>Step {step + 1} of {STEPS.length}</PanelLabel>
            <span className="font-mono-num text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
              {step === 0 ? "Not started" : step === 1 ? "File analysed" : "Finished"}
            </span>
          </div>
          <p className="mt-1 font-display text-2xl text-foreground">{STEPS[step].label}</p>
          <div className="mt-3 grid grid-cols-3 gap-2">
            {STEPS.map((s, i) => (
              <div key={s.label} className="min-w-0">
                <div className={cn("h-1.5 rounded-full", i < step ? "bg-success" : i === step ? "bg-primary" : "bg-secondary")} />
                <p className={cn(
                  "mt-1.5 truncate text-[11px] font-semibold",
                  i < step ? "text-success" : i === step ? "text-foreground" : "text-muted-foreground"
                )}>
                  <span className="sm:hidden">{s.short}</span>
                  <span className="hidden sm:inline">{s.label}</span>
                </p>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {step === 0 && (
        <Card className="rounded-2xl border-border bg-card" data-testid="import-upload-card">
          <CardContent className="pt-4 pb-6">
            <PanelLabel>Step 1 · Choose a roster file</PanelLabel>
            <div className="mt-3 flex flex-col items-center rounded-2xl border border-dashed border-border bg-secondary/30 px-4 py-8 text-center">
              <div className="mb-4 grid h-14 w-14 place-items-center rounded-2xl bg-brand/15 text-brand">
                <Upload className="h-7 w-7" />
              </div>
              <p className="font-semibold text-foreground">Upload a roster (CSV · Excel · Word)</p>
              <p className="mt-1 max-w-md text-sm text-muted-foreground">
                Works with standard rosters and GameChanger exports. Parents or athletes can dump a team CSV here —
                we map Player / Jersey # / B/T / Team automatically. First + last name (or a single Player Name column) required.
              </p>
              <label className="mt-5">
                <input type="file" accept=".csv,.xlsx,.docx" className="hidden" onChange={onFile} data-testid="csv-upload-input" />
                <span className="inline-flex h-12 cursor-pointer items-center gap-2 rounded-xl bg-primary px-5 font-semibold text-white transition hover:bg-brand-secondary active:scale-[0.98]">
                  <Upload className="h-4 w-4" /> {busy ? "Analysing…" : "Choose File (CSV · Excel · Word)"}
                </span>
              </label>
            </div>

            <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="min-w-0 rounded-xl border border-border bg-secondary/40 px-3 py-2.5">
                <PanelLabel>Columns we map</PanelLabel>
                <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                  DOB, Grad Year, Position, Height, Weight, School, City, State, and Guardian / Parent contact fields.
                </p>
              </div>
              <div className="min-w-0 rounded-xl border border-border bg-secondary/40 px-3 py-2.5">
                <PanelLabel>Coming from Google?</PanelLabel>
                <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                  In Google Docs or Sheets choose File → Download → Word (.docx) or Excel (.xlsx), then upload that file.
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {step === 1 && preview && (
        <div className="space-y-4">
          <div>
            <PanelLabel>Step 2 · What we found in your file</PanelLabel>
            <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4" data-testid="import-preview-stats">
              <StatTile
                icon={FileSpreadsheet}
                tint="bg-info/15 text-info"
                value={preview.total_rows}
                label="Total rows"
                sub="Read from the file"
                testId="import-stat-total"
              />
              <StatTile
                icon={CheckCircle2}
                tint="bg-success/15 text-success"
                value={preview.valid_rows}
                label="Ready to import"
                sub="Clean rows"
                testId="import-stat-valid"
              />
              <StatTile
                icon={FileWarning}
                tint="bg-destructive/15 text-destructive"
                value={preview.error_rows}
                label="With errors"
                sub={preview.error_rows === 0 ? "Nothing to fix" : "Skipped on import"}
                testId="import-stat-errors"
              />
              <StatTile
                icon={Copy}
                tint="bg-warning/15 text-warning"
                value={preview.duplicate_rows}
                label="Possible duplicates"
                sub={preview.duplicate_rows === 0 ? "None matched the roster" : "Your choice below"}
                testId="import-stat-duplicates"
              />
            </div>
          </div>

          {preview.detected_format === "gamechanger" && (
            <div className="flex items-start gap-2 rounded-xl border border-info/40 bg-info/15 px-4 py-3 text-sm text-info" data-testid="import-detected-format">
              <FileSpreadsheet className="mt-0.5 h-4 w-4 shrink-0" />
              <span className="min-w-0">Detected a GameChanger-style roster. Identity columns were mapped automatically.</span>
            </div>
          )}

          {preview.unmapped_columns?.length > 0 && (
            <div className="rounded-xl border border-warning/40 bg-warning/15 px-4 py-3" data-testid="import-unmapped-columns">
              <p className="flex items-start gap-2 text-sm font-semibold text-warning">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                <span className="min-w-0">Unrecognised columns are ignored — stats columns are fine to leave in.</span>
              </p>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {preview.unmapped_columns.map((c) => (
                  <span key={c} className="inline-flex max-w-full items-center truncate rounded-full bg-warning/20 px-2 py-0.5 text-[11px] font-semibold text-warning">
                    {c}
                  </span>
                ))}
              </div>
            </div>
          )}

          <Card className="overflow-hidden rounded-2xl border-border bg-card">
            <CardContent className="pt-4 pb-0">
              <PanelLabel>Row-by-row preview</PanelLabel>
            </CardContent>
            {/* The table keeps a readable minimum width and scrolls inside this
                container — the page itself must never scroll sideways. */}
            <div className="mt-3 max-h-[420px] overflow-x-auto overflow-y-auto">
              <Table className="min-w-[680px]" data-testid="csv-preview-table">
                <TableHeader>
                  <TableRow className="bg-secondary">
                    <TableHead>Row</TableHead><TableHead>Name</TableHead><TableHead>DOB</TableHead>
                    <TableHead>Position</TableHead><TableHead>Team</TableHead><TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {preview.rows.map((r) => (
                    <TableRow key={r.row_number} className={cn(!r.valid && "bg-destructive/10", r.is_duplicate && r.valid && "bg-warning/10")}>
                      <TableCell className="font-mono-num text-xs text-muted-foreground">{r.row_number}</TableCell>
                      <TableCell className="font-semibold text-foreground">
                        {[r.data.first_name, r.data.last_name].filter(Boolean).join(" ") || "No name in this row"}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">{r.data.date_of_birth || "Not given"}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">{r.data.primary_position || "Not given"}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">{r.data.current_team || "No team"}</TableCell>
                      <TableCell>
                        {!r.valid ? (
                          <span className="inline-flex items-start gap-1 text-xs font-medium text-destructive"><FileWarning className="mt-0.5 h-3.5 w-3.5 shrink-0" />{r.errors.join("; ")}</span>
                        ) : r.is_duplicate ? (
                          <span className="inline-flex items-center gap-1 whitespace-nowrap text-xs font-medium text-warning"><Copy className="h-3.5 w-3.5 shrink-0" />Possible duplicate</span>
                        ) : (
                          <span className="inline-flex items-center gap-1 whitespace-nowrap text-xs font-medium text-success"><CheckCircle2 className="h-3.5 w-3.5 shrink-0" />Valid</span>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </Card>

          {preview.duplicate_rows > 0 && (
            <label className="flex items-start gap-2 rounded-xl border border-border bg-secondary/40 px-3 py-2.5 text-sm text-foreground">
              <Checkbox checked={includeDuplicates} onCheckedChange={setIncludeDuplicates} className="mt-0.5" data-testid="include-duplicates-checkbox" />
              <span className="min-w-0">
                Import possible duplicates anyway
                <span className="block text-xs text-muted-foreground">
                  Adds the {preview.duplicate_rows} row{preview.duplicate_rows === 1 ? "" : "s"} that look like athletes already on your roster.
                </span>
              </span>
            </label>
          )}

          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              className="h-11 rounded-xl"
              onClick={() => { setStep(0); setPreview(null); }}
              data-testid="import-start-over-button"
            >
              <RotateCcw className="h-4 w-4 sm:mr-1.5" />
              <span className="hidden sm:inline">Start over</span>
              <span className="ml-1 sm:hidden">Restart</span>
            </Button>
            <Button
              className="h-11 min-w-0 flex-1 rounded-xl bg-primary hover:bg-brand-secondary"
              onClick={confirm}
              disabled={busy || (preview.valid_rows === 0 && !includeDuplicates)}
              data-testid="csv-confirm-button"
            >
              <span className="truncate">
                {busy ? "Importing…" : `Confirm Import (${willImport} athlete${willImport === 1 ? "" : "s"})`}
              </span>
              {!busy && <ArrowRight className="ml-1.5 h-4 w-4 shrink-0" />}
            </Button>
          </div>
        </div>
      )}

      {step === 2 && summary && (
        <Card className="rounded-2xl border-border bg-card">
          <CardContent className="pt-4 pb-6" data-testid="csv-import-summary">
            <PanelLabel>Step 3 · Import complete</PanelLabel>
            <div className="mt-3 flex flex-col items-center text-center">
              <div className="mb-3 grid h-14 w-14 place-items-center rounded-2xl bg-success/15 text-success">
                <CheckCircle2 className="h-7 w-7" />
              </div>
              <p className="font-display text-3xl text-foreground">Import Complete</p>
              <p className="mt-1 text-sm text-muted-foreground">Your roster has been updated.</p>
            </div>

            <div className="mt-4 grid grid-cols-2 gap-2">
              <StatTile
                icon={Users}
                tint="bg-success/15 text-success"
                value={summary.imported}
                label={`Athlete${summary.imported === 1 ? "" : "s"} imported`}
                sub="Added to your roster"
                testId="import-summary-imported"
              />
              <StatTile
                icon={FileWarning}
                tint="bg-warning/15 text-warning"
                value={summary.skipped}
                label="Skipped"
                sub={summary.skipped === 0 ? "Every row imported" : "Errors or duplicates"}
                testId="import-summary-skipped"
              />
            </div>

            <div className="mt-4 flex flex-wrap gap-2">
              <Button
                variant="outline"
                className="h-11 rounded-xl"
                onClick={() => { setStep(0); setPreview(null); setSummary(null); }}
                data-testid="import-another-button"
              >
                <RotateCcw className="h-4 w-4 mr-1.5" /> Import another file
              </Button>
              <Button
                className="h-11 min-w-0 flex-1 rounded-xl bg-primary hover:bg-brand-secondary"
                onClick={() => navigate("/players")}
                data-testid="csv-view-players-button"
              >
                <span className="truncate">View Athletes</span>
                <ArrowRight className="ml-1.5 h-4 w-4 shrink-0" />
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
