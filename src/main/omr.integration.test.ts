import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { convertWithLocalOmr } from "./converter";

const samplePath = process.env.TABTRANSPORTER_OMR_SAMPLE;
const runIfSampleExists = samplePath && existsSync(samplePath) ? describe : describe.skip;

runIfSampleExists("Audiveris OMR integration", () => {
  it(
    "converts a real PDF or image score into parsed note data",
    async () => {
      const result = await convertWithLocalOmr(samplePath!);

      expect(result.status, JSON.stringify(result, null, 2)).toBe("converted");
      expect(result.score?.tracks[0].notes.length).toBeGreaterThan(0);
      expect(result.musicXmlPath ?? result.diagnostics.find((item) => item.includes("fallback"))).toBeTruthy();
    },
    240_000
  );
});
