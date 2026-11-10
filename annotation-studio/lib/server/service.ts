import questions from "./questionnaire.json";
import { ApiError, object, string, validId, validateAnswers, validateSubmission, type Domain } from "./validation";

export type Actor = { id: string; name: string; email: string; isAdmin: boolean };
type Database = Pick<D1Database, "prepare" | "batch">;
type Project = { id: string; name: string; domain: Domain; description: string };
type KeyRow = { domain: Domain; version: string; answers: string; confirmed_at: string };
type SubmissionRow = { id: string; project_id: string; document_id: string; request_id: string; payload: string; saved_at: string };
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
export class AnnotationService {
  constructor(private db: Database, private actor: Actor) {}
  async claimInvitations() {
    await this.db.prepare("UPDATE memberships SET user_id = ? WHERE email = ? AND user_id IS NULL AND NOT EXISTS (SELECT 1 FROM memberships existing WHERE existing.project_id = memberships.project_id AND existing.user_id = ?)")
      .bind(this.actor.id, this.actor.email.toLowerCase(), this.actor.id).run();
  }
  async assertMember(projectId: string, adminAllowed = false) {
    const project = projectById(projectId);
    if (adminAllowed && this.actor.isAdmin) return project;
    const member = await this.db.prepare("SELECT 1 FROM memberships WHERE project_id = ? AND user_id = ?").bind(projectId, this.actor.id).first();
    if (!member) throw new ApiError(404, "Project not found or access has not been assigned.");
    return project;
  }
  async key(domain: Domain) { return this.db.prepare("SELECT * FROM answer_keys WHERE domain = ?").bind(domain).first<KeyRow>(); }
  async qualification(project: Project) {
    const key = await this.key(project.domain);
    if (!key) return { passed: false, ready: false, version: null };
    const pass = await this.db.prepare("SELECT 1 FROM qualifications WHERE project_id = ? AND user_id = ? AND version = ?").bind(project.id, this.actor.id, key.version).first();
    return { passed: !!pass, ready: true, version: key.version };
  }
  async sessionProjects() {
    await this.claimInvitations();
    const membership = await this.db.prepare("SELECT project_id FROM memberships WHERE user_id = ?").bind(this.actor.id).all<{ project_id: string }>();
    const projects = PROJECTS.filter((p) => membership.results.some((m) => m.project_id === p.id));
    return Promise.all(projects.map(async (project) => {
      const counts = await this.db.prepare("SELECT (SELECT count(*) FROM documents WHERE project_id = ?) AS total, (SELECT count(*) FROM submissions WHERE project_id = ? AND user_id = ?) AS submitted").bind(project.id, project.id, this.actor.id).first<{ total: number; submitted: number }>();
      const q = await this.qualification(project);
      return { ...project, total: counts?.total ?? 0, submitted: counts?.submitted ?? 0, qualified: q.passed, qualificationReady: q.ready };
    }));
  }
  async project(projectId: string) {
    const project = await this.assertMember(projectId);
    const qualification = await this.qualification(project);
    // No dataset titles or content are returned until this user has passed.
    const documents = qualification.passed ? (await this.db.prepare("SELECT d.id, d.title, CASE WHEN s.id IS NULL THEN 0 ELSE 1 END AS submitted FROM documents d LEFT JOIN submissions s ON s.project_id = d.project_id AND s.document_id = d.id AND s.user_id = ? WHERE d.project_id = ? ORDER BY d.created_at, d.id").bind(this.actor.id, projectId).all<{ id: string; title: string; submitted: number }>()).results.map((d) => ({ ...d, submitted: !!d.submitted })) : [];
    return { project, documents, qualification, questions };
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
    const answers = validateAnswers(object(body).answers);
    const key = await this.key(project.domain);
    if (!key) throw new ApiError(409, "The administrator must confirm the qualification answer key first.");
    const expected = JSON.parse(key.answers) as string[];
    const correct = expected.reduce((count, answer, i) => count + (answers[String(i + 1)] === answer ? 1 : 0), 0);
    const now = new Date().toISOString();
    const guard = "EXISTS (SELECT 1 FROM memberships WHERE project_id = ? AND user_id = ?) AND EXISTS (SELECT 1 FROM answer_keys WHERE domain = ? AND version = ?)";
    const statements = [this.db.prepare(`INSERT INTO qualification_attempts (id, project_id, user_id, version, answers, correct, attempted_at) SELECT ?, ?, ?, ?, ?, ?, ? WHERE ${guard}`).bind(crypto.randomUUID(), projectId, this.actor.id, key.version, JSON.stringify(answers), correct, now, projectId, this.actor.id, project.domain, key.version)];
    if (correct === 10) statements.push(this.db.prepare(`INSERT OR IGNORE INTO qualifications (project_id, user_id, version, passed_at) SELECT ?, ?, ?, ? WHERE ${guard}`).bind(projectId, this.actor.id, key.version, now, projectId, this.actor.id, project.domain, key.version));
    const results = await this.db.batch(statements);
    if (!changed(results[0])) throw new ApiError(409, "Access or the qualification test changed. Refresh and try again.");
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
    // Membership, document existence and current qualification are rechecked inside the INSERT.
    const result = await this.db.prepare(`INSERT INTO submissions (id, project_id, document_id, user_id, request_id, payload, qualification_version, saved_at)
      SELECT ?, ?, ?, ?, ?, ?, ?, ?
      WHERE EXISTS (SELECT 1 FROM memberships WHERE project_id = ? AND user_id = ?)
      AND EXISTS (SELECT 1 FROM documents WHERE project_id = ? AND id = ?)
      AND EXISTS (SELECT 1 FROM qualifications q JOIN answer_keys k ON k.version = q.version AND k.domain = ? WHERE q.project_id = ? AND q.user_id = ? AND q.version = ?)
      ON CONFLICT DO NOTHING`).bind(id, projectId, documentId, this.actor.id, input.requestId, payload, qualification.version, savedAt, projectId, this.actor.id, projectId, documentId, project.domain, projectId, this.actor.id, qualification.version).run();
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
    const memberships = (await this.db.prepare("SELECT project_id AS projectId, email, user_id AS userId, created_at AS createdAt FROM memberships ORDER BY project_id, email").all()).results;
    const projects = await Promise.all(PROJECTS.map(async (project) => {
      const counts = await this.db.prepare("SELECT (SELECT count(*) FROM documents WHERE project_id = ?) AS total, (SELECT count(*) FROM memberships WHERE project_id = ?) AS members").bind(project.id, project.id).first();
      return { ...project, ...counts };
    }));
    const answerKeys = await Promise.all((["legal", "chemistry"] as const).map(async (domain) => {
      const key = await this.key(domain);
      return { domain, version: key?.version ?? "guidelines-v1", confirmed: !!key, answers: key ? JSON.parse(key.answers) : null, proposedAnswers, confirmedAt: key?.confirmed_at ?? null };
    }));
    return { memberships, projects, answerKeys, questions };
  }
  async adminAction(body: unknown) {
    requireAdmin(this.actor);
    const input = object(body);
    switch (input.action) {
      case "addMember": {
        const project = projectById(string(input.projectId, "Project", 100));
        const email = string(input.email, "Email", 254).toLowerCase();
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new ApiError(400, "Enter a valid email address.");
        await this.db.prepare("INSERT INTO memberships (project_id, email, created_at) VALUES (?, ?, ?) ON CONFLICT DO NOTHING").bind(project.id, email, new Date().toISOString()).run();
        return { ok: true };
      }
      case "removeMember": {
        const project = projectById(string(input.projectId, "Project", 100));
        const email = string(input.email, "Email", 254).toLowerCase();
        await this.db.prepare("DELETE FROM memberships WHERE project_id = ? AND email = ?").bind(project.id, email).run();
        return { ok: true };
      }
      case "confirmKey": return this.confirmKey(input);
      case "importDocuments": return this.importDocuments(input);
      default: throw new ApiError(400, "Unknown administrator action.");
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
    const rows = await this.db.prepare("SELECT s.id, s.project_id AS projectId, s.document_id AS documentId, s.user_id AS userId, s.request_id AS requestId, s.qualification_version AS qualificationVersion, s.saved_at AS savedAt, s.payload, d.title, d.source, d.question, d.answer FROM submissions s JOIN documents d ON d.project_id = s.project_id AND d.id = s.document_id WHERE s.project_id = ? ORDER BY s.saved_at, s.id").bind(projectId).all<{ payload: string; [key: string]: unknown }>();
    const answerKeys = (await this.db.prepare("SELECT version, answers, confirmed_by AS confirmedBy, confirmed_at AS confirmedAt FROM answer_key_versions WHERE domain = ? ORDER BY confirmed_at").bind(project.domain).all<{ answers: string; [key: string]: unknown }>()).results.map((key) => ({ ...key, answers: JSON.parse(key.answers) }));
    return { project, exportedAt: new Date().toISOString(), answerKeys, annotations: rows.results.map(({ payload, ...row }) => ({ ...row, ...JSON.parse(payload) })) };
  }
}
