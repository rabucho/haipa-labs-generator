import { z } from "zod";
import {
  BuilderDocumentSchema,
  validateBuilderDocument,
  type BuilderDocument,
} from "@/types/builder";
import { hashBuilderDocument } from "@/lib/templates/version-store";

/**
 * Slice 21 — versioned template import/export package.
 *
 * The package is a STRUCTURED template definition, never executable code.
 * JSON is parsed with JSON.parse (no evaluation), validated with strict
 * Zod schemas (unknown keys rejected), and additionally scanned for
 * JSX/HTML/script patterns. Import always creates a NEW draft version;
 * published/existing versions are never overwritten.
 */

export const TEMPLATE_PACKAGE_VERSION = "1.0";

const FamilySchema = z
  .object({
    key: z
      .string()
      .min(2)
      .max(60)
      .regex(/^[a-z0-9][a-z0-9-]*$/, "Family key must be lowercase letters, numbers, and hyphens."),
    name: z.string().min(1).max(120),
  })
  .strict();

const ProvenanceSchema = z
  .object({
    source: z.string().min(1).max(60),
    label: z.string().max(120).optional(),
  })
  .strict();

export const TemplatePackageSchema = z
  .object({
    packageVersion: z.literal(TEMPLATE_PACKAGE_VERSION),
    family: FamilySchema,
    version: z
      .string()
      .min(3)
      .max(20)
      .regex(/^\d+\.\d+\.\d+$/, "Version must be semver-like (e.g. 1.2.0)."),
    document: BuilderDocumentSchema,
    provenance: ProvenanceSchema,
  })
  .strict();

export type TemplatePackage = z.infer<typeof TemplatePackageSchema>;

/** Strings that must never appear inside an imported template document. */
const UNSAFE_PATTERNS: Array<[RegExp, string]> = [
  [/<script[\s>]/i, "script tag"],
  [/<\/\s*(iframe|object|embed|svg|img|link|style)\s*>/i, "HTML element"],
  [/javascript\s*:/i, "javascript: URI"],
  [/\bon[a-z]+\s*=/i, "inline event handler"],
  [/(\{\{|\}\}|\$\{)/, "template expression"],
  [/\b(eval|Function|require|import)\s*\(/i, "executable expression"],
  [/document\s*\./i, "DOM access"],
  [/expression\s*\(/i, "CSS expression"],
];

/** Scans every string value in the package for JSX/HTML/JS injection. */
export function findUnsafeContent(value: unknown, path = ""): string[] {
  const issues: string[] = [];
  if (typeof value === "string") {
    for (const [pattern, label] of UNSAFE_PATTERNS) {
      if (pattern.test(value)) {
        issues.push(`${path || "(root)"}: contains ${label}`);
        break;
      }
    }
    return issues;
  }
  if (Array.isArray(value)) {
    value.forEach((item, idx) => issues.push(...findUnsafeContent(item, `${path}[${idx}]`)));
    return issues;
  }
  if (value !== null && typeof value === "object") {
    for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
      issues.push(...findUnsafeContent(v, path ? `${path}.${key}` : key));
    }
  }
  return issues;
}

export type PackageImportResult =
  | {
      ok: true;
      document: BuilderDocument;
      family: { key: string; name: string };
      version: string;
      contentHash: string;
      warnings: string[];
    }
  | { ok: false; errors: string[]; warnings: string[] };

/**
 * Validates an imported package WITHOUT persisting anything:
 * strict schema, structural document validation, unsafe-content scan,
 * and duplicate family-key+version detection against the existing catalog.
 */
export function validatePackageImport(
  raw: unknown,
  existing: Array<{ familyKey: string; version: string }>,
  maxBytes: number,
  rawLength: number
): PackageImportResult {
  const warnings: string[] = [];
  if (rawLength > maxBytes) {
    return {
      ok: false,
      errors: [`Package exceeds the import size limit (${rawLength} > ${maxBytes} bytes).`],
      warnings,
    };
  }
  const parsed = TemplatePackageSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      errors: [
        "Package failed schema validation.",
        ...parsed.error.errors.slice(0, 8).map((e) => `${e.path.join(".") || "(root)"}: ${e.message}`),
      ],
      warnings,
    };
  }
  const pkg = parsed.data;

  // Structural + approved-section/token validation from the existing builder.
  const issues = validateBuilderDocument(pkg.document);
  const errors = issues.filter((i) => i.severity === "error");
  const docWarnings = issues.filter((i) => i.severity !== "error");
  if (errors.length > 0) {
    return {
      ok: false,
      errors: [
        "Template document failed builder validation.",
        ...errors.slice(0, 8).map((e) => `${e.path}: ${e.message}`),
      ],
      warnings,
    };
  }
  warnings.push(...docWarnings.map((w) => `${w.path}: ${w.message}`));

  const unsafe = findUnsafeContent(pkg);
  if (unsafe.length > 0) {
    return {
      ok: false,
      errors: ["Package contains code-like content.", ...unsafe.slice(0, 8)],
      warnings,
    };
  }

  const duplicate = existing.some(
    (v) => v.familyKey === pkg.family.key && v.version === pkg.version
  );
  if (duplicate) {
    return {
      ok: false,
      errors: [
        `Version ${pkg.version} already exists for family "${pkg.family.key}". Import under a new version number — existing versions are never overwritten.`,
      ],
      warnings,
    };
  }

  return {
    ok: true,
    document: pkg.document,
    family: pkg.family,
    version: pkg.version,
    contentHash: hashBuilderDocument(pkg.document),
    warnings,
  };
}

/** Deterministic, round-trippable export package for a stored version. */
export function buildTemplatePackage(input: {
  familyKey: string;
  familyName: string;
  version: string;
  document: BuilderDocument;
  source?: string;
  label?: string;
}) {
  return {
    packageVersion: TEMPLATE_PACKAGE_VERSION,
    family: { key: input.familyKey, name: input.familyName },
    version: input.version,
    document: input.document,
    provenance: {
      source: input.source ?? "omoka-export",
      ...(input.label ? { label: input.label } : {}),
    },
  };
}
