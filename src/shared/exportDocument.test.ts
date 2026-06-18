import { describe, expect, it } from "vitest";
import { transposeAndRemap } from "./fingering";
import { GUITAR_STANDARD_6 } from "./instruments";
import { buildExportHtml } from "./exportDocument";
import type { ScoreModel } from "./types";

describe("export document", () => {
  it("변환된 악보와 TAB 운지 결과만 담은 HTML을 만든다", () => {
    const options = {
      semitones: 2,
      capo: 0,
      instrumentPresetId: GUITAR_STANDARD_6.id
    };
    const result = transposeAndRemap(createTestScore(), options);

    const html = buildExportHtml({
      score: result.score,
      sourceName: "sample.pdf",
      instrumentName: GUITAR_STANDARD_6.name,
      transposeOptions: options,
      warnings: result.warnings
    });

    expect(html).toContain("변환 결과");
    expect(html).toContain("sample.pdf");
    expect(html).toContain("반음 +2");
    expect(html).toContain("일반 악보");
    expect(html).toContain("TAB");
    expect(html).toContain("추천 운지");
    expect(html).toContain("번줄");
    expect(html).not.toContain("PDF/이미지 열기");
  });
});

function createTestScore(): ScoreModel {
  return {
    id: "test-score",
    title: "테스트 악보",
    tempo: 92,
    timeSignature: [4, 4],
    tracks: [
      {
        id: "track-1",
        name: "테스트 트랙",
        instrumentPresetId: GUITAR_STANDARD_6.id,
        notes: [
          { id: "n1", measure: 1, beat: 1, durationBeats: 1, midi: 52 },
          { id: "n2", measure: 1, beat: 2, durationBeats: 1, midi: 55 },
          { id: "n3", measure: 1, beat: 3, durationBeats: 1, midi: 59 },
          { id: "n4", measure: 1, beat: 4, durationBeats: 1, midi: 64 }
        ]
      }
    ]
  };
}
