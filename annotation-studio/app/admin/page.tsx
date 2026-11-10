"use client";

import { useCallback, useEffect, useState } from "react";
import { ArrowLeft, ArrowUpRight, Beaker, BookOpen, Check, ChevronRight, Download, FileText, Globe2, Layers3, LockKeyhole, RefreshCw, Scale, Settings2, ShieldCheck, Users } from "lucide-react";
import { AnswerKeyReview } from "@/components/admin/answer-keys";
import { DocumentImport } from "@/components/admin/document-import";
import { Members } from "@/components/admin/members";
import SignOutButton from "@/components/auth/sign-out-button";
import { apiJson, type AdminData, type AdminSession } from "@/components/admin/types";
import "./admin.css";

type Tab = "documents" | "annotators" | "qualification";
const projectIcons = { eurlex: Scale, un: Globe2, chemistry: Beaker };

export default function AdminPage() {
  const [session, setSession] = useState<AdminSession | null>(null);
  const [data, setData] = useState<AdminData | null>(null);
  const [projectId, setProjectId] = useState("eurlex");
  const [tab, setTab] = useState<Tab>("documents");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [exporting, setExporting] = useState(false);

  const refresh = useCallback(async () => {
    const result = await apiJson<AdminData>("/api/admin");
    setData(result);
  }, []);

  const load = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const current = await apiJson<AdminSession>("/api/session");
      setSession(current);
      if (current.isAdmin) await refresh();
    } catch (err) { setError(err instanceof Error ? err.message : "Administration could not be loaded."); }
    finally { setLoading(false); }
  }, [refresh]);

  useEffect(() => { void load(); }, [load]);

  async function action(payload: Record<string, unknown>) {
    return apiJson<Record<string, unknown>>("/api/admin", { method: "POST", headers: { "Content-Type": "application/json", "X-Annotation-Actor": session?.user?.id ?? "" }, body: JSON.stringify(payload) });
  }

  async function exportAnnotations() {
    setExporting(true); setError("");
    try {
      const response = await fetch(`/api/admin/export?projectId=${encodeURIComponent(projectId)}`, { cache: "no-store", credentials: "same-origin", headers: { "X-Annotation-Actor": session?.user?.id ?? "" } });
      if (!response.ok) {
        const result = await response.json().catch(() => ({})) as { error?: string | { message?: string } };
        throw new Error(typeof result.error === "string" ? result.error : result.error?.message ?? "The export could not be created.");
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url; link.download = `${projectId}-annotations-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(link); link.click(); link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (err) { setError(err instanceof Error ? err.message : "The export could not be created."); }
    finally { setExporting(false); }
  }

  const project = data?.projects.find((item) => item.id === projectId) ?? data?.projects[0];
  const answerKey = data?.answerKeys.find((key) => key.domain === project?.domain);
  const allConfirmed = !!data && data.answerKeys.every((key) => key.confirmed);

  return <main className="admin-shell">
    <header className="admin-header"><a href="/" className="admin-brand"><span><Layers3 size={23} /></span><span className="admin-wordmark">annotation<small>STUDIO</small></span><span className="admin-brand-divider" /> <small>Administration</small></a><div className="admin-header-end"><a href="/" className="admin-back"><ArrowLeft size={16} /> Annotation workspace</a>{session?.user && <><SignOutButton authMode={session.authMode} className="admin-text-button">Sign out</SignOutButton><span className="admin-header-avatar" title={session.user.email}>{(session.user.name || session.user.email).slice(0, 2).toUpperCase()}</span></>}</div></header>
    {loading ? <div className="admin-loading" role="status"><RefreshCw size={24} className="admin-spin" /><p>Loading project administration…</p></div> : !session?.isAdmin ? <div className="admin-access"><span className="admin-access-icon"><LockKeyhole size={30} /></span><p className="admin-eyebrow">ADMINISTRATION</p><h1>{session?.configured ? "Administrator sign-in required" : "Set up your administrator account"}</h1><p>{session?.configured ? "Sign in with an administrator account to manage all three projects, create annotator accounts, and export submitted work." : "The platform owner must create the administrator account before datasets and annotators can be managed."}</p>{!session?.configured && <div className="admin-setup-steps"><div><span>1</span><p>{session?.authMode === "chatgpt" ? <>Configure <code>ADMIN_EMAILS</code> or <code>ADMIN_USER_IDS</code> in the server environment.</> : <>Run <code>npm run setup:local</code> from the application directory. The setup command creates the administrator account and reports where its initial credentials are stored.</>}</p></div><div><span>2</span><p>Sign in with the administrator account to prepare projects and create annotator accounts.</p></div></div>}{session?.user && <p className="admin-signed-in">Signed in as <strong>{session.user.email}</strong>. This account does not have administrator access.</p>}{error && <p className="admin-alert admin-error" role="alert">{error}</p>}<div className="admin-access-actions">{session?.user ? <SignOutButton authMode={session.authMode} className="admin-button admin-primary">Sign out and switch account</SignOutButton> : <a className="admin-button admin-primary" href={session?.authMode === "chatgpt" ? "/signin-with-chatgpt?return_to=%2Fadmin" : "/login"}>Sign in<ArrowUpRight size={16} /></a>}<button className="admin-button admin-secondary" onClick={() => void load()}>Refresh access</button></div><a className="admin-back" href="/"><ArrowLeft size={15} /> Back to the annotation workspace</a></div> : <div className="admin-content">
      <div className="admin-page-heading"><div><p className="admin-eyebrow">WORKSPACE MANAGEMENT</p><h1>A good study starts here.</h1><p>Prepare your datasets, give the right people access, and set the standard.</p></div><span className="admin-admin-label"><ShieldCheck size={15} />Administrator</span></div>
      {error && <div className="admin-alert admin-error" role="alert">{error}<button className="admin-text-button" onClick={() => void load()}>Try again</button></div>}
      {data && <>
        <div className="admin-overview"><div><span className="admin-overview-icon"><Layers3 size={20} /></span><div><span>Projects</span><strong>{data.projects.length}</strong></div></div><div><span className="admin-overview-icon"><FileText size={20} /></span><div><span>Source documents</span><strong>{data.projects.reduce((sum, item) => sum + item.total, 0).toLocaleString()}</strong></div></div><div><span className="admin-overview-icon"><Users size={20} /></span><div><span>Assigned annotators</span><strong>{new Set(data.memberships.map((member) => member.email)).size}</strong></div></div><div><span className={`admin-overview-icon ${allConfirmed ? "" : "admin-pending-icon"}`}><BookOpen size={20} /></span><div><span>Qualification keys</span><strong>{data.answerKeys.filter((key) => key.confirmed).length}<small> / {data.answerKeys.length} confirmed</small></strong></div></div></div>
        <div className="admin-project-heading"><h2>Your projects</h2><span>Choose a project to manage</span></div>
        <div className="admin-projects">{data.projects.map((item) => { const Icon = projectIcons[item.id as keyof typeof projectIcons] ?? FileText; const key = data.answerKeys.find((entry) => entry.domain === item.domain); return <button key={item.id} className={`admin-project ${project?.id === item.id ? "admin-project-selected" : ""}`} onClick={() => { setProjectId(item.id); setError(""); }} aria-pressed={project?.id === item.id}><span className={`admin-project-icon admin-project-${item.id}`}><Icon size={23} /></span><div><span className="admin-project-domain">{item.domain === "legal" ? "LEGAL" : "CHEMISTRY"}</span><h3>{item.name}</h3><p>{item.total} documents <span>·</span> {item.members} annotators</p><span className={`admin-project-status ${key?.confirmed ? "admin-status-ready" : ""}`}>{key?.confirmed ? <><Check size={12} /> Qualification ready</> : <><span className="admin-status-dot" /> Answer key needs review</>}</span></div><ChevronRight size={17} className="admin-project-arrow" /></button>; })}</div>
        {project && <div className="admin-project-workspace"><div className="admin-workspace-bar"><nav className="admin-tabs" aria-label="Project administration">{([{ id: "documents", label: "Documents", icon: FileText }, { id: "annotators", label: "Annotators", icon: Users }, { id: "qualification", label: "Qualification", icon: ShieldCheck }] as const).map((item) => <button key={item.id} className={tab === item.id ? "admin-tab-active" : ""} onClick={() => setTab(item.id)} aria-current={tab === item.id ? "page" : undefined}><item.icon size={16} />{item.label}</button>)}</nav><button className="admin-button admin-secondary admin-export" onClick={() => void exportAnnotations()} disabled={exporting}><Download size={15} />{exporting ? "Preparing…" : "Export annotations"}</button></div>
          <div className="admin-workspace-layout"><div className="admin-main-panel">{tab === "documents" && <DocumentImport key={project.id} project={project} action={action} refresh={refresh} />}{tab === "annotators" && <Members key={project.id} project={project} memberships={data.memberships} accounts={data.accounts} action={action} refresh={refresh} />}{tab === "qualification" && answerKey && <AnswerKeyReview key={`${answerKey.domain}-${answerKey.version}`} answerKey={answerKey} questions={data.questions} action={action} refresh={refresh} />}</div><aside className="admin-sidebar"><section className="admin-side-card"><span className="admin-side-icon"><Settings2 size={19} /></span><h3>Ready for annotation?</h3><p>Complete these three steps for {project.name}.</p><ol className="admin-readiness"><li className={project.total ? "admin-complete" : ""}><span>{project.total ? <Check size={12} /> : "1"}</span><button onClick={() => setTab("documents")}>Import source documents</button></li><li className={project.members ? "admin-complete" : ""}><span>{project.members ? <Check size={12} /> : "2"}</span><button onClick={() => setTab("annotators")}>Assign your annotators</button></li><li className={answerKey?.confirmed ? "admin-complete" : ""}><span>{answerKey?.confirmed ? <Check size={12} /> : "3"}</span><button onClick={() => setTab("qualification")}>Confirm the answer key</button></li></ol></section><section className="admin-side-note"><ShieldCheck size={21} /><h3>Independent by design</h3><p>Each annotator belongs to one project and sees only their own work. Administrators manage all projects and can export submitted annotations without an annotator assignment.</p><p>Every document is saved when the annotator presses Submit.</p></section></aside></div>
        </div>}
      </>}
      <footer className="admin-footer"><span><LockKeyhole size={13} /> Restricted administrator workspace</span><span>Annotation Studio</span></footer>
    </div>}
  </main>;
}
