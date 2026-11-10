import { handle, pdfResponse, service } from "@/lib/server/http";
import pdfs from "@/lib/server/guideline-pdfs.json";
export const dynamic = "force-dynamic";
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const project = await (await service()).assertMember((await context.params).id, true);
    const bytes = Uint8Array.from(atob(pdfs[project.domain]), (character) => character.charCodeAt(0));
    return pdfResponse(bytes, `${project.domain}_annotation_guidelines.pdf`);
  });
}
