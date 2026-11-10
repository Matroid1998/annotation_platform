import { handle, service } from "@/lib/server/http";
export const dynamic = "force-dynamic";
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  return handle(async () => (await service()).project((await context.params).id));
}
