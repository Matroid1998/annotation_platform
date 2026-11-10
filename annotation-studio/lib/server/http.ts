import { env } from "cloudflare:workers";
import { getChatGPTUser } from "@/app/chatgpt-auth";
import { AnnotationService, type Actor } from "./service";
import { ApiError } from "./validation";

type AppEnvironment = Cloudflare.Env & { ADMIN_EMAILS?: string; ADMIN_USER_IDS?: string };
const noCache = { "Cache-Control": "private, no-store, max-age=0", "Pragma": "no-cache", "Vary": "Cookie", "X-Content-Type-Options": "nosniff" };
function list(value?: string) { return (value ?? "").split(",").map((entry) => entry.trim()).filter(Boolean); }
export function configured() { const e = env as AppEnvironment; return list(e.ADMIN_EMAILS).length > 0 || list(e.ADMIN_USER_IDS).length > 0; }
export async function actor(): Promise<Actor | null> {
  const user = await getChatGPTUser();
  if (!user) return null;
  const e = env as AppEnvironment;
  const isAdmin = list(e.ADMIN_USER_IDS).includes(user.userId) || list(e.ADMIN_EMAILS).map((entry) => entry.toLowerCase()).includes(user.email.toLowerCase());
  return { id: user.userId, name: user.displayName, email: user.email, isAdmin };
}
export async function service() {
  const user = await actor();
  if (!user) throw new ApiError(401, "Sign in to continue.");
  const db = (env as AppEnvironment).DB;
  if (!db) throw new ApiError(503, "The annotation database is not configured. No annotations can be submitted yet.");
  const instance = new AnnotationService(db.withSession("first-primary"), user);
  await instance.claimInvitations();
  return instance;
}
export function json(value: unknown, status = 200, headers?: Record<string, string>) { return Response.json(value, { status, headers: { ...noCache, ...headers } }); }
export async function handle(work: () => Promise<unknown>): Promise<Response> {
  try { const result = await work(); return result instanceof Response ? result : json(result); }
  catch (error) {
    if (error instanceof ApiError) return json({ error: error.message }, error.status);
    console.error("Annotation API request failed", error instanceof Error ? error.name : "Unknown error");
    return json({ error: "The server could not complete this request. If you were submitting, keep this page open and retry; your existing saved annotations are unchanged." }, 503);
  }
}
export async function readJson(request: Request): Promise<unknown> {
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) throw new ApiError(403, "Cross-origin requests are not permitted.");
  if (request.headers.get("sec-fetch-site") === "cross-site") throw new ApiError(403, "Cross-site requests are not permitted.");
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) throw new ApiError(415, "Send JSON with Content-Type application/json.");
  const limit = 12 * 1024 * 1024;
  const declared = Number(request.headers.get("content-length"));
  if (declared > limit) throw new ApiError(413, "This import is too large. Use a smaller batch.");
  const reader = request.body?.getReader();
  if (!reader) throw new ApiError(400, "A JSON body is required.");
  const chunks: Uint8Array[] = [];
  let length = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.byteLength;
    if (length > limit) { await reader.cancel(); throw new ApiError(413, "This request is too large. Use a smaller batch."); }
    chunks.push(value);
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  try { return JSON.parse(new TextDecoder().decode(bytes)); }
  catch { throw new ApiError(400, "The request body must be valid JSON."); }
}
export function pdfResponse(bytes: Uint8Array, filename: string) {
  return new Response(bytes as BodyInit, { headers: { ...noCache, "Content-Type": "application/pdf", "Content-Disposition": `inline; filename="${filename}"` } });
}
