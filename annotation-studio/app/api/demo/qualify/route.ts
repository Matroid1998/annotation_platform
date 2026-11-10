import { handle, readJson } from "@/lib/server/http";
import { object, validateAnswers } from "@/lib/server/validation";

export const dynamic = "force-dynamic";

// Demonstrates the supplied guideline's proposed key without putting it in the
// browser bundle. This endpoint never creates a live qualification or membership.
const demoAnswers = ["C", "A", "D", "B", "D", "A", "C", "B", "C", "B"];

export async function POST(request: Request) {
  return handle(async () => {
    const answers = validateAnswers(object(await readJson(request)).answers);
    const correct = demoAnswers.reduce((count, answer, index) => count + (answers[String(index + 1)] === answer ? 1 : 0), 0);
    return { passed: correct === demoAnswers.length, correct, total: demoAnswers.length };
  });
}
