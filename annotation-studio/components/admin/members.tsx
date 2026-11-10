"use client";

import { useState } from "react";
import { AlertCircle, Check, Plus, Users, ShieldCheck } from "lucide-react";
import type { AdminAction, AdminProject, Membership } from "./types";

export function Members({ project, memberships, action, refresh }: { project: AdminProject; memberships: Membership[]; action: AdminAction; refresh: () => Promise<void> }) {
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [removing, setRemoving] = useState<string | null>(null);
  const members = memberships.filter((member) => member.projectId === project.id);
  async function updateMember(kind: "addMember" | "removeMember", memberEmail: string) {
    setBusy(true); setError(""); setSuccess("");
    try {
      await action({ action: kind, projectId: project.id, email: memberEmail.trim().toLowerCase() });
      if (kind === "addMember") setEmail("");
      setRemoving(null);
      setSuccess(kind === "addMember" ? `${memberEmail} can now access ${project.name} after signing in and passing its qualification test.` : `Access to ${project.name} has been removed for ${memberEmail}. Their saved annotations are retained.`);
      try { await refresh(); } catch { setError("The access change was saved, but the member list could not be refreshed. Reload this page."); }
    } catch (err) { setError(err instanceof Error ? err.message : "The access change could not be saved."); }
    finally { setBusy(false); }
  }
  return <section className="admin-card">
    <div className="admin-section-heading"><div><p className="admin-eyebrow">PROJECT ACCESS</p><h2>Assigned annotators</h2><p>Give annotators access to {project.name} using their sign-in email.</p></div><Users size={25} aria-hidden="true" /></div>
    <form className="admin-member-form" onSubmit={(event) => { event.preventDefault(); if (email.trim() && !busy) void updateMember("addMember", email.trim()); }}>
      <label className="admin-field-label" htmlFor="member-email">Email address<input id="member-email" type="email" placeholder="annotator@organization.org" value={email} onChange={(event) => setEmail(event.target.value)} required maxLength={254} disabled={busy} /></label>
      <button className="admin-button admin-primary" type="submit" disabled={busy || !email.trim()}><Plus size={16} />{busy ? "Saving…" : "Add annotator"}</button>
    </form>
    {error && <p className="admin-alert admin-error" role="alert"><AlertCircle size={17} />{error}</p>}
    {success && <p className="admin-alert admin-success" role="status"><Check size={17} />{success}</p>}
    <div className="admin-members-list"><div className="admin-list-header"><span>ANNOTATOR</span><span>ACCESS</span></div>
      {members.length === 0 ? <div className="admin-empty"><Users size={26} /><h3>No annotators assigned yet</h3><p>Add an email above to give someone access to this project.</p></div> : members.map((member) => <div className="admin-member" key={member.email}>
        <div className="admin-member-identity"><span className="admin-avatar">{member.email.slice(0, 2).toUpperCase()}</span><div><strong>{member.email}</strong><span>{member.userId ? "Account connected" : "Available on next sign-in"}</span></div></div>
        {removing === member.email ? <div className="admin-member-actions"><span>Remove access?</span><button className="admin-text-button admin-danger" disabled={busy} onClick={() => void updateMember("removeMember", member.email)}>Remove</button><button className="admin-text-button" disabled={busy} onClick={() => setRemoving(null)}>Cancel</button></div> : <div className="admin-member-actions"><span className="admin-badge"><ShieldCheck size={12} />Assigned</span><button className="admin-text-button admin-muted" disabled={busy} onClick={() => setRemoving(member.email)}>Remove</button></div>}
      </div>)}
    </div>
    <p className="admin-footnote"><ShieldCheck size={15} />Annotators can see only their assigned projects and their own annotations. Assignment does not send an invitation email.</p>
  </section>;
}
