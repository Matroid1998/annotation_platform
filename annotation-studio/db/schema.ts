import { sqliteTable, text, integer, primaryKey, uniqueIndex } from "drizzle-orm/sqlite-core";

export const localAccounts = sqliteTable("local_accounts", {
  id: text("id").primaryKey(), email: text("email").notNull(), name: text("name").notNull(), passwordHash: text("password_hash").notNull(),
  role: text("role", { enum: ["admin", "annotator"] }).notNull(), active: integer("active").notNull().default(1), mustChangePassword: integer("must_change_password").notNull().default(1),
  createdAt: text("created_at").notNull(), updatedAt: text("updated_at").notNull(),
}, (t) => [uniqueIndex("local_account_email").on(t.email)]);
export const authSessions = sqliteTable("auth_sessions", {
  tokenHash: text("token_hash").primaryKey(), userId: text("user_id").notNull().references(() => localAccounts.id, { onDelete: "cascade" }), createdAt: text("created_at").notNull(), expiresAt: text("expires_at").notNull(),
});
export const authRateLimits = sqliteTable("auth_rate_limits", {
  scopeHash: text("scope_hash").primaryKey(), attempts: integer("attempts").notNull(), windowStartedAt: integer("window_started_at").notNull(),
});

export const memberships = sqliteTable("memberships", {
  projectId: text("project_id").notNull(), email: text("email").notNull(), userId: text("user_id"), createdAt: text("created_at").notNull(),
}, (t) => [primaryKey({ columns: [t.projectId, t.email] }), uniqueIndex("one_project_per_email").on(t.email), uniqueIndex("one_project_per_user").on(t.userId)]);
export const documents = sqliteTable("documents", {
  projectId: text("project_id").notNull(), id: text("id").notNull(), title: text("title").notNull(), source: text("source").notNull(), question: text("question").notNull(), answer: text("answer").notNull(), contentHash: text("content_hash").notNull(), createdAt: text("created_at").notNull(),
}, (t) => [primaryKey({ columns: [t.projectId, t.id] }), uniqueIndex("unique_document_content").on(t.projectId, t.contentHash)]);
export const answerKeys = sqliteTable("answer_keys", {
  domain: text("domain").primaryKey(), version: text("version").notNull(), answers: text("answers").notNull(), confirmedBy: text("confirmed_by").notNull(), confirmedAt: text("confirmed_at").notNull(),
});
export const answerKeyVersions = sqliteTable("answer_key_versions", {
  domain: text("domain").notNull(), version: text("version").notNull(), answers: text("answers").notNull(), confirmedBy: text("confirmed_by").notNull(), confirmedAt: text("confirmed_at").notNull(),
}, (t) => [primaryKey({ columns: [t.domain, t.version] })]);
export const guidelineAcknowledgements = sqliteTable("guideline_acknowledgements", {
  projectId: text("project_id").notNull(), userId: text("user_id").notNull(), acknowledgedAt: text("acknowledged_at").notNull(),
}, (t) => [primaryKey({ columns: [t.projectId, t.userId] })]);
export const qualifications = sqliteTable("qualifications", {
  projectId: text("project_id").notNull(), userId: text("user_id").notNull(), version: text("version").notNull(), passedAt: text("passed_at").notNull(),
}, (t) => [primaryKey({ columns: [t.projectId, t.userId, t.version] })]);
export const qualificationAttempts = sqliteTable("qualification_attempts", {
  id: text("id").primaryKey(), projectId: text("project_id").notNull(), userId: text("user_id").notNull(), version: text("version").notNull(), answers: text("answers").notNull(), correct: integer("correct").notNull(), attemptedAt: text("attempted_at").notNull(),
});
export const submissions = sqliteTable("submissions", {
  id: text("id").primaryKey(), projectId: text("project_id").notNull(), documentId: text("document_id").notNull(), userId: text("user_id").notNull(), requestId: text("request_id").notNull(), payload: text("payload").notNull(), qualificationVersion: text("qualification_version").notNull(), savedAt: text("saved_at").notNull(),
}, (t) => [uniqueIndex("one_submission_per_document").on(t.projectId, t.documentId, t.userId), uniqueIndex("idempotency_per_user").on(t.userId, t.requestId)]);
