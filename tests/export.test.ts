import { describe, it } from "vitest";
import { writeFileSync, mkdirSync } from "fs";
import path from "path";
import { contentInventory } from "@/content/content-inventory";
import { homeSchemaVersion } from "@/content/schema-version";
import {
  generateAcfFieldGroup,
  generateFieldMappings,
  validateInventory,
} from "@/lib/schema/generate";
import { toAcfImportFile } from "@/lib/schema/to-acf-json";

/**
 * Slice 2/3 export: writes the generated ACF field-group definition, the
 * field-mapping report, and the ACF-native import file to exports/ as
 * reviewable artifacts.
 *
 * LOCAL + OFFLINE: no network requests, no WordPress calls.
 * Run with: npm run export
 */
describe("schema export", () => {
  it("writes reviewable export artifacts to exports/", () => {
    const group = generateAcfFieldGroup(contentInventory, homeSchemaVersion);
    const mappings = generateFieldMappings(contentInventory, homeSchemaVersion);
    const issues = validateInventory(contentInventory);
    const acfImport = toAcfImportFile(group);

    const outDir = path.join(__dirname, "..", "exports");
    mkdirSync(outDir, { recursive: true });

    writeFileSync(
      path.join(outDir, "acf-field-group.json"),
      JSON.stringify(group, null, 2)
    );
    writeFileSync(
      path.join(outDir, "field-mappings.json"),
      JSON.stringify(mappings, null, 2)
    );
    writeFileSync(
      path.join(outDir, "acf-import.acf.json"),
      JSON.stringify(acfImport, null, 2)
    );
    writeFileSync(
      path.join(outDir, "full-export.json"),
      JSON.stringify(
        {
          schemaVersion: group.schemaVersion,
          templateKey: group.templateKey,
          templateVersion: group.templateVersion,
          acfFieldGroup: group,
          acfImportFile: acfImport,
          fieldMappings: mappings,
          issues,
        },
        null,
        2
      )
    );

    console.log(
      "Wrote exports/acf-field-group.json, exports/field-mappings.json, exports/acf-import.acf.json, exports/full-export.json"
    );
  });
});
