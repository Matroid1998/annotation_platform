import { handle, readJson, service } from "@/lib/server/http";
export const dynamic = "force-dynamic";
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const api = await service();
    return api.acknowledgeGuideline((await context.params).id, await readJson(request));
  });
}
