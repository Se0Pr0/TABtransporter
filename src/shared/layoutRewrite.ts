import type { NoteEvent, ScoreLayoutPage } from "./types";
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
  const points = pageNotes.flatMap((note): SourcePoint[] => {
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
      noteMaskWidth: clamp(Math.max(source.width * 2.8, semitonePx * 3.2), 20, 46),
      noteMaskHeight: clamp(semitonePx * 7.5, 38, 78),
      noteWidth: clamp(Math.max(source.width * 1.15, semitonePx * 1.2), 9, 17),
      noteHeight: clamp(Math.max(source.height * 0.95, semitonePx * 0.82), 7, 13),
      stemHeight: clamp(semitonePx * 4.7, 24, 46),
      tabLeftPercent: tabY === undefined ? undefined : (point.centerX / pageWidth) * 100,
      tabTopPercent: tabY === undefined ? undefined : (tabY / pageHeight) * 100,
      tabValue,
      tabTitle: point.note.tab ? `${point.note.tab.stringNumber}번줄 ${point.note.tab.fret}프렛` : undefined,
      tabMaskWidth: tabValue ? clamp(tabValue.length * 9 + 10, 18, 38) : undefined,
      tabMaskHeight: tabValue ? clamp(tabLineGap * 1.35, 13, 26) : undefined,
      tabFontSize: tabValue ? clamp(tabLineGap * 0.78, 9, 14) : undefined
    };
  });
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
