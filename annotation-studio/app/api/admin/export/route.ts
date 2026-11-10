import { handle, json, service } from "@/lib/server/http";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  return handle(async () => {
    const projectId = new URL(request.url).searchParams.get("projectId") ?? "";
    const exported = await (await service()).export(projectId);
    return json(exported, 200, { "Content-Disposition": `attachment; filename="${exported.project.id}-annotations.json"` });
  });
}
