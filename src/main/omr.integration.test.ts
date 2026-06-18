import { existsSync } from "node:fs";
import { basename } from "node:path";
import { describe, expect, it } from "vitest";
import { convertWithLocalOmr } from "./converter";

const samplePath = process.env.TABTRANSPORTER_OMR_SAMPLE;
const runIfSampleExists = samplePath && existsSync(samplePath) ? describe : describe.skip;

runIfSampleExists("Audiveris OMR integration", () => {
  it(
    "returns real converted data or a clear non-converted OMR failure",
    async () => {
      const result = await convertWithLocalOmr(samplePath!);
      const sampleName = basename(samplePath!);

      if (sampleName === "Back in time-bass.pdf") {
        expect(result.status, JSON.stringify(result, null, 2)).toBe("converted");
      }

      if (result.status === "converted") {
        expect(result.musicXmlPath).toBeTruthy();
        expect(result.score?.tracks[0].notes.length).toBeGreaterThan(0);
        expect(result.score?.tracks[0].notes.some((note) => note.originalSource)).toBe(true);
        expect(result.diagnostics.some((item) => item.includes("원본 레이아웃 좌표 연결"))).toBe(true);
        return;
      }

      expect(result.status, JSON.stringify(result, null, 2)).toBe("failed");
      expect(result.score).toBeUndefined();
      expect(result.message).toMatch(/MusicXML|Audiveris|변환/);
    },
    240_000
  );
});
