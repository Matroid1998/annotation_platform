"use client";

import { useRef, useState } from "react";
import { ArrowUpFromLine, Check, FileSpreadsheet, Download, AlertCircle, X } from "lucide-react";
import { parseDocumentCsv, type CsvPreview } from "./csv";
import type { AdminAction, AdminProject } from "./types";

type PreparedDocument = { id: string; title: string; source: string; question: string; answer: string };

export function DocumentImport({ project, action, refresh }: { project: AdminProject; action: AdminAction; refresh: () => Promise<void> }) {
  const input = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<CsvPreview | null>(null);
  const [prepared, setPrepared] = useState<PreparedDocument[]>([]);
  const [filename, setFilename] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [selected, setSelected] = useState(0);

  function prepare(text: string, name: string) {
    const result = parseDocumentCsv(text);
    setPreview(result);
    setPrepared(result.documents.map((document, i) => ({ ...document, id: crypto.randomUUID(), title: `Document ${String(i + 1).padStart(3, "0")}` })));
    setFilename(name);
    setSelected(0);
    setError("");
    setSuccess("");
  }

  async function loadFile(file?: File) {
    if (!file) return;
    setPreview(null); setPrepared([]); setError(""); setSuccess("");
    if (file.size > 10 * 1024 * 1024) { setError("The file is larger than 10 MB. Split it into smaller files."); return; }
    setBusy(true);
    try { prepare(await file.text(), file.name); }
    catch { setError("This file could not be read. Please choose a UTF-8 CSV file."); }
    finally { setBusy(false); }
  }

  async function loadSample() {
    setBusy(true); setError("");
    try {
      const response = await fetch(`/samples/${project.id}.csv`);
      if (!response.ok) throw new Error("The sample file could not be loaded.");
      prepare(await response.text(), `${project.id}-sample.csv`);
    } catch (err) { setError(err instanceof Error ? err.message : "Could not load sample."); }
    finally { setBusy(false); }
  }

  async function importDocuments() {
    if (!preview || preview.errors.length || !prepared.length || busy) return;
    setBusy(true); setError(""); setSuccess("");
    try {
      await action({ action: "importDocuments", projectId: project.id, documents: prepared });
      const count = prepared.length;
      setPreview(null); setPrepared([]); setFilename("");
      if (input.current) input.current.value = "";
      setSuccess(`${count} ${count === 1 ? "document was" : "documents were"} saved to ${project.name}.`);
      try { await refresh(); } catch { setError("Import succeeded, but the project totals could not be refreshed. Reload this page to see the updated count."); }
    } catch (err) { setError(`${err instanceof Error ? err.message : "Import failed."} Your preview is still here. Check the project before retrying if your connection was interrupted.`); }
    finally { setBusy(false); }
  }

  const document = preview?.documents[selected];
  return <section className="admin-card admin-import">
    <div className="admin-section-heading"><div><p className="admin-eyebrow">DATASET</p><h2>Import documents</h2><p>Add the source text and generated question–answer pairs for {project.name}.</p></div><FileSpreadsheet size={25} aria-hidden="true" /></div>
    <div className="admin-format"><code>document,question,answer</code><p>Three required columns. Save as UTF-8 CSV; quote fields containing commas, quotes, or line breaks. Maximum 500 rows per import.</p></div>
    <div className="admin-upload" onDragOver={(event) => { event.preventDefault(); }} onDrop={(event) => { event.preventDefault(); if (!busy) void loadFile(event.dataTransfer.files[0]); }}>
      <span className="admin-upload-icon"><ArrowUpFromLine size={24} /></span><h3>Bring your dataset here</h3><p>Drop a CSV file, or choose one from your computer.</p>
      <input ref={input} type="file" accept=".csv,text/csv" className="admin-file-input" id={`csv-${project.id}`} disabled={busy} onChange={(event) => { void loadFile(event.target.files?.[0]); }} />
      <label className={`admin-button admin-primary${busy ? " admin-disabled" : ""}`} htmlFor={`csv-${project.id}`}>Choose CSV file</label>
      <div className="admin-upload-links"><a href={`/samples/${project.id}.csv`} download><Download size={14} /> Download sample CSV</a><button type="button" className="admin-text-button" disabled={busy} onClick={() => void loadSample()}>Preview sample</button></div>
    </div>
    {error && <p className="admin-alert admin-error" role="alert"><AlertCircle size={17} />{error}</p>}
    {success && <p className="admin-alert admin-success" role="status"><Check size={17} />{success}</p>}
    {preview && <div className="admin-preview">
      <div className="admin-preview-top"><div><strong>{filename}</strong><span>{preview.totalRows} rows · {preview.documents.length} valid documents</span></div><button className="admin-icon-button" type="button" disabled={busy} aria-label="Clear CSV preview" onClick={() => { setPreview(null); setPrepared([]); if (input.current) input.current.value = ""; }}><X size={18} /></button></div>
      {preview.errors.length > 0 ? <div className="admin-import-errors" role="alert"><strong>Fix these issues before importing</strong><ul>{preview.errors.slice(0, 10).map((issue, i) => <li key={i}>{issue}</li>)}</ul>{preview.errors.length > 10 && <p>And {preview.errors.length - 10} more issues.</p>}<p>No documents have been imported.</p></div> : <>
        <label className="admin-field-label" htmlFor="preview-row">Preview row<select id="preview-row" value={selected} onChange={(event) => setSelected(Number(event.target.value))}>{preview.documents.map((_, index) => <option key={index} value={index}>Document {index + 1}</option>)}</select></label>
        {document && <dl className="admin-preview-content"><dt>Source document</dt><dd>{document.source}</dd><dt>Generated question</dt><dd>{document.question}</dd><dt>Generated answer</dt><dd>{document.answer}</dd></dl>}
      </>}
      <div className="admin-preview-footer"><p>Review the preview before adding these documents to the project.</p><button className="admin-button admin-primary" type="button" disabled={busy || !!preview.errors.length || !prepared.length} onClick={() => void importDocuments()}>{busy ? "Importing…" : `Import ${prepared.length} ${prepared.length === 1 ? "document" : "documents"}`}</button></div>
    </div>}
  </section>;
}
