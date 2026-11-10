import { handle, pdfResponse } from "@/lib/server/http";
import { ApiError } from "@/lib/server/validation";
import pdfs from "@/lib/server/guideline-pdfs.json";

export const dynamic = "force-dynamic";

// Only the two supplied reference guides are available in sample mode.
// Private dataset documents and annotations always require project membership.
export async function GET(_request: Request, context: { params: Promise<{ domain: string }> }) {
  return handle(async () => {
    const { domain } = await context.params;
    if (domain !== "legal" && domain !== "chemistry") throw new ApiError(404, "Guideline not found.");
    const bytes = Uint8Array.from(atob(pdfs[domain]), (character) => character.charCodeAt(0));
    return pdfResponse(bytes, `${domain}_annotation_guidelines.pdf`);
  });
}
