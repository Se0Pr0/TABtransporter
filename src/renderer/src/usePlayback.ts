import { useCallback, useEffect, useRef, useState } from "react";
import type { ScoreModel } from "../../shared/types";

export function usePlayback(score: ScoreModel) {
  const [playing, setPlaying] = useState(false);
  const [activeNoteId, setActiveNoteId] = useState<string | undefined>();
  const timers = useRef<number[]>([]);
  const context = useRef<AudioContext | undefined>();

  const stop = useCallback(() => {
    for (const timer of timers.current) {
      window.clearTimeout(timer);
    }
    timers.current = [];
    setPlaying(false);
    setActiveNoteId(undefined);
  }, []);

  const play = useCallback(() => {
    stop();

    const track = score.tracks[0];
    if (!track) {
      return;
    }

    const audio = context.current ?? new AudioContext();
    context.current = audio;

    const beatMs = 60_000 / score.tempo;
    setPlaying(true);

    for (const note of track.notes) {
      const startMs = ((note.measure - 1) * score.timeSignature[0] + (note.beat - 1)) * beatMs;
      const durationMs = Math.max(120, note.durationBeats * beatMs * 0.8);

      const timer = window.setTimeout(() => {
        setActiveNoteId(note.id);
        const oscillator = audio.createOscillator();
        const gain = audio.createGain();
        oscillator.frequency.value = 440 * 2 ** ((note.midi - 69) / 12);
        oscillator.type = "triangle";
        gain.gain.value = 0.08;
        oscillator.connect(gain);
        gain.connect(audio.destination);
        oscillator.start();
        oscillator.stop(audio.currentTime + durationMs / 1000);
      }, startMs);
      timers.current.push(timer);
    }

    const lastNote = track.notes.at(-1);
    const endMs = lastNote
      ? ((lastNote.measure - 1) * score.timeSignature[0] + lastNote.beat + lastNote.durationBeats) * beatMs
      : 0;
    timers.current.push(window.setTimeout(stop, endMs + 100));
  }, [score, stop]);

  useEffect(() => stop, [stop]);

  return { playing, activeNoteId, play, stop };
}
