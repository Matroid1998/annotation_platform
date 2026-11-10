import { handle, readJson, service } from "@/lib/server/http";
export const dynamic = "force-dynamic";
export async function POST(request: Request, context: { params: Promise<{ id: string; documentId: string }> }) {
  return handle(async () => { const { id, documentId } = await context.params; const api = await service(); return api.submit(id, documentId, await readJson(request)); });
}
