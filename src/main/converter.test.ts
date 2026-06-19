import { describe, expect, it } from "vitest";
import { parseAudiverisSheetHeadsToNotes, parseMusicXmlToScore } from "./converter";

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
      <harmony>
        <root>
          <root-step>C</root-step>
          <root-alter>1</root-alter>
        </root>
        <kind text="m7">minor-seventh</kind>
        <bass>
          <bass-step>E</bass-step>
        </bass>
      </harmony>
      <note>
        <pitch>
          <step>C</step>
          <octave>4</octave>
        </pitch>
        <duration>1</duration>
        <notations>
          <technical>
            <string>2</string>
            <fret>1</fret>
          </technical>
        </notations>
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
    expect(score.tracks[0].notes[0].originalTab).toEqual({ stringNumber: 2, fret: 1, physicalFret: 1 });
    expect(score.tracks[0].chords?.map((chord) => `${chord.text}:${chord.beat}`)).toEqual(["C#m7/E:1"]);
  });

  it("recovers low-confidence notes from Audiveris internal sheet XML", () => {
    const sheetXml = `
      <sheet>
        <clef kind="TREBLE" shape="G_CLEF" staff="1" />
        <key fifths="1" staff="1" />
        <head id="a" pitch="0" shape="NOTEHEAD_BLACK" grade="0.91" ctx-grade="0.72" staff="1">
          <bounds x="10" y="20" w="6" h="6" />
        </head>
        <head id="b" pitch="1" shape="NOTEHEAD_BLACK" grade="0.88" ctx-grade="0.7" staff="1">
          <bounds x="35" y="26" w="6" h="6" />
        </head>
      </sheet>`;

    const notes = parseAudiverisSheetHeadsToNotes(sheetXml, 1);

    expect(notes).toHaveLength(2);
    expect(notes.map((note) => note.midi)).toEqual([71, 69]);
    expect(notes.map((note) => note.beat)).toEqual([1, 2]);
    expect(notes[0].originalSource).toEqual({ page: 1, x: 10, y: 20, width: 6, height: 6, staff: 1 });
    expect(notes.every((note) => note.confidence !== undefined && note.confidence <= 0.55)).toBe(true);
  });
});
