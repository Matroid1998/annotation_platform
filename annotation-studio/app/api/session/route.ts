import { actor, authMode, configured, handle, service } from "@/lib/server/http";
export const dynamic = "force-dynamic";
export async function GET() {
  return handle(async () => {
    const current = await actor();
    if (!current) return { user: null, isAdmin: false, projects: [], configured: await configured(), authMode: authMode(), mustChangePassword: false };
    const { isAdmin, mustChangePassword, ...user } = current;
    return { user, isAdmin, projects: await (await service()).sessionProjects(), configured: await configured(), authMode: authMode(), mustChangePassword };
  });
}
