import { useCallback, useEffect, useRef, useState } from "react";
import { getInstrumentPreset } from "../../shared/instruments";
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
    void audio.resume();

    const preset = getInstrumentPreset(track.instrumentPresetId);
    const beatMs = 60_000 / score.tempo;
    setPlaying(true);

    for (const note of track.notes) {
      const startMs = ((note.measure - 1) * score.timeSignature[0] + (note.beat - 1)) * beatMs;
      const durationMs = Math.max(120, note.durationBeats * beatMs * 0.8);

      const timer = window.setTimeout(() => {
        setActiveNoteId(note.id);
        const source = createPluckedString(audio, note.midi, durationMs / 1000, preset.type);
        const gain = audio.createGain();
        const tone = audio.createBiquadFilter();
        const body = audio.createBiquadFilter();

        tone.type = "lowpass";
        tone.frequency.value = preset.type === "bass" ? 1800 : 4200;
        tone.Q.value = 0.7;
        body.type = "peaking";
        body.frequency.value = preset.type === "bass" ? 120 : 240;
        body.Q.value = 1.2;
        body.gain.value = preset.type === "bass" ? 5 : 3;
        gain.gain.value = preset.type === "bass" ? 0.14 : 0.1;
        source.connect(body);
        body.connect(tone);
        tone.connect(gain);
        gain.connect(audio.destination);
        source.start();
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

function createPluckedString(
  audio: AudioContext,
  midi: number,
  durationSeconds: number,
  instrumentType: "guitar" | "bass"
): AudioBufferSourceNode {
  const frequency = 440 * 2 ** ((midi - 69) / 12);
  const sampleRate = audio.sampleRate;
  const length = Math.max(1, Math.floor(sampleRate * durationSeconds));
  const period = Math.max(2, Math.floor(sampleRate / frequency));
  const damping = instrumentType === "bass" ? 0.994 : 0.988;
  const buffer = audio.createBuffer(1, length, sampleRate);
  const data = buffer.getChannelData(0);

  for (let i = 0; i < Math.min(period, length); i += 1) {
    data[i] = Math.random() * 2 - 1;
  }

  for (let i = period; i < length; i += 1) {
    const previous = data[i - period];
    const next = data[i - period + 1] ?? previous;
    data[i] = (previous + next) * 0.5 * damping;
  }

  for (let i = 0; i < length; i += 1) {
    const envelope = 1 - i / length;
    data[i] *= envelope * envelope;
  }

  const source = audio.createBufferSource();
  source.buffer = buffer;
  return source;
}
