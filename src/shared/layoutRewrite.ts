import type { ChordSymbol, NoteEvent, ScoreLayoutPage } from "./types";
import { midiToNoteName } from "./pitch";

export interface LayoutRewritePlacement {
  noteId: string;
  noteTitle: string;
  noteLeftPercent: number;
  sourceTopPercent: number;
  rewrittenTopPercent: number;
  noteMaskWidth: number;
  noteMaskHeight: number;
  noteWidth: number;
  noteHeight: number;
  stemHeight: number;
  tabLeftPercent?: number;
  tabTopPercent?: number;
  tabValue?: string;
  tabTitle?: string;
  tabMaskWidth?: number;
  tabMaskHeight?: number;
  tabFontSize?: number;
}

export interface LayoutChordRewritePlacement {
  chordId: string;
  text: string;
  leftPercent: number;
  topPercent: number;
  maskWidth: number;
  maskHeight: number;
  fontSize: number;
}

export interface LayoutSystemRewriteRegion {
  regionId: string;
  leftPercent: number;
  widthPercent: number;
  staffTopPercent: number;
  staffHeightPercent: number;
  staffLineTopPercents: number[];
  tabTopPercent?: number;
  tabHeightPercent?: number;
  tabLineTopPercents?: number[];
}

interface SourcePoint {
  note: NoteEvent;
  centerX: number;
  centerY: number;
  midi: number;
  staff: number;
}

interface SourceCluster {
  staff: number;
  points: SourcePoint[];
  centerY: number;
  semitonePx: number;
  tabOffset: number;
  tabLineGap: number;
}

const DEFAULT_SEMITONE_PX = 7.5;
const SYSTEM_CLUSTER_THRESHOLD = 150;

export function buildLayoutRewritePlacements(notes: NoteEvent[], page: ScoreLayoutPage): LayoutRewritePlacement[] {
  const pageNotes = notes.filter((note) => note.originalSource?.page === page.page);
  const points = buildSourcePoints(pageNotes);
  const clusters = buildSourceClusters(points, page.height);
  const clusterByNoteId = new Map<string, SourceCluster>();
  for (const cluster of clusters) {
    for (const point of cluster.points) {
      clusterByNoteId.set(point.note.id, cluster);
    }
  }

  return points.map((point) => {
    const source = point.note.originalSource!;
    const cluster = clusterByNoteId.get(point.note.id);
    const semitonePx = cluster?.semitonePx ?? DEFAULT_SEMITONE_PX;
    const tabLineGap = cluster?.tabLineGap ?? clamp(semitonePx * 1.75, 8, 18);
    const midiDelta = point.note.midi - point.midi;
    const rewrittenY = point.centerY - midiDelta * semitonePx;
    const pageWidth = source.pageWidth ?? page.width;
    const pageHeight = source.pageHeight ?? page.height;
    const tabY =
      point.note.tab && cluster
        ? point.centerY + cluster.tabOffset + (point.note.tab.stringNumber - 1) * tabLineGap
        : undefined;
    const tabValue = point.note.tab ? String(point.note.tab.fret) : undefined;

    return {
      noteId: point.note.id,
      noteTitle: midiToNoteName(point.note.midi),
      noteLeftPercent: (point.centerX / pageWidth) * 100,
      sourceTopPercent: (point.centerY / pageHeight) * 100,
      rewrittenTopPercent: (rewrittenY / pageHeight) * 100,
      noteMaskWidth: clamp(Math.max(source.width * 3.7, semitonePx * 4.1), 26, 58),
      noteMaskHeight: clamp(semitonePx * 8.6, 46, 92),
      noteWidth: clamp(Math.max(source.width * 1.15, semitonePx * 1.2), 9, 17),
      noteHeight: clamp(Math.max(source.height * 0.95, semitonePx * 0.82), 7, 13),
      stemHeight: clamp(semitonePx * 4.7, 24, 46),
      tabLeftPercent: tabY === undefined ? undefined : (point.centerX / pageWidth) * 100,
      tabTopPercent: tabY === undefined ? undefined : (tabY / pageHeight) * 100,
      tabValue,
      tabTitle: point.note.tab ? `${point.note.tab.stringNumber}번줄 ${point.note.tab.fret}프렛` : undefined,
      tabMaskWidth: tabValue ? clamp(tabValue.length * 10 + 16, 24, 48) : undefined,
      tabMaskHeight: tabValue ? clamp(tabLineGap * 1.7, 16, 31) : undefined,
      tabFontSize: tabValue ? clamp(tabLineGap * 0.78, 9, 14) : undefined
    };
  });
}

export function buildLayoutSystemRewriteRegions(
  notes: NoteEvent[],
  page: ScoreLayoutPage,
  stringCount: number
): LayoutSystemRewriteRegion[] {
  const pageNotes = notes.filter((note) => note.originalSource?.page === page.page);
  const points = buildSourcePoints(pageNotes);
  const clusters = buildSourceClusters(points, page.height);

  return clusters.map((cluster, index) => {
    const pageWidth = page.width;
    const pageHeight = page.height;
    const minX = Math.min(...cluster.points.map((point) => point.centerX));
    const maxX = Math.max(...cluster.points.map((point) => point.centerX));
    const left = clamp(minX - cluster.semitonePx * 3.5, 0, pageWidth);
    const right = clamp(maxX + cluster.semitonePx * 4.8, left + 1, pageWidth);
    const staffFirstLine = cluster.centerY - cluster.semitonePx * 4;
    const staffLineGap = cluster.semitonePx * 2;
    const staffTop = clamp(staffFirstLine - cluster.semitonePx * 3.2, 0, pageHeight);
    const staffBottom = clamp(staffFirstLine + staffLineGap * 4 + cluster.semitonePx * 3.2, staffTop + 1, pageHeight);
    const tabFirstLine = cluster.centerY + cluster.tabOffset;
    const tabLineGap = cluster.tabLineGap;
    const tabLines = Array.from({ length: Math.max(1, stringCount) }, (_, line) => tabFirstLine + line * tabLineGap);
    const tabTop = clamp(tabLines[0] - tabLineGap * 0.75, 0, pageHeight);
    const tabBottom = clamp(tabLines.at(-1)! + tabLineGap * 0.75, tabTop + 1, pageHeight);

    return {
      regionId: `${page.page}-${cluster.staff}-${index}`,
      leftPercent: (left / pageWidth) * 100,
      widthPercent: ((right - left) / pageWidth) * 100,
      staffTopPercent: (staffTop / pageHeight) * 100,
      staffHeightPercent: ((staffBottom - staffTop) / pageHeight) * 100,
      staffLineTopPercents: Array.from({ length: 5 }, (_, line) => ((staffFirstLine + line * staffLineGap) / pageHeight) * 100),
      tabTopPercent: (tabTop / pageHeight) * 100,
      tabHeightPercent: ((tabBottom - tabTop) / pageHeight) * 100,
      tabLineTopPercents: tabLines.map((lineY) => (lineY / pageHeight) * 100)
    };
  });
}

export function buildLayoutChordRewritePlacements(
  chords: ChordSymbol[],
  notes: NoteEvent[],
  page: ScoreLayoutPage
): LayoutChordRewritePlacement[] {
  const pageNotes = notes.filter((note) => note.originalSource?.page === page.page);
  if (!pageNotes.length || !chords.length) {
    return [];
  }

  const points = buildSourcePoints(pageNotes);
  const clusters = buildSourceClusters(points, page.height);
  const clusterByNoteId = new Map<string, SourceCluster>();
  for (const cluster of clusters) {
    for (const point of cluster.points) {
      clusterByNoteId.set(point.note.id, cluster);
    }
  }

  return chords
    .map((chord): LayoutChordRewritePlacement | undefined => {
      const anchor = findChordAnchor(chord, pageNotes);
      if (!anchor?.originalSource) {
        return undefined;
      }
      const source = chord.originalSource ?? anchor.originalSource;
      if (source.page !== page.page) {
        return undefined;
      }
      const cluster = clusterByNoteId.get(anchor.id);
      const semitonePx = cluster?.semitonePx ?? DEFAULT_SEMITONE_PX;
      const pageWidth = source.pageWidth ?? page.width;
      const pageHeight = source.pageHeight ?? page.height;
      const centerX = source.x + source.width / 2;
      const sourceCenterY = source.y + source.height / 2;
      const y = chord.originalSource
        ? sourceCenterY
        : (cluster?.centerY ?? sourceCenterY) - clamp(semitonePx * 7.8, 42, 72);
      const width = Math.max(chord.originalText?.length ?? 0, chord.text.length) * 8 + 18;

      return {
        chordId: chord.id,
        text: chord.text,
        leftPercent: (centerX / pageWidth) * 100,
        topPercent: (y / pageHeight) * 100,
        maskWidth: clamp(width, 28, 92),
        maskHeight: clamp(semitonePx * 2.7, 18, 34),
        fontSize: clamp(semitonePx * 1.45, 10, 15)
      };
    })
    .filter((placement): placement is LayoutChordRewritePlacement => Boolean(placement));
}

function buildSourceClusters(points: SourcePoint[], pageHeight: number): SourceCluster[] {
  const clusters: SourceCluster[] = [];
  const byStaff = new Map<number, SourcePoint[]>();
  for (const point of points) {
    const items = byStaff.get(point.staff) ?? [];
    items.push(point);
    byStaff.set(point.staff, items);
  }

  for (const [staff, staffPoints] of byStaff.entries()) {
    const sorted = [...staffPoints].sort((a, b) => a.centerY - b.centerY);
    const staffClusters: SourceCluster[] = [];
    for (const point of sorted) {
      const nearest = nearestCluster(staffClusters, point.centerY);
      if (nearest && Math.abs(nearest.centerY - point.centerY) <= SYSTEM_CLUSTER_THRESHOLD) {
        nearest.points.push(point);
        nearest.centerY = median(nearest.points.map((item) => item.centerY));
      } else {
        staffClusters.push({
          staff,
          points: [point],
          centerY: point.centerY,
          semitonePx: DEFAULT_SEMITONE_PX,
          tabOffset: 76,
          tabLineGap: 13
        });
      }
    }
    clusters.push(...staffClusters);
  }

  const sortedClusters = clusters.sort((a, b) => a.centerY - b.centerY);
  const pageGaps = sortedClusters
    .map((cluster, index) => sortedClusters[index + 1]?.centerY - cluster.centerY)
    .filter((gap): gap is number => Number.isFinite(gap) && gap > 120);
  const fallbackGap = median(pageGaps) || pageHeight * 0.16;

  for (const cluster of sortedClusters) {
    const semitonePx = estimateSemitonePixels(cluster.points);
    const next = sortedClusters.find((candidate) => candidate.centerY > cluster.centerY + 120);
    const systemGap = next ? next.centerY - cluster.centerY : fallbackGap;
    cluster.semitonePx = semitonePx;
    cluster.tabOffset = clamp(systemGap * 0.31, semitonePx * 6.5, semitonePx * 16);
    cluster.tabLineGap = clamp(semitonePx * 1.75, 8, 18);
  }

  return sortedClusters;
}

function nearestCluster(clusters: SourceCluster[], y: number): SourceCluster | undefined {
  let nearest: SourceCluster | undefined;
  let distance = Number.POSITIVE_INFINITY;
  for (const cluster of clusters) {
    const nextDistance = Math.abs(cluster.centerY - y);
    if (nextDistance < distance) {
      nearest = cluster;
      distance = nextDistance;
    }
  }
  return nearest;
}

function findChordAnchor(chord: ChordSymbol, notes: NoteEvent[]): NoteEvent | undefined {
  const sameMeasure = notes.filter((note) => note.measure === chord.measure);
  const candidates = sameMeasure.length ? sameMeasure : notes;
  return candidates
    .filter((note) => note.originalSource)
    .sort((a, b) => Math.abs(a.beat - chord.beat) - Math.abs(b.beat - chord.beat) || a.beat - b.beat)[0];
}

function buildSourcePoints(notes: NoteEvent[]): SourcePoint[] {
  return notes.flatMap((note): SourcePoint[] => {
    const source = note.originalSource;
    if (!source) {
      return [];
    }
    return [
      {
        note,
        centerX: source.x + source.width / 2,
        centerY: source.y + source.height / 2,
        midi: note.originalMidi ?? note.midi,
        staff: source.staff ?? 0
      }
    ];
  });
}

function estimateSemitonePixels(points: SourcePoint[]): number {
  const ratios: number[] = [];
  for (let i = 0; i < points.length; i += 1) {
    for (let j = i + 1; j < points.length; j += 1) {
      const midiDelta = points[i].midi - points[j].midi;
      const yDelta = points[i].centerY - points[j].centerY;
      if (Math.abs(midiDelta) < 1 || Math.abs(midiDelta) > 24 || Math.abs(yDelta) < 1) {
        continue;
      }
      const ratio = -yDelta / midiDelta;
      if (ratio >= 2 && ratio <= 16) {
        ratios.push(ratio);
      }
    }
  }

  return clamp(median(ratios) || DEFAULT_SEMITONE_PX, 3, 14);
}

function median(values: number[]): number {
  if (!values.length) {
    return 0;
  }
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) {
    return sorted[middle];
  }
  return (sorted[middle - 1] + sorted[middle]) / 2;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
