import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { convertWithLocalOmr } from "./converter";

const samplePath = process.env.TABTRANSPORTER_OMR_SAMPLE;
const runIfSampleExists = samplePath && existsSync(samplePath) ? describe : describe.skip;

runIfSampleExists("Audiveris OMR integration", () => {
  it(
    "returns real converted data or a clear non-converted OMR failure",
    async () => {
      const result = await convertWithLocalOmr(samplePath!);

      if (result.status === "converted") {
        expect(result.musicXmlPath).toBeTruthy();
        expect(result.score?.tracks[0].notes.length).toBeGreaterThan(0);
        return;
      }

      expect(result.status, JSON.stringify(result, null, 2)).toBe("failed");
      expect(result.score).toBeUndefined();
      expect(result.message).toMatch(/MusicXML|Audiveris|변환/);
    },
    240_000
  );
});
