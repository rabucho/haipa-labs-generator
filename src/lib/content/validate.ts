import { HomeContentSchema, HomeContent } from "@/types/content";
import { ZodError } from "zod";

export type ValidationResult =
  | { success: true; data: HomeContent }
  | { success: false; error: string; details: string[] };

/**
 * Validates any raw object against the strict HomeContent Zod schema.
 */
export function validateHomeContent(data: unknown): ValidationResult {
  try {
    const parsed = HomeContentSchema.parse(data);
    return { success: true, data: parsed };
  } catch (error) {
    if (error instanceof ZodError) {
      const details = error.errors.map(
        (err) => `Path [${err.path.join(".")}]: ${err.message}`
      );
      return {
        success: false,
        error: "Content validation failed. Raw data does not conform to the schema contract.",
        details,
      };
    }
    return {
      success: false,
      error: "An unexpected error occurred during validation.",
      details: [String(error)],
    };
  }
}
