"use client";

import { useState } from "react";
import { AlertCircle, Check, Eye, EyeOff, KeyRound, Plus, RefreshCw, ShieldCheck, Users, UserRoundPlus } from "lucide-react";
import type { AdminAction, AdminProject, AnnotatorAccount, Membership } from "./types";

function newAssignedPassword() {
  return `Aa!${Array.from(crypto.getRandomValues(new Uint8Array(12)), (value) => value.toString(16).padStart(2, "0")).join("")}`;
}

export function Members({ project, memberships, accounts, action, refresh }: { project: AdminProject; memberships: Membership[]; accounts: AnnotatorAccount[]; action: AdminAction; refresh: () => Promise<void> }) {
  const [mode, setMode] = useState<"create" | "assign">("create");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [existingEmail, setExistingEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [removing, setRemoving] = useState<string | null>(null);
  const [resetting, setResetting] = useState<string | null>(null);
  const [resetPassword, setResetPassword] = useState("");
  const [showReset, setShowReset] = useState(false);
  const [accountChange, setAccountChange] = useState<{ email: string; active: boolean } | null>(null);
  const members = memberships.filter((member) => member.projectId === project.id);
  const available = accounts.filter((account) => account.role === "annotator" && account.active && account.assignmentCount === 0);
  const disabledUnassigned = accounts.filter((account) => account.role === "annotator" && !account.active && account.assignmentCount === 0);

  async function change(payload: Record<string, unknown>, message: string, afterSave?: () => void) {
    if (busy) return;
    setBusy(true); setError(""); setSuccess("");
    try {
      await action(payload);
      afterSave?.();
      setSuccess(message);
      try { await refresh(); } catch { setError("The change was saved, but the account list could not be refreshed. Reload this page to see its current state."); }
    } catch (err) { setError(err instanceof Error ? err.message : "The account change could not be saved."); }
    finally { setBusy(false); }
  }

  async function create() {
    await change({ action: "createAnnotator", projectId: project.id, name: name.trim(), email: email.trim().toLowerCase(), password }, `${name.trim()}’s account was created and assigned to ${project.name}. Share the email and assigned password with them. Passwords are managed by the administrator.`, () => { setName(""); setEmail(""); setPassword(""); setShowPassword(false); });
  }

  return <section className="admin-card">
    <div className="admin-section-heading"><div><p className="admin-eyebrow">ACCOUNTS & PROJECT ACCESS</p><h2>Assigned annotators</h2><p>Create individual sign-ins for {project.name}. Each annotator has access to one project and only their own grades.</p></div><Users size={25} aria-hidden="true" /></div>
    <div className="admin-account-tabs" aria-label="Add an annotator"><button type="button" className={mode === "create" ? "active" : ""} disabled={busy} onClick={() => setMode("create")}><UserRoundPlus size={15} />Create an account</button><button type="button" className={mode === "assign" ? "active" : ""} disabled={busy} onClick={() => setMode("assign")}><Plus size={15} />Assign an existing account</button></div>
    {mode === "create" ? <form className="admin-account-form" onSubmit={(event) => { event.preventDefault(); void create(); }}>
      <div className="admin-account-fields"><label className="admin-field-label" htmlFor="annotator-name">Full name<input id="annotator-name" value={name} onChange={(event) => setName(event.target.value)} required maxLength={120} autoComplete="off" disabled={busy} placeholder="Alex Morgan" /></label><label className="admin-field-label" htmlFor="annotator-email">Email address<input id="annotator-email" type="email" value={email} onChange={(event) => setEmail(event.target.value)} required maxLength={254} autoComplete="off" disabled={busy} placeholder="annotator@organization.org" /></label></div>
      <label className="admin-field-label" htmlFor="annotator-password">Assigned password<div className="admin-password-input"><input id="annotator-password" type={showPassword ? "text" : "password"} value={password} onChange={(event) => setPassword(event.target.value)} required minLength={12} maxLength={128} autoComplete="new-password" disabled={busy} placeholder="At least 12 characters" /><button type="button" className="admin-icon-button" aria-label={showPassword ? "Hide assigned password" : "Show assigned password"} onClick={() => setShowPassword((value) => !value)}>{showPassword ? <EyeOff size={16} /> : <Eye size={16} />}</button></div><span>Share this password with the annotator. Only the administrator can reset it.</span></label>
      <div className="admin-account-form-footer"><button type="button" className="admin-text-button" disabled={busy} onClick={() => { setPassword(newAssignedPassword()); setShowPassword(true); }}><RefreshCw size={13} />Generate password</button><button className="admin-button admin-primary" type="submit" disabled={busy || !name.trim() || !email.trim() || password.length < 12}><UserRoundPlus size={16} />{busy ? "Creating…" : "Create & assign annotator"}</button></div>
    </form> : <form className="admin-member-form" onSubmit={(event) => { event.preventDefault(); if (existingEmail) void change({ action: "addMember", projectId: project.id, email: existingEmail }, `${existingEmail} is now assigned to ${project.name}. Their saved work and prior qualification are retained.`, () => setExistingEmail("")); }}>
      <label className="admin-field-label" htmlFor="existing-annotator">Unassigned annotator<select id="existing-annotator" value={existingEmail} onChange={(event) => setExistingEmail(event.target.value)} required disabled={busy || !available.length}><option value="">{available.length ? "Choose an account" : "No unassigned active accounts"}</option>{available.map((account) => <option value={account.email} key={account.id}>{account.name} — {account.email}</option>)}</select><span>Accounts assigned to another project are not available here. Administrators manage all projects without an annotator assignment.</span></label><button className="admin-button admin-primary" type="submit" disabled={busy || !existingEmail}><Plus size={16} />{busy ? "Saving…" : "Assign to project"}</button>
    </form>}
    {mode === "assign" && disabledUnassigned.length > 0 && <div className="admin-disabled-accounts"><strong>Disabled accounts without a project</strong><p>Reactivate an account before assigning it.</p>{disabledUnassigned.map((account) => <div key={account.id}><span>{account.name}<small>{account.email}</small></span><button type="button" className="admin-text-button" disabled={busy} onClick={() => void change({ action: "setAnnotatorActive", email: account.email, active: true }, `${account.email} was reactivated and is available for project assignment.`)}>Reactivate account</button></div>)}</div>}
    {error && <p className="admin-alert admin-error" role="alert"><AlertCircle size={17} />{error}</p>}
    {success && <p className="admin-alert admin-success" role="status"><Check size={17} />{success}</p>}
    <div className="admin-members-list"><div className="admin-list-header"><span>ANNOTATOR</span><span>ACCOUNT & ACCESS</span></div>
      {members.length === 0 ? <div className="admin-empty"><Users size={26} /><h3>No annotators assigned yet</h3><p>Create an account or assign an existing annotator above.</p></div> : members.map((member) => {
        const account = accounts.find((entry) => entry.id === member.userId || entry.email === member.email);
        return <div className="admin-account-row" key={member.email}><div className="admin-member">
          <div className="admin-member-identity"><span className="admin-avatar">{(member.name || member.email).slice(0, 2).toUpperCase()}</span><div><strong>{member.name || member.email}</strong>{member.name && <span>{member.email}</span>}<span>{!account ? "Legacy assignment · account setup required" : !account.active ? "Account disabled" : "Active account"}</span></div></div>
          <div className="admin-member-actions"><span className={`admin-badge ${account && !account.active ? "admin-badge-pending" : ""}`}><ShieldCheck size={12} />{account && !account.active ? "Disabled" : "Assigned"}</span>{account?.role === "annotator" && <button type="button" className="admin-text-button" disabled={busy} onClick={() => { setResetting(member.email); setResetPassword(""); setShowReset(false); setRemoving(null); setAccountChange(null); }}><KeyRound size={12} />Reset password</button>}<button type="button" className="admin-text-button admin-muted" disabled={busy} onClick={() => { setRemoving(member.email); setResetting(null); setAccountChange(null); }}>Remove access</button>{account?.role === "annotator" && <button type="button" className="admin-text-button admin-muted" disabled={busy} onClick={() => { setAccountChange({ email: member.email, active: !account.active }); setResetting(null); setRemoving(null); }}>{account.active ? "Disable account" : "Reactivate"}</button>}</div>
        </div>
        {removing === member.email && <div className="admin-account-confirm"><p>Remove {member.name || member.email} from {project.name}? Their saved annotations and qualification will be retained.</p><div><button className="admin-button admin-secondary" type="button" disabled={busy} onClick={() => setRemoving(null)}>Cancel</button><button className="admin-button admin-danger-button" type="button" disabled={busy} onClick={() => void change({ action: "removeMember", projectId: project.id, email: member.email }, `Access to ${project.name} was removed for ${member.email}. Saved annotations and qualification are retained.`, () => setRemoving(null))}>Remove project access</button></div></div>}
        {accountChange?.email === member.email && <div className="admin-account-confirm"><p>{accountChange.active ? "Reactivate this account so the annotator can sign in again?" : "Disable this account and sign out all its sessions? Saved work and the project assignment will be retained."}</p><div><button className="admin-button admin-secondary" type="button" disabled={busy} onClick={() => setAccountChange(null)}>Cancel</button><button className="admin-button admin-primary" type="button" disabled={busy} onClick={() => void change({ action: "setAnnotatorActive", email: member.email, active: accountChange.active }, `${member.email} was ${accountChange.active ? "reactivated" : "disabled"}. Saved work is retained.`, () => setAccountChange(null))}>{accountChange.active ? "Reactivate account" : "Disable account"}</button></div></div>}
        {resetting === member.email && <form className="admin-password-reset" onSubmit={(event) => { event.preventDefault(); void change({ action: "resetAnnotatorPassword", email: member.email, password: resetPassword }, `Password reset for ${member.email}. Existing sessions were signed out. Share the new assigned password. Saved annotations and qualification are retained.`, () => { setResetting(null); setResetPassword(""); setShowReset(false); }); }}><label className="admin-field-label" htmlFor={`reset-${account?.id || member.email}`}>New assigned password<div className="admin-password-input"><input id={`reset-${account?.id || member.email}`} type={showReset ? "text" : "password"} value={resetPassword} onChange={(event) => setResetPassword(event.target.value)} required minLength={12} maxLength={128} autoComplete="new-password" disabled={busy} /><button type="button" className="admin-icon-button" onClick={() => setShowReset((value) => !value)} aria-label={showReset ? "Hide reset password" : "Show reset password"}>{showReset ? <EyeOff size={16} /> : <Eye size={16} />}</button></div><span>All existing sessions will be signed out. The annotator can sign in with this assigned password immediately.</span></label><div className="admin-account-form-footer"><button type="button" className="admin-text-button" disabled={busy} onClick={() => { setResetPassword(newAssignedPassword()); setShowReset(true); }}>Generate password</button><div><button className="admin-button admin-secondary" type="button" disabled={busy} onClick={() => { setResetting(null); setResetPassword(""); }}>Cancel</button><button className="admin-button admin-primary" type="submit" disabled={busy || resetPassword.length < 12}><KeyRound size={14} />{busy ? "Resetting…" : "Reset password"}</button></div></div></form>}
        </div>;
      })}
    </div>
    <p className="admin-footnote"><ShieldCheck size={15} />One project can have many annotators. Each annotator can have only one project. Account creation does not send an email; share sign-in details directly.</p>
  </section>;
}
