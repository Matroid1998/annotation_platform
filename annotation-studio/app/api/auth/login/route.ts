import { authResponse, sessionCookie } from "@/lib/server/auth";
import { handle, json, localAuth, readJson } from "@/lib/server/http";
export const dynamic = "force-dynamic";
export async function POST(request: Request) {
  return handle(async () => {
    const result = await localAuth().login(await readJson(request));
    return json(authResponse(result), 200, { "Set-Cookie": sessionCookie(result.token, request.url, result.expiresAt) });
  });
}
