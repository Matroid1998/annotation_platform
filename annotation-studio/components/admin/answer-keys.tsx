"use client";

import { useState } from "react";
import { AlertCircle, BookOpen, Check, ExternalLink, ShieldCheck } from "lucide-react";
import type { AdminAction, AnswerKey, KeyQuestion } from "./types";

export function AnswerKeyReview({ answerKey, questions, action, refresh }: { answerKey: AnswerKey; questions: KeyQuestion[]; action: AdminAction; refresh: () => Promise<void> }) {
  const [answers, setAnswers] = useState(answerKey.answers ?? answerKey.proposedAnswers);
  const [version, setVersion] = useState(answerKey.version);
  const [reviewed, setReviewed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const domainName = answerKey.domain === "legal" ? "Legal" : "Chemistry";
  const changed = answers.some((answer, index) => answer !== answerKey.answers?.[index]);
  const needsNewVersion = answerKey.confirmed && changed && version === answerKey.version;
  const valid = answers.length === 10 && answers.every((answer) => /^[A-D]$/.test(answer)) && version.trim().length > 0 && !needsNewVersion;

  async function confirm() {
    if (!reviewed || !valid || busy) return;
    setBusy(true); setError(""); setSuccess("");
    try {
      await action({ action: "confirmKey", domain: answerKey.domain, answers, version: version.trim() });
      setSuccess(`${domainName} answer key confirmed. Annotators who have not yet passed must acknowledge the guideline, then answer all 10 questions correctly. Existing passes remain valid.`);
      setReviewed(false);
      try { await refresh(); } catch { setError("The answer key was saved, but its status could not be refreshed. Reload this page."); }
    } catch (err) { setError(err instanceof Error ? err.message : "The answer key could not be saved."); }
    finally { setBusy(false); }
  }

  return <section className="admin-card">
    <div className="admin-section-heading"><div><p className="admin-eyebrow">QUALIFICATION</p><h2>{domainName} answer key</h2><p>{answerKey.domain === "legal" ? "Shared guideline for EUR-Lex and UN; each annotator qualifies once per project." : "Each annotator qualifies once before accessing the chemistry dataset."}</p></div><span className={`admin-badge ${answerKey.confirmed ? "" : "admin-badge-pending"}`}>{answerKey.confirmed ? <Check size={13} /> : <AlertCircle size={13} />}{answerKey.confirmed ? "Confirmed" : "Review required"}</span></div>
    <div className="admin-key-notice"><BookOpen size={20} /><div><strong>{answerKey.confirmed ? "An administrator has confirmed this key." : "Please review the proposed answers."}</strong><p>The supplied PDF contains the questions but no printed answer key. Proposed answers were derived from the guideline and require your confirmation before qualification opens.</p><a href={`/api/projects/${answerKey.domain === "legal" ? "eurlex" : "chemistry"}/guideline`} target="_blank" rel="noreferrer">Read the guideline PDF <ExternalLink size={13} /></a></div></div>
    <div className="admin-key-questions">{questions.map((question, index) => <div className="admin-key-question" key={question.id}><label htmlFor={`key-${answerKey.domain}-${question.id}`}><span>{String(index + 1).padStart(2, "0")}</span>{question.question}</label><select id={`key-${answerKey.domain}-${question.id}`} value={answers[index] ?? ""} disabled={busy} onChange={(event) => { setAnswers((current) => current.map((answer, position) => position === index ? event.target.value : answer)); setReviewed(false); setSuccess(""); }}><option value="" disabled>Choose an answer</option>{question.options.map((option) => <option key={option.value} value={option.value}>{option.value}. {option.label}</option>)}</select></div>)}</div>
    <div className="admin-key-footer"><label className="admin-field-label" htmlFor={`version-${answerKey.domain}`}>Guideline / key version<input id={`version-${answerKey.domain}`} value={version} maxLength={100} disabled={busy} onChange={(event) => { setVersion(event.target.value); setReviewed(false); }} /><span>Use a new version when changing a confirmed answer key. Revisions apply only to annotators who have not yet passed. Existing passes and their original key versions are retained; no repeat test is required.</span></label>
      {needsNewVersion && <p className="admin-alert admin-error" role="alert">Enter a new version before saving changed answers.</p>}
      <label className="admin-checkbox"><input type="checkbox" checked={reviewed} disabled={busy} onChange={(event) => setReviewed(event.target.checked)} /><span>I have reviewed all ten answers against the supplied guideline and approve this qualification key.</span></label>
      {error && <p className="admin-alert admin-error" role="alert"><AlertCircle size={17} />{error}</p>}
      {success && <p className="admin-alert admin-success" role="status"><Check size={17} />{success}</p>}
      <div className="admin-key-submit"><span>{answerKey.confirmedAt ? `Confirmed ${new Date(answerKey.confirmedAt).toLocaleDateString()}` : "100% required to qualify"}</span><button type="button" className="admin-button admin-primary" disabled={busy || !reviewed || !valid} onClick={() => void confirm()}><ShieldCheck size={16} />{busy ? "Saving…" : "Confirm answer key"}</button></div>
    </div>
  </section>;
}
