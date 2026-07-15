import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, errMsg } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "sonner";
import { Upload, FileWarning, CheckCircle2, ArrowLeft, AlertTriangle, Copy } from "lucide-react";
import { cn } from "@/lib/utils";

const STEPS = ["Upload", "Preview & Validate", "Summary"];

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

  return (
    <div className="space-y-5 max-w-4xl">
      <div>
        <button onClick={() => navigate("/players")} className="inline-flex items-center gap-1 text-sm text-[#1F4AA8] hover:underline mb-2" data-testid="import-back-button">
          <ArrowLeft className="h-3.5 w-3.5" /> Back to Players
        </button>
        <h1 className="font-display text-4xl text-[#0B1E3A]">Import Players</h1>
        <p className="text-sm text-slate-500">Upload a CSV roster. Invalid rows are never imported silently.</p>
      </div>

      {/* Stepper */}
      <div className="flex items-center gap-2">
        {STEPS.map((s, i) => (
          <div key={s} className="flex items-center gap-2">
            <div className={cn("flex items-center gap-2 rounded-full px-3.5 py-1.5 text-xs font-semibold border",
              i === step ? "bg-[#0B1E3A] text-white border-transparent" : i < step ? "bg-[#EAF7EF] text-[#14532D] border-[#BFE6CC]" : "bg-white text-slate-400")}>
              <span className="font-mono-num">{i + 1}</span> {s}
            </div>
            {i < STEPS.length - 1 && <div className="h-px w-6 bg-[#E7E1D6]" />}
          </div>
        ))}
      </div>

      {step === 0 && (
        <Card className="rounded-2xl card-shadow border-[#E7E1D6]">
          <CardContent className="py-10 flex flex-col items-center text-center">
            <div className="h-14 w-14 rounded-2xl bg-[hsl(var(--secondary))] flex items-center justify-center mb-4">
              <Upload className="h-7 w-7 text-[#0B1E3A]" />
            </div>
            <p className="font-semibold text-[#0B1E3A]">Upload your roster CSV</p>
            <p className="text-sm text-slate-500 mt-1 max-w-md">
              Supported columns: First Name, Last Name, Preferred Name, Date of Birth, Graduation Year, Primary Position,
              Secondary Positions, Bats, Throws, Height, Weight, Team, School, City, State, Country, Guardian Name, Guardian Email, Guardian Phone.
            </p>
            <label className="mt-5">
              <input type="file" accept=".csv" className="hidden" onChange={onFile} data-testid="csv-upload-input" />
              <span className="inline-flex items-center gap-2 rounded-xl bg-[#0B1E3A] hover:bg-[#102A4F] text-white px-5 h-12 font-semibold cursor-pointer active:scale-[0.98] transition">
                <Upload className="h-4 w-4" /> {busy ? "Analyzing…" : "Choose CSV File"}
              </span>
            </label>
          </CardContent>
        </Card>
      )}

      {step === 1 && preview && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <Card className="rounded-2xl border-[#E7E1D6]"><CardContent className="py-4 text-center"><p className="text-2xl font-bold font-mono-num text-[#0B1E3A]">{preview.total_rows}</p><p className="text-xs text-slate-500">Total rows</p></CardContent></Card>
            <Card className="rounded-2xl border-[#E7E1D6]"><CardContent className="py-4 text-center"><p className="text-2xl font-bold font-mono-num text-[#1F7A4D]">{preview.valid_rows}</p><p className="text-xs text-slate-500">Ready to import</p></CardContent></Card>
            <Card className="rounded-2xl border-[#E7E1D6]"><CardContent className="py-4 text-center"><p className="text-2xl font-bold font-mono-num text-[#C81D25]">{preview.error_rows}</p><p className="text-xs text-slate-500">With errors</p></CardContent></Card>
            <Card className="rounded-2xl border-[#E7E1D6]"><CardContent className="py-4 text-center"><p className="text-2xl font-bold font-mono-num text-[#B45309]">{preview.duplicate_rows}</p><p className="text-xs text-slate-500">Possible duplicates</p></CardContent></Card>
          </div>

          {preview.unmapped_columns?.length > 0 && (
            <div className="rounded-xl bg-[#FFF7E6] border border-[#FFD9A3] px-4 py-3 text-sm text-[#7C2D12] flex items-start gap-2">
              <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
              <span>Unrecognized columns ignored: {preview.unmapped_columns.join(", ")}</span>
            </div>
          )}

          <Card className="rounded-2xl card-shadow border-[#E7E1D6] overflow-hidden">
            <div className="max-h-[420px] overflow-auto">
              <Table data-testid="csv-preview-table">
                <TableHeader>
                  <TableRow className="bg-[hsl(var(--secondary))]">
                    <TableHead>Row</TableHead><TableHead>Name</TableHead><TableHead>DOB</TableHead>
                    <TableHead>Position</TableHead><TableHead>Team</TableHead><TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {preview.rows.map((r) => (
                    <TableRow key={r.row_number} className={cn(!r.valid && "bg-[#FDECEC]/60", r.is_duplicate && r.valid && "bg-[#FFF7E6]/70")}>
                      <TableCell className="font-mono-num text-xs">{r.row_number}</TableCell>
                      <TableCell className="font-semibold">{r.data.first_name || "—"} {r.data.last_name || ""}</TableCell>
                      <TableCell className="text-xs">{r.data.date_of_birth || "—"}</TableCell>
                      <TableCell>{r.data.primary_position || "—"}</TableCell>
                      <TableCell className="text-xs">{r.data.current_team || "—"}</TableCell>
                      <TableCell>
                        {!r.valid ? (
                          <span className="inline-flex items-center gap-1 text-xs text-[#C81D25] font-medium"><FileWarning className="h-3.5 w-3.5" />{r.errors.join("; ")}</span>
                        ) : r.is_duplicate ? (
                          <span className="inline-flex items-center gap-1 text-xs text-[#B45309] font-medium"><Copy className="h-3.5 w-3.5" />Possible duplicate</span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-xs text-[#1F7A4D] font-medium"><CheckCircle2 className="h-3.5 w-3.5" />Valid</span>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </Card>

          {preview.duplicate_rows > 0 && (
            <label className="flex items-center gap-2 text-sm text-slate-600">
              <Checkbox checked={includeDuplicates} onCheckedChange={setIncludeDuplicates} data-testid="include-duplicates-checkbox" />
              Import possible duplicates anyway
            </label>
          )}

          <div className="flex gap-2">
            <Button variant="outline" className="rounded-xl h-11" onClick={() => { setStep(0); setPreview(null); }}>Start over</Button>
            <Button className="rounded-xl h-11 bg-[#0B1E3A] hover:bg-[#102A4F] flex-1" onClick={confirm} disabled={busy || (preview.valid_rows === 0 && !includeDuplicates)} data-testid="csv-confirm-button">
              {busy ? "Importing…" : `Confirm Import (${preview.valid_rows + (includeDuplicates ? preview.duplicate_rows : 0)} players)`}
            </Button>
          </div>
        </div>
      )}

      {step === 2 && summary && (
        <Card className="rounded-2xl card-shadow border-[#E7E1D6]">
          <CardContent className="py-10 flex flex-col items-center text-center" data-testid="csv-import-summary">
            <CheckCircle2 className="h-12 w-12 text-[#1F7A4D] mb-3" />
            <p className="font-display text-3xl text-[#0B1E3A]">Import Complete</p>
            <p className="text-sm text-slate-600 mt-1">{summary.imported} players imported · {summary.skipped} skipped</p>
            <div className="flex gap-2 mt-5">
              <Button variant="outline" className="rounded-xl" onClick={() => { setStep(0); setPreview(null); setSummary(null); }}>Import another file</Button>
              <Button className="rounded-xl bg-[#0B1E3A] hover:bg-[#102A4F]" onClick={() => navigate("/players")} data-testid="csv-view-players-button">View Players</Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
