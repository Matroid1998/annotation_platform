import { handle, readJson, service } from "@/lib/server/http";
export const dynamic = "force-dynamic";
export async function GET() { return handle(async () => (await service()).adminOverview()); }
export async function POST(request: Request) { return handle(async () => { const api = await service(); return api.adminAction(await readJson(request)); }); }
