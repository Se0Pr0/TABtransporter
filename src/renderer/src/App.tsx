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
  { label: "원본", semitones: 0 },
  { label: "반음 +1", semitones: 1 },
  { label: "반음 +2", semitones: 2 },
  { label: "반음 +3", semitones: 3 },
  { label: "반음 +4", semitones: 4 },
  { label: "반음 +5", semitones: 5 },
  { label: "반음 -1", semitones: -1 },
  { label: "반음 -2", semitones: -2 },
  { label: "반음 -3", semitones: -3 },
  { label: "반음 -4", semitones: -4 },
  { label: "반음 -5", semitones: -5 }
];

const SOURCE_KIND_LABEL = {
  pdf: "PDF",
  image: "이미지"
} as const;

const CONVERSION_STATUS_LABEL = {
  converted: "변환 완료",
  needs_converter: "변환기 필요",
  failed: "변환 실패"
} as const;

export function App() {
  const [openedFile, setOpenedFile] = useState<OpenedScoreFile | undefined>();
  const [conversion, setConversion] = useState<ConversionResult | undefined>();
  const [sourceScore, setSourceScore] = useState<ScoreModel>(() => createDemoScore());
  const [instrumentId, setInstrumentId] = useState(INSTRUMENT_PRESETS[0].id);
  const [semitones, setSemitones] = useState(0);
  const [capo, setCapo] = useState(0);
  const [status, setStatus] = useState("준비 완료");
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
    setStatus(`${file.name} 파일을 열었습니다.`);
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
      defaultFileName: `${remapped.title || "tabtransporter"}-조옮김.${format}`
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
            <span>악보를 연주 가능한 TAB으로</span>
          </div>
        </div>

        <button className="primary-action" onClick={openFile}>
          <FolderOpen size={18} />
          PDF/이미지 열기
        </button>

        <section className="panel">
          <h2>원본</h2>
          <dl className="facts">
            <div>
              <dt>파일</dt>
              <dd>{openedFile?.name ?? "아직 연 파일이 없습니다"}</dd>
            </div>
            <div>
              <dt>형식</dt>
              <dd>{openedFile ? SOURCE_KIND_LABEL[openedFile.kind] : "예제"}</dd>
            </div>
            <div>
              <dt>OMR</dt>
              <dd>{conversion ? CONVERSION_STATUS_LABEL[conversion.status] : "시작 전"}</dd>
            </div>
          </dl>
        </section>

        <section className="panel">
          <h2>악기</h2>
          <div className="segmented">
            {INSTRUMENT_PRESETS.map((preset) => (
              <button
                key={preset.id}
                className={instrumentId === preset.id ? "selected" : ""}
                onClick={() => setInstrumentId(preset.id)}
              >
                {preset.type === "guitar" ? "6현 기타" : "4현 베이스"}
              </button>
            ))}
          </div>
        </section>
      </aside>

      <section className="workspace">
        <header className="toolbar">
          <div>
            <span className="eyebrow">작업 화면</span>
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
              <span>원본 악보</span>
              {openedFile && <small>{openedFile.path}</small>}
            </div>
            {openedFile ? <SourcePreview file={openedFile} /> : <EmptyPreview />}
          </section>

          <section className="score-pane">
            <div className="pane-heading">
              <span>변환된 TAB</span>
              <small>자동 운지 추천</small>
            </div>
            <TabPreview score={remapped} activeNoteId={playback.activeNoteId} />
          </section>
        </div>

        <footer className="transport">
          <button className="icon-action" onClick={playback.play} disabled={playback.playing}>
            <Play size={18} />
            재생
          </button>
          <button className="icon-action" onClick={playback.stop} disabled={!playback.playing}>
            <Pause size={18} />
            정지
          </button>
          <span>{status}</span>
        </footer>
      </section>

      <aside className="inspector">
        <section className="panel">
          <h2>
            <SlidersHorizontal size={17} />
            조옮김
          </h2>

          <label className="field">
            <span>이동 간격</span>
            <select value={semitones} onChange={(event) => setSemitones(Number(event.target.value))}>
              {KEY_OPTIONS.map((option) => (
                <option key={option.label} value={option.semitones}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>

          <label className="field">
            <span>카포</span>
            <input min={0} max={12} type="number" value={capo} onChange={(event) => setCapo(Number(event.target.value))} />
          </label>

          <button className="secondary-action" onClick={() => setSemitones(0)}>
            <RefreshCw size={16} />
            간격 초기화
          </button>
        </section>

        <section className="panel">
          <h2>
            <AlertTriangle size={17} />
            확인할 것
          </h2>
          {conversion?.diagnostics.length ? (
            <ul className="diagnostics">
              {conversion.diagnostics.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          ) : (
            <p className="muted">PDF나 이미지를 열면 변환 상태가 여기에 표시됩니다.</p>
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
            내보내기
          </h2>
          <button className="secondary-action" onClick={() => exportView("pdf")}>
            <Download size={16} />
            PDF 저장
          </button>
          <button className="secondary-action" onClick={() => exportView("png")}>
            <Download size={16} />
            PNG 저장
          </button>
        </section>
      </aside>
    </main>
  );
}

function SourcePreview({ file }: { file: OpenedScoreFile }) {
  if (file.kind === "pdf") {
    return <object className="source-frame" data={file.dataUrl} type="application/pdf" aria-label="PDF 미리보기" />;
  }
  return <img className="source-image" src={file.dataUrl} alt="업로드한 악보" />;
}

function EmptyPreview() {
  return (
    <div className="empty-preview">
      <FileText size={42} />
      <span>PDF 또는 이미지 악보를 열어주세요</span>
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
          <span className="measure-label">{measure}마디</span>
          {notes.map((note) => (
            <div className={`note-chip ${activeNoteId === note.id ? "active" : ""}`} key={note.id}>
              <strong>{midiToNoteName(note.midi)}</strong>
              <span>
                {note.tab ? `${note.tab.stringNumber}번줄 ${note.tab.fret}프렛` : "운지 없음"}
              </span>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
