export type AdminSession = {
  user: { id: string; email: string; name: string } | null;
  isAdmin: boolean;
  configured: boolean;
  authMode: "local" | "chatgpt";
  mustChangePassword: boolean;
};
export type AdminProject = { id: string; name: string; domain: string; description: string; total: number; members: number };
export type Membership = { projectId: string; email: string; createdAt?: string; userId?: string; name?: string; active?: boolean | number; mustChangePassword?: boolean | number };
export type AnnotatorAccount = { id: string; name: string; email: string; role: "admin" | "annotator"; active: boolean; mustChangePassword: boolean; projectId: string | null; assignmentCount: number };
export type AnswerKey = { domain: string; version: string; answers: string[] | null; proposedAnswers: string[]; confirmedAt: string | null; confirmed: boolean };
export type KeyQuestion = { id: string; question: string; options: { value: string; label: string }[] };
export type AdminData = { projects: AdminProject[]; memberships: Membership[]; answerKeys: AnswerKey[]; questions: KeyQuestion[]; accounts: AnnotatorAccount[] };
export type AdminAction = (payload: Record<string, unknown>) => Promise<Record<string, unknown>>;

export async function apiJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, { credentials: "same-origin", cache: "no-store", ...init });
  const data = await response.json().catch(() => ({})) as { error?: string | { message?: string } };
  if (!response.ok) throw new Error(typeof data.error === "string" ? data.error : data.error?.message ?? `Request failed (${response.status}). Please try again.`);
  return data as T;
}
