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
  SlidersHorizontal,
  Wand2
} from "lucide-react";
import { useEffect, useState } from "react";
import { getInstrumentPreset, INSTRUMENT_PRESETS } from "../../shared/instruments";
import { transposeAndRemap } from "../../shared/fingering";
import { midiToNoteName } from "../../shared/pitch";
import { createEmptyScore } from "../../shared/score";
import { buildExportHtml } from "../../shared/exportDocument";
import type {
  AudiverisStatus,
  ConversionResult,
  FingeringWarning,
  LogInfo,
  OpenedScoreFile,
  ScoreModel,
  TransposeOptions
} from "../../shared/types";
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

interface ConvertedMeta {
  sourceName: string;
  instrumentName: string;
  options: TransposeOptions;
}

const EMPTY_SCORE = createEmptyScore();

export function App() {
  const [openedFile, setOpenedFile] = useState<OpenedScoreFile | undefined>();
  const [conversion, setConversion] = useState<ConversionResult | undefined>();
  const [sourceScore, setSourceScore] = useState<ScoreModel | undefined>();
  const [convertedScore, setConvertedScore] = useState<ScoreModel | undefined>();
  const [convertedMeta, setConvertedMeta] = useState<ConvertedMeta | undefined>();
  const [audiveris, setAudiveris] = useState<AudiverisStatus | undefined>();
  const [logInfo, setLogInfo] = useState<LogInfo | undefined>();
  const [installingAudiveris, setInstallingAudiveris] = useState(false);
  const [instrumentId, setInstrumentId] = useState(INSTRUMENT_PRESETS[0].id);
  const [semitones, setSemitones] = useState(0);
  const [capo, setCapo] = useState(0);
  const [status, setStatus] = useState("원본을 열고 변환 옵션을 고른 뒤 변환하기를 누르세요.");
  const [warnings, setWarnings] = useState<FingeringWarning[]>([]);

  const playback = usePlayback(convertedScore ?? EMPTY_SCORE);
  const selectedInstrument = INSTRUMENT_PRESETS.find((preset) => preset.id === instrumentId) ?? INSTRUMENT_PRESETS[0];
  const hasSourceNotes = Boolean(sourceScore?.tracks.some((track) => track.notes.length > 0));

  useEffect(() => {
    void refreshAudiverisStatus();
    void refreshLogInfo();
  }, []);

  async function refreshAudiverisStatus() {
    const next = await window.tabTransporter.getAudiverisStatus();
    setAudiveris(next);
  }

  async function refreshLogInfo() {
    const next = await window.tabTransporter.getLogInfo();
    setLogInfo(next);
  }

  async function openLogFolder() {
    const result = await window.tabTransporter.openLogFolder();
    setStatus(result.message);
  }

  async function installAudiveris() {
    setInstallingAudiveris(true);
    setStatus("Audiveris 설치 파일을 공식 GitHub 릴리스에서 내려받고 있습니다.");
    try {
      const result = await window.tabTransporter.installAudiveris();
      setAudiveris(result);
      setStatus(result.message);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Audiveris 설치 중 알 수 없는 오류가 났습니다.");
    } finally {
      setInstallingAudiveris(false);
    }
  }

  async function openFile() {
    const file = await window.tabTransporter.openScoreFile();
    if (!file) {
      return;
    }

    setOpenedFile(file);
    setStatus(`${file.name} 파일을 열었습니다. 실제 악보 분석을 시작합니다.`);
    setConversion(undefined);
    setSourceScore(undefined);
    setConvertedScore(undefined);
    setConvertedMeta(undefined);
    setWarnings([]);

    const result = await window.tabTransporter.convertScoreFile(file.path);
    setConversion(result);
    await refreshAudiverisStatus();
    await refreshLogInfo();
    if (result.score && result.score.tracks.some((track) => track.notes.length > 0)) {
      setSourceScore(result.score);
      setStatus("악보 분석이 끝났습니다. 조옮김 옵션을 고르고 변환하기를 누르세요.");
      return;
    }
    setStatus(result.message);
  }

  function convertScore() {
    if (!sourceScore || !hasSourceNotes) {
      setStatus("먼저 실제 PDF/이미지 악보를 열고 분석이 끝나야 변환할 수 있습니다.");
      return;
    }

    const options: TransposeOptions = {
      semitones,
      capo,
      instrumentPresetId: instrumentId
    };
    const result = transposeAndRemap(sourceScore, options);
    const convertedTitle = `${sourceScore.title.replace(/\.[^.]+$/, "")} 변환 결과`;
    const nextScore = {
      ...result.score,
      title: convertedTitle
    };
    setConvertedScore(nextScore);
    setWarnings(result.warnings);
    setConvertedMeta({
      sourceName: openedFile?.name ?? sourceScore.title,
      instrumentName: selectedInstrument.name,
      options
    });
    setStatus("변환이 끝났습니다. 변환된 일반 음표와 TAB 운지를 확인한 뒤 재생하거나 저장하세요.");
  }

  async function exportResult(format: "pdf" | "png") {
    if (!convertedScore || !convertedMeta) {
      setStatus("먼저 변환하기를 눌러 변환된 악보를 만들어야 저장할 수 있습니다.");
      return;
    }

    const html = buildExportHtml({
      score: convertedScore,
      sourceName: convertedMeta.sourceName,
      instrumentName: convertedMeta.instrumentName,
      transposeOptions: convertedMeta.options,
      warnings
    });
    const result = await window.tabTransporter.exportCurrentView({
      format,
      html,
      defaultFileName: `${convertedScore.title || "tabtransporter"}-변환결과.${format}`
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
              <dd>{openedFile ? SOURCE_KIND_LABEL[openedFile.kind] : "없음"}</dd>
            </div>
            <div>
              <dt>OMR</dt>
              <dd>{conversion ? CONVERSION_STATUS_LABEL[conversion.status] : "시작 전"}</dd>
            </div>
          </dl>
        </section>

        <section className="panel">
          <h2>OMR 변환기</h2>
          <p className={audiveris?.installed ? "status-ok" : "status-warn"}>
            {audiveris?.message ?? "Audiveris 상태 확인 중"}
          </p>
          {audiveris?.path && <p className="path-text">{audiveris.path}</p>}
          {!audiveris?.installed && (
            <button className="secondary-action" onClick={installAudiveris} disabled={installingAudiveris}>
              <Download size={16} />
              {installingAudiveris ? "설치 중" : "Audiveris 설치"}
            </button>
          )}
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
            <h1>{convertedScore?.title ?? sourceScore?.title ?? openedFile?.name ?? "악보 변환"}</h1>
          </div>
          <div className="toolbar-actions">
            <button onClick={() => exportResult("pdf")} disabled={!convertedScore}>
              <FileText size={17} />
              PDF 저장
            </button>
            <button onClick={() => exportResult("png")} disabled={!convertedScore}>
              <FileImage size={17} />
              PNG 저장
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
              <span>변환된 악보/TAB</span>
              <small>변환하기를 누른 뒤 저장됩니다</small>
            </div>
            {convertedScore ? (
              <TabPreview score={convertedScore} activeNoteId={playback.activeNoteId} />
            ) : (
              <PendingResult />
            )}
          </section>
        </div>

        <footer className="transport">
          <button className="icon-action" onClick={playback.play} disabled={playback.playing || !convertedScore}>
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
            변환 옵션
          </h2>

          <label className="field">
            <span>조옮김</span>
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

          <button className="convert-action" onClick={convertScore} disabled={!hasSourceNotes}>
            <Wand2 size={17} />
            변환하기
          </button>

          <button className="secondary-action" onClick={() => setSemitones(0)}>
            <RefreshCw size={16} />
            조옮김 초기화
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

          {conversion?.logPath && (
            <div className="log-summary">
              <strong>변환 로그</strong>
              <p>{conversion.logPath}</p>
              {conversion.logExcerpt?.length ? (
                <pre>{conversion.logExcerpt.join("\n")}</pre>
              ) : (
                <p className="muted">로그 파일에 자세한 실행 기록이 저장되었습니다.</p>
              )}
            </div>
          )}
        </section>

        <section className="panel">
          <h2>
            <FileText size={17} />
            로그
          </h2>
          <p className="path-text">{logInfo?.directory ?? "로그 위치 확인 중"}</p>
          <button className="secondary-action" onClick={openLogFolder}>
            <FolderOpen size={16} />
            로그 폴더 열기
          </button>
        </section>

        <section className="panel">
          <h2>
            <Save size={17} />
            결과 저장
          </h2>
          <button className="secondary-action" onClick={() => exportResult("pdf")} disabled={!convertedScore}>
            <Download size={16} />
            변환 결과 PDF 저장
          </button>
          <button className="secondary-action" onClick={() => exportResult("png")} disabled={!convertedScore}>
            <Download size={16} />
            변환 결과 PNG 저장
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

function PendingResult() {
  return (
    <div className="empty-preview">
      <Wand2 size={42} />
      <span>옵션을 고른 뒤 변환하기를 누르면 결과 악보가 여기에 나옵니다</span>
    </div>
  );
}

function TabPreview({ score, activeNoteId }: { score: ScoreModel; activeNoteId?: string }) {
  const track = score.tracks[0];
  if (!track || track.notes.length === 0) {
    return (
      <div className="empty-preview">
        <FileText size={42} />
        <span>변환된 음표가 없습니다</span>
      </div>
    );
  }

  const preset = getInstrumentPreset(track.instrumentPresetId);
  const measures = new Map<number, typeof track.notes>();
  for (const note of track.notes) {
    const items = measures.get(note.measure) ?? [];
    items.push(note);
    measures.set(note.measure, items);
  }

  return (
    <div className="tab-preview result-score" aria-label="변환된 일반 악보와 TAB">
      {Array.from(measures.entries()).map(([measure, notes]) => (
        <MeasurePreview
          key={measure}
          measure={measure}
          notes={notes}
          activeNoteId={activeNoteId}
          stringCount={preset.stringCount}
        />
      ))}
    </div>
  );
}

function MeasurePreview({
  measure,
  notes,
  activeNoteId,
  stringCount
}: {
  measure: number;
  notes: ScoreModel["tracks"][number]["notes"];
  activeNoteId?: string;
  stringCount: number;
}) {
  const measureBeats = Math.max(4, ...notes.map((note) => note.beat + note.durationBeats - 1));
  const xFor = (beat: number) => `${Math.max(7, Math.min(93, (beat / (measureBeats + 1)) * 100))}%`;
  const staffTopFor = (midi: number) => `${Math.max(14, Math.min(86, 62 - (midi - 60) * 4))}%`;
  const strings = Array.from({ length: stringCount }, (_, index) => index + 1);

  return (
    <section className="score-system">
      <div className="system-label">{measure}마디</div>
      <div className="notation-block">
        <span className="notation-label">악보</span>
        <div className="staff-lines">
          {notes.map((note, index) => (
            <span
              className={`note-head ${activeNoteId === note.id ? "active" : ""}`}
              key={`staff-${note.id}`}
              style={{ left: xFor(note.beat), top: staffTopFor(note.midi), zIndex: index + 1 }}
              title={midiToNoteName(note.midi)}
            >
              {midiToNoteName(note.midi)}
            </span>
          ))}
        </div>
      </div>
      <div className="notation-block tab-block">
        <span className="notation-label">TAB</span>
        <div className="tab-lines">
          {strings.map((stringNumber, index) => (
            <span
              className="tab-line"
              key={stringNumber}
              data-string={stringNumber}
              style={{ top: strings.length === 1 ? "50%" : `${(index / (strings.length - 1)) * 100}%` }}
            />
          ))}
          {notes.map((note, index) => (
            <span
              className={`tab-fret ${activeNoteId === note.id ? "active" : ""}`}
              key={`tab-${note.id}`}
              style={{
                left: xFor(note.beat),
                zIndex: index + 1,
                top: note.tab ? `${((note.tab.stringNumber - 1) / (strings.length - 1)) * 100}%` : "50%"
              }}
              title={note.tab ? `${note.tab.stringNumber}번줄 ${note.tab.fret}프렛` : "운지 없음"}
            >
              {note.tab ? note.tab.fret : "?"}
            </span>
          ))}
        </div>
      </div>
    </section>
  );
}
