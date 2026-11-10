export const CRITERION_IDS = ["grounding", "precision", "numerical_fidelity", "search_realism", "standalone_clarity", "information_value", "focus_formulation", "linguistic_quality"] as const;
export type Domain = "legal" | "chemistry";
export type Rating = { criterionId: string; score: number | null; comment: string };
export type SubmissionInput = { requestId: string; ratings: Rating[]; comment: string };

export class ApiError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
export function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new ApiError(400, "A JSON object is required.");
  return value as Record<string, unknown>;
}
export function string(value: unknown, label: string, max = 5000, allowEmpty = false): string {
  if (typeof value !== "string" || value.length > max || (!allowEmpty && !value.trim())) throw new ApiError(400, `${label} is required and must be at most ${max} characters.`);
  return value.trim();
}
export function validId(value: unknown, label = "ID"): string {
  const id = string(value, label, 120);
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(id)) throw new ApiError(400, `${label} contains unsupported characters.`);
  return id;
}
export function validateSubmission(value: unknown, domain: Domain): SubmissionInput {
  const body = object(value);
  const requestId = validId(body.requestId, "Submission request ID");
  if (!Array.isArray(body.ratings) || body.ratings.length !== CRITERION_IDS.length) throw new ApiError(400, "All eight criteria must be graded.");
  const byId = new Map<string, Rating>();
  for (const entry of body.ratings) {
    const row = object(entry);
    const criterionId = string(row.criterionId, "Criterion", 100);
    if (!CRITERION_IDS.includes(criterionId as typeof CRITERION_IDS[number]) || byId.has(criterionId)) throw new ApiError(400, "Each criterion must appear exactly once.");
    const score = row.score;
    if (score !== null && (typeof score !== "number" || !Number.isInteger(score) || score < 1 || score > 5)) throw new ApiError(400, "Scores must be whole numbers from 1 to 5, or cannot assess.");
    const comment = row.comment === undefined ? "" : string(row.comment, "Criterion explanation", 10000, true);
    if ((domain === "chemistry" || score === null || score <= 3 || score === 5) && !comment) throw new ApiError(400, "Explain every score of 3 or lower, exceptional score of 5, and cannot assess. Chemistry requires a reason for every score.");
    byId.set(criterionId, { criterionId, score, comment });
  }
  return { requestId, ratings: CRITERION_IDS.map((id) => byId.get(id)!), comment: body.comment === undefined ? "" : string(body.comment, "Document comment", 20000, true) };
}
export function validateAnswers(value: unknown): Record<string, string> {
  const input = object(value);
  if (Object.keys(input).length !== 10) throw new ApiError(400, "Answer all ten qualification questions.");
  return Object.fromEntries(Array.from({ length: 10 }, (_, i) => {
    const id = String(i + 1);
    const answer = input[id];
    if (typeof answer !== "string" || !/^[A-D]$/.test(answer)) throw new ApiError(400, "Choose one answer for every qualification question.");
    return [id, answer];
  }));
}
