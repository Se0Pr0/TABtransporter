import { describe, expect, it } from "vitest";
import { buildLayoutRewritePlacements } from "./layoutRewrite";
import type { NoteEvent, ScoreLayoutPage } from "./types";

describe("layout rewrite placement", () => {
  it("estimates vertical pitch movement from source note coordinates", () => {
    const page: ScoreLayoutPage = { page: 1, width: 1000, height: 1400 };
    const notes: NoteEvent[] = [
      createNote("n1", 64, 66, 100, 200),
      createNote("n2", 62, 64, 180, 216),
      createNote("n3", 60, 62, 260, 232)
    ];

    const placements = buildLayoutRewritePlacements(notes, page);
    const first = placements[0];

    expect(first.rewrittenTopPercent).toBeCloseTo(((204 - 16) / 1400) * 100, 1);
    expect(first.noteMaskHeight).toBeGreaterThan(38);
    expect(first.tabTopPercent).toBeGreaterThan(first.sourceTopPercent);
  });

  it("uses separate vertical clusters for different systems", () => {
    const page: ScoreLayoutPage = { page: 1, width: 1000, height: 1400 };
    const notes: NoteEvent[] = [
      createNote("n1", 64, 66, 100, 200),
      createNote("n2", 62, 64, 180, 216),
      createNote("n3", 64, 66, 100, 620),
      createNote("n4", 62, 64, 180, 632)
    ];

    const placements = buildLayoutRewritePlacements(notes, page);

    expect(placements[0].tabTopPercent).toBeDefined();
    expect(placements[2].tabTopPercent).toBeDefined();
    expect(placements[0].tabTopPercent!).toBeLessThan(placements[2].tabTopPercent!);
    expect(placements[2].rewrittenTopPercent).toBeGreaterThan(placements[0].rewrittenTopPercent);
  });
});

function createNote(id: string, originalMidi: number, midi: number, x: number, y: number): NoteEvent {
  return {
    id,
    measure: 1,
    beat: 1,
    durationBeats: 1,
    originalMidi,
    midi,
    tab: { stringNumber: 2, fret: 5, physicalFret: 5 },
    originalSource: { page: 1, pageWidth: 1000, pageHeight: 1400, x, y, width: 8, height: 8, staff: 1 }
  };
}
