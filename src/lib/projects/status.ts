/**
 * Project status transition rules (Slice 6).
 * Generation/approval flow: brief → draft → review → approved.
 * A failed generation never downgrades or destroys an approved draft.
 */
const ALLOWED_TRANSITIONS: Record<string, string[]> = {
  brief: ["brief", "draft", "review"],
  draft: ["draft", "review", "approved"],
  review: ["review", "approved", "draft"],
  approved: ["approved", "review"], // rollback to review allowed, never silently destroyed
  sold: ["sold"],
  archived: ["archived"],
};

export function canTransition(
  from: string,
  to: string
): boolean {
  return (ALLOWED_TRANSITIONS[from] ?? []).includes(to);
}

/**
 * Resolves the status after a successful draft generation: moves projects
 * forward into "review" from brief/draft, never backward from approved/sold.
 */
export function statusAfterGeneration(current: string): string {
  if (current === "brief" || current === "draft") return "review";
  return current;
}
