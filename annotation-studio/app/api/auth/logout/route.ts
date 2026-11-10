import { clearSessionCookie, readSessionToken } from "@/lib/server/auth";
import { handle, json, localAuth, readJson } from "@/lib/server/http";
export const dynamic = "force-dynamic";
export async function POST(request: Request) {
  return handle(async () => {
    await readJson(request);
    await localAuth().logout(readSessionToken(request.headers.get("cookie")));
    return json({ ok: true }, 200, { "Set-Cookie": clearSessionCookie(request.url) });
  });
}
