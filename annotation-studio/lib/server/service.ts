import questions from "./questionnaire.json";
import { ApiError, object, string, validId, validateAnswers, validateSubmission, type Domain } from "./validation";
import { AuthService, normalizeEmail } from "./auth";

export type Actor = { id: string; name: string; email: string; isAdmin: boolean };
type Database = Pick<D1Database, "prepare" | "batch">;
type Project = { id: string; name: string; domain: Domain; description: string };
type KeyRow = { domain: Domain; version: string; answers: string; confirmed_at: string };
type QualificationRow = { version: string; passed_at: string };
type SubmissionRow = { id: string; project_id: string; document_id: string; request_id: string; payload: string; saved_at: string };
type MembershipRow = { project_id: string; email: string; user_id: string | null };
type AccountRow = { id: string; name: string; email: string; role: string; active: number; must_change_password: number };
export const PROJECTS: Project[] = [
  { id: "eurlex", name: "EUR-Lex", domain: "legal", description: "European Union legal texts" },
  { id: "un", name: "United Nations", domain: "legal", description: "United Nations legal texts" },
  { id: "chemistry", name: "Chemistry", domain: "chemistry", description: "Chemistry research and technical texts" },
];
const proposedAnswers = ["C", "A", "D", "B", "D", "A", "C", "B", "C", "B"];
export function projectById(id: string): Project {
  const project = PROJECTS.find((p) => p.id === id);
  if (!project) throw new ApiError(404, "Project not found.");
  return project;
}
function receipt(row: SubmissionRow) { return { id: row.id, savedAt: row.saved_at, requestId: row.request_id }; }
function changed(result: D1Result) { return result.meta.changes > 0; }
function requireAdmin(actor: Actor) { if (!actor.isAdmin) throw new ApiError(403, "Administrator access is required."); }
// Recheck the one-project invariant inside writes, including legacy databases
// whose inconsistent membership records have not yet been repaired.
const membershipGuard = "EXISTS (SELECT 1 FROM memberships m WHERE m.project_id = ? AND m.user_id = ? AND (SELECT count(*) FROM memberships all_members WHERE all_members.user_id = m.user_id OR lower(all_members.email) = lower(m.email)) = 1)";
export class AnnotationService {
  constructor(private db: Database, private actor: Actor) {}
  private async assignedMembership() {
    const rows = (await this.db.prepare("SELECT project_id, email, user_id FROM memberships WHERE user_id = ? OR lower(email) = ?").bind(this.actor.id, this.actor.email.toLowerCase()).all<MembershipRow>()).results;
    if (rows.length > 1) throw new ApiError(409, "Multiple project assignments were found for this account. Ask an administrator to keep only one assignment before continuing.");
    return rows[0] ?? null;
  }
  async claimInvitations() {
    if (this.actor.isAdmin) return;
    await this.assignedMembership();
    await this.db.prepare("UPDATE memberships SET user_id = ? WHERE lower(email) = ? AND user_id IS NULL AND NOT EXISTS (SELECT 1 FROM memberships existing WHERE existing.user_id = ?)")
      .bind(this.actor.id, this.actor.email.toLowerCase(), this.actor.id).run();
  }
  async assertMember(projectId: string, adminAllowed = false) {
    const project = projectById(projectId);
    if (adminAllowed && this.actor.isAdmin) return project;
    const member = await this.assignedMembership();
    if (!member || member.project_id !== projectId || member.user_id !== this.actor.id) throw new ApiError(404, "Project not found or access has not been assigned.");
    return project;
  }
  async key(domain: Domain) { return this.db.prepare("SELECT * FROM answer_keys WHERE domain = ?").bind(domain).first<KeyRow>(); }
  private async originalPass(projectId: string) {
    // Earlier versions allowed requalification. Preserve the first successful pass
    // even when a legacy account has several historical qualification records.
    return this.db.prepare("SELECT version, passed_at FROM qualifications WHERE project_id = ? AND user_id = ? ORDER BY passed_at, version LIMIT 1").bind(projectId, this.actor.id).first<QualificationRow>();
  }
  async qualification(project: Project) {
    const pass = await this.originalPass(project.id);
    const acknowledgement = await this.db.prepare("SELECT acknowledged_at FROM guideline_acknowledgements WHERE project_id = ? AND user_id = ?").bind(project.id, this.actor.id).first<{ acknowledged_at: string }>();
    // A recorded successful pass is permanent for this user and project. In
    // particular, editing or withdrawing today's answer key cannot invalidate it.
    if (pass) return { passed: true, ready: true, version: pass.version, guidelineRead: true, guidelineReadAt: acknowledgement?.acknowledged_at ?? pass.passed_at, passedAt: pass.passed_at };
    const key = await this.key(project.domain);
    return { passed: false, ready: !!key, version: key?.version ?? null, guidelineRead: !!acknowledgement, guidelineReadAt: acknowledgement?.acknowledged_at ?? null, passedAt: null };
  }
  async acknowledgeGuideline(projectId: string, body: unknown) {
    const project = await this.assertMember(projectId);
    if (object(body).acknowledged !== true) throw new ApiError(400, "Confirm that you have read the guideline before continuing.");
    await this.db.prepare(`INSERT INTO guideline_acknowledgements (project_id, user_id, acknowledged_at) SELECT ?, ?, ? WHERE ${membershipGuard} ON CONFLICT DO NOTHING`)
      .bind(projectId, this.actor.id, new Date().toISOString(), projectId, this.actor.id).run();
    await this.assertMember(projectId);
    return this.qualification(project);
  }
  async sessionProjects() {
    if (this.actor.isAdmin) return [];
    await this.claimInvitations();
    const membership = await this.assignedMembership();
    const projects = PROJECTS.filter((p) => membership?.user_id === this.actor.id && membership.project_id === p.id);
    return Promise.all(projects.map(async (project) => {
      const counts = await this.db.prepare("SELECT (SELECT count(*) FROM documents WHERE project_id = ?) AS total, (SELECT count(*) FROM submissions WHERE project_id = ? AND user_id = ?) AS submitted").bind(project.id, project.id, this.actor.id).first<{ total: number; submitted: number }>();
      const q = await this.qualification(project);
      return { ...project, total: counts?.total ?? 0, submitted: counts?.submitted ?? 0, qualified: q.passed, qualificationReady: q.ready, guidelineRead: q.guidelineRead, guidelineReadAt: q.guidelineReadAt, passedAt: q.passedAt };
    }));
  }
  async project(projectId: string) {
    const project = await this.assertMember(projectId);
    const qualification = await this.qualification(project);
    // No dataset titles or content are returned until this user has passed.
    const documents = qualification.passed ? (await this.db.prepare("SELECT d.id, d.title, CASE WHEN s.id IS NULL THEN 0 ELSE 1 END AS submitted FROM documents d LEFT JOIN submissions s ON s.project_id = d.project_id AND s.document_id = d.id AND s.user_id = ? WHERE d.project_id = ? ORDER BY d.created_at, d.id").bind(this.actor.id, projectId).all<{ id: string; title: string; submitted: number }>()).results.map((d) => ({ ...d, submitted: !!d.submitted })) : [];
    return { project, documents, qualification, questions: qualification.guidelineRead && !qualification.passed ? questions : [] };
  }
  async document(projectId: string, documentId: string) {
    const project = await this.assertMember(projectId);
    if (!(await this.qualification(project)).passed) throw new ApiError(403, "Pass all ten qualification questions before opening annotation documents.");
    const document = await this.db.prepare("SELECT id, title, source, question, answer FROM documents WHERE project_id = ? AND id = ?").bind(projectId, documentId).first();
    if (!document) throw new ApiError(404, "Document not found.");
    const submission = await this.db.prepare("SELECT * FROM submissions WHERE project_id = ? AND document_id = ? AND user_id = ?").bind(projectId, documentId, this.actor.id).first<SubmissionRow>();
    return { ...document, submission: submission ? { ...receipt(submission), ...JSON.parse(submission.payload) } : null };
  }
  async qualify(projectId: string, body: unknown) {
    const project = await this.assertMember(projectId);
    const qualification = await this.qualification(project);
    if (qualification.passed) return { passed: true, correct: 10, total: 10 };
    if (!qualification.guidelineRead) throw new ApiError(403, "Read the guideline and confirm that you have read it before taking the qualification test.");
    const answers = validateAnswers(object(body).answers);
    const key = await this.key(project.domain);
    if (!key) throw new ApiError(409, "The administrator must confirm the qualification answer key first.");
    const expected = JSON.parse(key.answers) as string[];
    const correct = expected.reduce((count, answer, i) => count + (answers[String(i + 1)] === answer ? 1 : 0), 0);
    const now = new Date().toISOString();
    const guard = `${membershipGuard} AND EXISTS (SELECT 1 FROM guideline_acknowledgements WHERE project_id = ? AND user_id = ?) AND EXISTS (SELECT 1 FROM answer_keys WHERE domain = ? AND version = ?) AND NOT EXISTS (SELECT 1 FROM qualifications WHERE project_id = ? AND user_id = ?)`;
    const guardValues = [projectId, this.actor.id, projectId, this.actor.id, project.domain, key.version, projectId, this.actor.id];
    const statements = [this.db.prepare(`INSERT INTO qualification_attempts (id, project_id, user_id, version, answers, correct, attempted_at) SELECT ?, ?, ?, ?, ?, ?, ? WHERE ${guard}`).bind(crypto.randomUUID(), projectId, this.actor.id, key.version, JSON.stringify(answers), correct, now, ...guardValues)];
    if (correct === 10) statements.push(this.db.prepare(`INSERT OR IGNORE INTO qualifications (project_id, user_id, version, passed_at) SELECT ?, ?, ?, ? WHERE ${guard}`).bind(projectId, this.actor.id, key.version, now, ...guardValues));
    const results = await this.db.batch(statements);
    if (!changed(results[0])) {
      // Another request may have already passed the test while this request was
      // in flight. Return that original success without recording another attempt.
      await this.assertMember(projectId);
      if (await this.originalPass(projectId)) return { passed: true, correct: 10, total: 10 };
      throw new ApiError(409, "Access or the qualification test changed. Refresh and try again.");
    }
    return { passed: correct === 10, correct, total: 10 };
  }
  async submit(projectId: string, documentId: string, body: unknown) {
    const project = await this.assertMember(projectId);
    const input = validateSubmission(body, project.domain);
    const payload = JSON.stringify({ ratings: input.ratings, comment: input.comment });
    // Check existing receipts first so a safe retry remains possible after a key revision.
    const existing = await this.db.prepare("SELECT * FROM submissions WHERE user_id = ? AND (request_id = ? OR (project_id = ? AND document_id = ?))").bind(this.actor.id, input.requestId, projectId, documentId).all<SubmissionRow>();
    if (existing.results.length) return this.resolveRetry(existing.results, projectId, documentId, input.requestId, payload);
    const qualification = await this.qualification(project);
    if (!qualification.passed) throw new ApiError(403, "Pass the qualification test before submitting annotations.");
    const doc = await this.db.prepare("SELECT 1 FROM documents WHERE project_id = ? AND id = ?").bind(projectId, documentId).first();
    if (!doc) throw new ApiError(404, "Document not found.");
    const id = crypto.randomUUID();
    const savedAt = new Date().toISOString();
    // One atomic, immutable record contains the complete eight-criterion submission.
    // Membership, document existence and the original permanent qualification
    // are rechecked inside the INSERT. Later answer keys do not require retesting.
    const result = await this.db.prepare(`INSERT INTO submissions (id, project_id, document_id, user_id, request_id, payload, qualification_version, saved_at)
      SELECT ?, ?, ?, ?, ?, ?, ?, ?
      WHERE ${membershipGuard}
      AND EXISTS (SELECT 1 FROM documents WHERE project_id = ? AND id = ?)
      AND EXISTS (SELECT 1 FROM qualifications WHERE project_id = ? AND user_id = ? AND version = ?)
      ON CONFLICT DO NOTHING`).bind(id, projectId, documentId, this.actor.id, input.requestId, payload, qualification.version, savedAt, projectId, this.actor.id, projectId, documentId, projectId, this.actor.id, qualification.version).run();
    if (!changed(result)) {
      const rows = await this.db.prepare("SELECT * FROM submissions WHERE user_id = ? AND (request_id = ? OR (project_id = ? AND document_id = ?))").bind(this.actor.id, input.requestId, projectId, documentId).all<SubmissionRow>();
      if (rows.results.length) return this.resolveRetry(rows.results, projectId, documentId, input.requestId, payload);
      throw new ApiError(409, "Access or qualification changed. Your annotation was not saved; refresh and retry.");
    }
    // Read back from the same primary session. Never claim success on a queued/local write.
    const persisted = await this.db.prepare("SELECT * FROM submissions WHERE id = ? AND user_id = ?").bind(id, this.actor.id).first<SubmissionRow>();
    if (!persisted) throw new ApiError(503, "Save confirmation is unavailable. Keep this page open and retry with the same submission.");
    return receipt(persisted);
  }
  private resolveRetry(rows: SubmissionRow[], projectId: string, documentId: string, requestId: string, payload: string) {
    if (rows.length === 1 && rows[0].project_id === projectId && rows[0].document_id === documentId && rows[0].request_id === requestId && rows[0].payload === payload) return receipt(rows[0]);
    throw new ApiError(409, "This document or submission ID has already been saved with different data. Reload the saved submission; it has not been overwritten.");
  }
  async adminOverview() {
    requireAdmin(this.actor);
    const memberships = (await this.db.prepare("SELECT m.project_id AS projectId, m.email, m.user_id AS userId, m.created_at AS createdAt, a.name, a.active, a.must_change_password AS mustChangePassword FROM memberships m LEFT JOIN local_accounts a ON a.id = m.user_id ORDER BY m.project_id, m.email").all()).results;
    const accounts = (await this.db.prepare("SELECT a.id, a.name, a.email, a.role, a.active, a.must_change_password AS mustChangePassword, CASE WHEN count(m.project_id) = 1 THEN min(m.project_id) ELSE NULL END AS projectId, count(m.project_id) AS assignmentCount FROM local_accounts a LEFT JOIN memberships m ON m.user_id = a.id OR lower(m.email) = lower(a.email) GROUP BY a.id ORDER BY a.name, a.email").all<{ active: number; mustChangePassword: number; [key: string]: unknown }>()).results.map((account) => ({ ...account, active: !!account.active, mustChangePassword: !!account.mustChangePassword }));
    const projects = await Promise.all(PROJECTS.map(async (project) => {
      const counts = await this.db.prepare("SELECT (SELECT count(*) FROM documents WHERE project_id = ?) AS total, (SELECT count(*) FROM memberships WHERE project_id = ?) AS members").bind(project.id, project.id).first();
      return { ...project, ...counts };
    }));
    const answerKeys = await Promise.all((["legal", "chemistry"] as const).map(async (domain) => {
      const key = await this.key(domain);
      return { domain, version: key?.version ?? "guidelines-v1", confirmed: !!key, answers: key ? JSON.parse(key.answers) : null, proposedAnswers, confirmedAt: key?.confirmed_at ?? null };
    }));
    return { memberships, projects, answerKeys, questions, accounts };
  }
  async adminAction(body: unknown) {
    requireAdmin(this.actor);
    const input = object(body);
    switch (input.action) {
      case "createAnnotator": return this.createAnnotator(input);
      case "addMember": {
        const project = projectById(string(input.projectId, "Project", 100));
        const account = await this.annotatorAccount(input.email);
        if (!account.active) throw new ApiError(409, "Reactivate this account before assigning a project.");
        const existing = (await this.db.prepare("SELECT project_id, email, user_id FROM memberships WHERE user_id = ? OR lower(email) = ?").bind(account.id, account.email).all<MembershipRow>()).results;
        if (existing.length === 1 && existing[0].project_id === project.id && existing[0].user_id === account.id) return { ok: true };
        if (existing.length) throw new ApiError(409, "Each annotator can have only one project. Remove the current assignment before assigning another project.");
        try {
          const result = await this.db.prepare("INSERT INTO memberships (project_id, email, user_id, created_at) SELECT ?, ?, id, ? FROM local_accounts WHERE id = ? AND role = 'annotator' AND active = 1").bind(project.id, account.email, new Date().toISOString(), account.id).run();
          if (!changed(result)) throw new ApiError(409, "The annotator account changed before assignment. Refresh the account list and try again.");
        } catch (error) {
          if (String(error).includes("UNIQUE constraint")) throw new ApiError(409, "This annotator was assigned by another request. Refresh the account list; each annotator can have only one project.");
          throw error;
        }
        return { ok: true };
      }
      case "removeMember": {
        const project = projectById(string(input.projectId, "Project", 100));
        const email = string(input.email, "Email", 254).toLowerCase();
        await this.db.prepare("DELETE FROM memberships WHERE project_id = ? AND email = ?").bind(project.id, email).run();
        return { ok: true };
      }
      case "resetAnnotatorPassword": {
        const account = await this.annotatorAccount(input.email);
        await new AuthService(this.db).resetPassword(account.id, input.password, { mustChangePassword: true });
        return { ok: true };
      }
      case "setAnnotatorActive": {
        const account = await this.annotatorAccount(input.email);
        if (typeof input.active !== "boolean") throw new ApiError(400, "Choose whether the annotator account is active.");
        await new AuthService(this.db).setActive(account.id, input.active);
        return { ok: true };
      }
      case "confirmKey": return this.confirmKey(input);
      case "importDocuments": return this.importDocuments(input);
      default: throw new ApiError(400, "Unknown administrator action.");
    }
  }
  private async annotatorAccount(value: unknown) {
    const email = normalizeEmail(value);
    const account = await this.db.prepare("SELECT id, name, email, role, active, must_change_password FROM local_accounts WHERE email = ?").bind(email).first<AccountRow>();
    if (!account) throw new ApiError(404, "Create an annotator account before assigning a project or changing its password.");
    if (account.role !== "annotator") throw new ApiError(403, "Administrator accounts cannot be managed or assigned through annotator controls.");
    return account;
  }
  private async createAnnotator(input: Record<string, unknown>) {
    const project = projectById(string(input.projectId, "Project", 100));
    const email = normalizeEmail(input.email);
    const name = string(input.name, "Annotator name", 120);
    const id = crypto.randomUUID();
    const membership = this.db.prepare("INSERT INTO memberships (project_id, email, user_id, created_at) VALUES (?, ?, ?, ?)").bind(project.id, email, id, new Date().toISOString());
    try {
      const account = await new AuthService(this.db).createAccount({ id, name, email, password: input.password, role: "annotator", mustChangePassword: true }, [membership]);
      return { ok: true, account, projectId: project.id };
    } catch (error) {
      if (String(error).includes("UNIQUE constraint")) throw new ApiError(409, "An account or project assignment already exists for this email. Use the existing account controls; no new account was created.");
      throw error;
    }
  }
  private async confirmKey(input: Record<string, unknown>) {
    const domain = input.domain;
    if (domain !== "legal" && domain !== "chemistry") throw new ApiError(400, "Unknown guideline domain.");
    if (!Array.isArray(input.answers) || input.answers.length !== 10 || input.answers.some((a) => typeof a !== "string" || !/^[A-D]$/.test(a))) throw new ApiError(400, "Confirm exactly ten A–D answers.");
    const version = validId(input.version, "Answer key version");
    const answers = JSON.stringify(input.answers);
    const prior = await this.key(domain);
    if (prior?.version === version) {
      if (prior.answers !== answers) throw new ApiError(409, "Use a new version when changing an answer key. Existing qualifications must not silently change meaning.");
      return { ok: true, version };
    }
    const used = await this.db.prepare("SELECT 1 FROM answer_key_versions WHERE domain = ? AND version = ?").bind(domain, version).first();
    if (used) throw new ApiError(409, "This answer key version was already used. Choose a new version.");
    const now = new Date().toISOString();
    try {
      await this.db.batch([
        this.db.prepare("INSERT INTO answer_key_versions (domain, version, answers, confirmed_by, confirmed_at) VALUES (?, ?, ?, ?, ?)").bind(domain, version, answers, this.actor.id, now),
        this.db.prepare("INSERT INTO answer_keys (domain, version, answers, confirmed_by, confirmed_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(domain) DO UPDATE SET version = excluded.version, answers = excluded.answers, confirmed_by = excluded.confirmed_by, confirmed_at = excluded.confirmed_at").bind(domain, version, answers, this.actor.id, now),
      ]);
    } catch (error) {
      if (String(error).includes("UNIQUE constraint")) throw new ApiError(409, "This version was confirmed by another request. Refresh and review the current answer key.");
      throw error;
    }
    return { ok: true, version };
  }
  private async importDocuments(input: Record<string, unknown>) {
    const project = projectById(string(input.projectId, "Project", 100));
    if (!Array.isArray(input.documents) || input.documents.length === 0 || input.documents.length > 500) throw new ApiError(400, "Import between 1 and 500 documents at a time.");
    const ids = new Set<string>(), hashes = new Set<string>();
    const now = new Date().toISOString();
    const statements = [];
    for (const entry of input.documents) {
      const item = object(entry);
      const id = validId(item.id, "Document ID");
      const title = string(item.title, "Document title", 500);
      const source = string(item.source, "Document text", 200000);
      const question = string(item.question, "Question", 20000);
      const answer = string(item.answer, "Answer", 100000);
      const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify([source, question, answer])));
      const hash = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
      if (ids.has(id) || hashes.has(hash)) throw new ApiError(409, "The import contains duplicate documents. No documents were imported.");
      ids.add(id); hashes.add(hash);
      statements.push(this.db.prepare("INSERT INTO documents (project_id, id, title, source, question, answer, content_hash, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").bind(project.id, id, title, source, question, answer, hash, now));
    }
    try { await this.db.batch(statements); }
    catch (error) {
      if (String(error).includes("UNIQUE constraint")) throw new ApiError(409, "At least one document ID or document content already exists. No documents were imported.");
      throw error;
    }
    return { ok: true, imported: statements.length };
  }
  async export(projectId: string) {
    requireAdmin(this.actor);
    const project = projectById(projectId);
    const rows = await this.db.prepare("SELECT s.id, s.project_id AS projectId, s.document_id AS documentId, s.user_id AS userId, s.request_id AS requestId, s.qualification_version AS qualificationVersion, (SELECT q.passed_at FROM qualifications q WHERE q.project_id = s.project_id AND q.user_id = s.user_id AND q.version = s.qualification_version ORDER BY q.passed_at LIMIT 1) AS qualificationPassedAt, s.saved_at AS savedAt, s.payload, d.title, d.source, d.question, d.answer FROM submissions s JOIN documents d ON d.project_id = s.project_id AND d.id = s.document_id WHERE s.project_id = ? ORDER BY s.saved_at, s.id").bind(projectId).all<{ payload: string; [key: string]: unknown }>();
    const answerKeys = (await this.db.prepare("SELECT version, answers, confirmed_by AS confirmedBy, confirmed_at AS confirmedAt FROM answer_key_versions WHERE domain = ? ORDER BY confirmed_at").bind(project.domain).all<{ answers: string; [key: string]: unknown }>()).results.map((key) => ({ ...key, answers: JSON.parse(key.answers) }));
    return { project, exportedAt: new Date().toISOString(), answerKeys, annotations: rows.results.map(({ payload, ...row }) => ({ ...row, ...JSON.parse(payload) })) };
  }
}
