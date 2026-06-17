import {
  AlertTriangle,
  Download,
  FileImage,
  FileMusic,
  FileText,
  FolderOpen,
  Pause,
  Play,
  RefreshCw,
  Save,
  SlidersHorizontal
} from "lucide-react";
import { useMemo, useState } from "react";
import { INSTRUMENT_PRESETS } from "../../shared/instruments";
import { transposeAndRemap } from "../../shared/fingering";
import { midiToNoteName } from "../../shared/pitch";
import { createDemoScore } from "../../shared/score";
import type { ConversionResult, FingeringWarning, OpenedScoreFile, ScoreModel } from "../../shared/types";
import { usePlayback } from "./usePlayback";

const KEY_OPTIONS = [
  { label: "Original", semitones: 0 },
  { label: "+1", semitones: 1 },
  { label: "+2", semitones: 2 },
  { label: "+3", semitones: 3 },
  { label: "+4", semitones: 4 },
  { label: "+5", semitones: 5 },
  { label: "-1", semitones: -1 },
  { label: "-2", semitones: -2 },
  { label: "-3", semitones: -3 },
  { label: "-4", semitones: -4 },
  { label: "-5", semitones: -5 }
];

export function App() {
  const [openedFile, setOpenedFile] = useState<OpenedScoreFile | undefined>();
  const [conversion, setConversion] = useState<ConversionResult | undefined>();
  const [sourceScore, setSourceScore] = useState<ScoreModel>(() => createDemoScore());
  const [instrumentId, setInstrumentId] = useState(INSTRUMENT_PRESETS[0].id);
  const [semitones, setSemitones] = useState(0);
  const [capo, setCapo] = useState(0);
  const [status, setStatus] = useState("Ready");
  const [warnings, setWarnings] = useState<FingeringWarning[]>([]);

  const remapped = useMemo(() => {
    const result = transposeAndRemap(sourceScore, {
      semitones,
      capo,
      instrumentPresetId: instrumentId
    });
    setTimeout(() => setWarnings(result.warnings), 0);
    return result.score;
  }, [sourceScore, semitones, capo, instrumentId]);

  const playback = usePlayback(remapped);

  async function openFile() {
    const file = await window.tabTransporter.openScoreFile();
    if (!file) {
      return;
    }

    setOpenedFile(file);
    setStatus(`Opened ${file.name}`);
    setConversion(undefined);

    const result = await window.tabTransporter.convertScoreFile(file.path);
    setConversion(result);
    setStatus(result.message);
    if (result.score) {
      setSourceScore(result.score);
    }
  }

  async function exportView(format: "pdf" | "png") {
    const result = await window.tabTransporter.exportCurrentView({
      format,
      defaultFileName: `${remapped.title || "tabtransporter"}-transposed.${format}`
    });
    setStatus(result.message);
  }

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <FileMusic size={22} />
          <div>
            <strong>TABtransporter</strong>
            <span>score to playable TAB</span>
          </div>
        </div>

        <button className="primary-action" onClick={openFile}>
          <FolderOpen size={18} />
          Open PDF/Image
        </button>

        <section className="panel">
          <h2>Source</h2>
          <dl className="facts">
            <div>
              <dt>File</dt>
              <dd>{openedFile?.name ?? "No file opened"}</dd>
            </div>
            <div>
              <dt>Type</dt>
              <dd>{openedFile?.kind ?? "demo"}</dd>
            </div>
            <div>
              <dt>OMR</dt>
              <dd>{conversion?.status ?? "not started"}</dd>
            </div>
          </dl>
        </section>

        <section className="panel">
          <h2>Instrument</h2>
          <div className="segmented">
            {INSTRUMENT_PRESETS.map((preset) => (
              <button
                key={preset.id}
                className={instrumentId === preset.id ? "selected" : ""}
                onClick={() => setInstrumentId(preset.id)}
              >
                {preset.type === "guitar" ? "Guitar 6" : "Bass 4"}
              </button>
            ))}
          </div>
        </section>
      </aside>

      <section className="workspace">
        <header className="toolbar">
          <div>
            <span className="eyebrow">MVP workstation</span>
            <h1>{remapped.title}</h1>
          </div>
          <div className="toolbar-actions">
            <button onClick={() => exportView("pdf")}>
              <FileText size={17} />
              PDF
            </button>
            <button onClick={() => exportView("png")}>
              <FileImage size={17} />
              PNG
            </button>
          </div>
        </header>

        <div className="comparison-grid">
          <section className="document-pane">
            <div className="pane-heading">
              <span>Original</span>
              {openedFile && <small>{openedFile.path}</small>}
            </div>
            {openedFile ? <SourcePreview file={openedFile} /> : <EmptyPreview />}
          </section>

          <section className="score-pane">
            <div className="pane-heading">
              <span>Converted TAB</span>
              <small>auto fingering recommendation</small>
            </div>
            <TabPreview score={remapped} activeNoteId={playback.activeNoteId} />
          </section>
        </div>

        <footer className="transport">
          <button className="icon-action" onClick={playback.play} disabled={playback.playing}>
            <Play size={18} />
            Play
          </button>
          <button className="icon-action" onClick={playback.stop} disabled={!playback.playing}>
            <Pause size={18} />
            Stop
          </button>
          <span>{status}</span>
        </footer>
      </section>

      <aside className="inspector">
        <section className="panel">
          <h2>
            <SlidersHorizontal size={17} />
            Transpose
          </h2>

          <label className="field">
            <span>Interval</span>
            <select value={semitones} onChange={(event) => setSemitones(Number(event.target.value))}>
              {KEY_OPTIONS.map((option) => (
                <option key={option.label} value={option.semitones}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>

          <label className="field">
            <span>Capo</span>
            <input min={0} max={12} type="number" value={capo} onChange={(event) => setCapo(Number(event.target.value))} />
          </label>

          <button className="secondary-action" onClick={() => setSemitones(0)}>
            <RefreshCw size={16} />
            Reset interval
          </button>
        </section>

        <section className="panel">
          <h2>
            <AlertTriangle size={17} />
            Review
          </h2>
          {conversion?.diagnostics.length ? (
            <ul className="diagnostics">
              {conversion.diagnostics.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          ) : (
            <p className="muted">Open a PDF or image to run conversion diagnostics.</p>
          )}

          {warnings.length > 0 && (
            <ul className="warnings">
              {warnings.map((warning) => (
                <li key={`${warning.noteId}-${warning.message}`}>{warning.message}</li>
              ))}
            </ul>
          )}
        </section>

        <section className="panel">
          <h2>
            <Save size={17} />
            Output
          </h2>
          <button className="secondary-action" onClick={() => exportView("pdf")}>
            <Download size={16} />
            Export PDF
          </button>
          <button className="secondary-action" onClick={() => exportView("png")}>
            <Download size={16} />
            Export PNG
          </button>
        </section>
      </aside>
    </main>
  );
}

function SourcePreview({ file }: { file: OpenedScoreFile }) {
  if (file.kind === "pdf") {
    return <object className="source-frame" data={file.dataUrl} type="application/pdf" aria-label="PDF preview" />;
  }
  return <img className="source-image" src={file.dataUrl} alt="Uploaded score" />;
}

function EmptyPreview() {
  return (
    <div className="empty-preview">
      <FileText size={42} />
      <span>Open a PDF or image score</span>
    </div>
  );
}

function TabPreview({ score, activeNoteId }: { score: ScoreModel; activeNoteId?: string }) {
  const track = score.tracks[0];
  const measures = new Map<number, typeof track.notes>();
  for (const note of track.notes) {
    const items = measures.get(note.measure) ?? [];
    items.push(note);
    measures.set(note.measure, items);
  }

  return (
    <div className="tab-preview">
      {Array.from(measures.entries()).map(([measure, notes]) => (
        <div className="measure" key={measure}>
          <span className="measure-label">M{measure}</span>
          {notes.map((note) => (
            <div className={`note-chip ${activeNoteId === note.id ? "active" : ""}`} key={note.id}>
              <strong>{midiToNoteName(note.midi)}</strong>
              <span>
                {note.tab ? `S${note.tab.stringNumber} F${note.tab.fret}` : "unmapped"}
              </span>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
