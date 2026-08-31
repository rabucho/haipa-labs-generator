import { HomeContent, HomeContentSchema } from "@/types/content";
import { homeFixture } from "@/content/home.fixture";

/**
 * Editor draft validation (pure).
 *
 * 1. Unknown field names are REJECTED by comparing the input's key structure
 *    against the approved fixture template (no private Zod internals).
 * 2. The remaining object is validated with the approved HomeContentSchema.
 *
 * Optional fields may be omitted; unknown/extra keys may not.
 */

export function findUnknownKeys(
  input: unknown,
  template: unknown,
  prefix = ""
): string[] {
  if (Array.isArray(template)) {
    if (!Array.isArray(input)) return [];
    const rowTemplate = template[0];
    const unknown: string[] = [];
    input.forEach((item, idx) => {
      unknown.push(
        ...findUnknownKeys(item, rowTemplate, `${prefix}[${idx}]`)
      );
    });
    return unknown;
  }

  if (
    template !== null &&
    typeof template === "object" &&
    input !== null &&
    typeof input === "object" &&
    !Array.isArray(input)
  ) {
    const templateKeys = new Set(
      Object.keys(template as Record<string, unknown>)
    );
    const unknown: string[] = [];
    for (const [key, value] of Object.entries(
      input as Record<string, unknown>
    )) {
      const path = prefix ? `${prefix}.${key}` : key;
      if (!templateKeys.has(key)) {
        unknown.push(path);
        continue;
      }
      unknown.push(
        ...findUnknownKeys(value, (template as Record<string, unknown>)[key], path)
      );
    }
    return unknown;
  }

  return [];
}

export type EditorValidationResult =
  | { ok: true; content: HomeContent }
  | { ok: false; errors: string[] };

/** Validates an operator draft: unknown keys rejected, then schema-checked. */
export function validateEditorDraft(input: unknown): EditorValidationResult {
  const unknownKeys = findUnknownKeys(input, homeFixture);
  if (unknownKeys.length > 0) {
    return {
      ok: false,
      errors: unknownKeys.map((k) => `Unknown field: ${k}`),
    };
  }

  const parsed = HomeContentSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      errors: parsed.error.errors.map(
        (e) => `Path [${e.path.join(".") || "(root)"}]: ${e.message}`
      ),
    };
  }

  return { ok: true, content: parsed.data };
}
