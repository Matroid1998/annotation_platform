import { assertExpectedActor, authResponse, readSessionToken, sessionCookie } from "@/lib/server/auth";
import { handle, json, localAuth, readJson } from "@/lib/server/http";
export const dynamic = "force-dynamic";
export async function POST(request: Request) {
  return handle(async () => {
    const auth = localAuth();
    const token = readSessionToken(request.headers.get("cookie"));
    const current = await auth.actor(token);
    if (current) assertExpectedActor(request.headers.get("X-Annotation-Actor"), current);
    const result = await auth.changePassword(token, await readJson(request));
    return json(authResponse(result), 200, { "Set-Cookie": sessionCookie(result.token, request.url, result.expiresAt) });
  });
}
