import { describe, expect, it } from "vitest";
import { parseMusicXmlToScore } from "./converter";

const SIMPLE_MUSIC_XML = `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="4.0">
  <movement-title>테스트 악보</movement-title>
  <part id="P1">
    <measure number="1">
      <attributes>
        <divisions>1</divisions>
        <time>
          <beats>4</beats>
          <beat-type>4</beat-type>
        </time>
      </attributes>
      <sound tempo="108" />
      <note>
        <pitch>
          <step>C</step>
          <octave>4</octave>
        </pitch>
        <duration>1</duration>
      </note>
      <note>
        <chord />
        <pitch>
          <step>E</step>
          <octave>4</octave>
        </pitch>
        <duration>1</duration>
      </note>
      <note>
        <pitch>
          <step>D</step>
          <alter>1</alter>
          <octave>4</octave>
        </pitch>
        <duration>2</duration>
      </note>
    </measure>
  </part>
</score-partwise>`;

describe("MusicXML OMR parsing", () => {
  it("MusicXML 음표를 일반 음표 데이터로 읽는다", () => {
    const score = parseMusicXmlToScore(SIMPLE_MUSIC_XML, "fallback.pdf");

    expect(score.title).toBe("테스트 악보");
    expect(score.tempo).toBe(108);
    expect(score.timeSignature).toEqual([4, 4]);
    expect(score.tracks[0].notes.map((note) => note.midi)).toEqual([60, 64, 63]);
    expect(score.tracks[0].notes.map((note) => note.beat)).toEqual([1, 1, 2]);
    expect(score.tracks[0].notes.map((note) => note.durationBeats)).toEqual([1, 1, 2]);
  });
});
