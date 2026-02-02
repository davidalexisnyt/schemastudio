import type { Table, Relationship } from "./types";
import { getTableWidth, getTableHeight } from "./canvas";

const DEFAULT_ITERATIONS = 120;
const DAMPING = 0.85;
const REPULSION_STRENGTH = 8000;
const ATTRACTION_STRENGTH = 0.08;
const CENTER_STRENGTH = 0.002;
const MIN_DISTANCE = 4;

type Node = {
  id: string;
  cx: number;
  cy: number;
  w: number;
  h: number;
  vx: number;
  vy: number;
};

type Edge = { sourceIndex: number; targetIndex: number };

/**
 * Force-directed layout: tables as nodes (center + size), relationships as edges.
 * Repulsion between all nodes, attraction along edges, weak centering.
 * Returns new top-left positions (x, y) keyed by table id.
 */
export function runForceDirectedLayout(
  tables: Table[],
  relationships: Relationship[]
): Map<string, { x: number; y: number }> {
  const result = new Map<string, { x: number; y: number }>();
  if (tables.length === 0) return result;
  if (tables.length === 1) {
    result.set(tables[0].id, { x: tables[0].x, y: tables[0].y });
    return result;
  }

  const idToIndex = new Map<string, number>();
  const nodes: Node[] = tables.map((t, i) => {
    idToIndex.set(t.id, i);
    const w = getTableWidth(t);
    const h = getTableHeight(t);
    const cx = t.x + w / 2;
    const cy = t.y + h / 2;
    return {
      id: t.id,
      cx,
      cy,
      w,
      h,
      vx: 0,
      vy: 0,
    };
  });

  const edges: Edge[] = [];
  for (const r of relationships) {
    const si = idToIndex.get(r.sourceTableId);
    const ti = idToIndex.get(r.targetTableId);
    if (si !== undefined && ti !== undefined && si !== ti) {
      edges.push({ sourceIndex: si, targetIndex: ti });
    }
  }

  const n = nodes.length;
  const centerX = nodes.reduce((s, nd) => s + nd.cx, 0) / n;
  const centerY = nodes.reduce((s, nd) => s + nd.cy, 0) / n;

  for (let iter = 0; iter < DEFAULT_ITERATIONS; iter++) {
    const fx = new Float64Array(n);
    const fy = new Float64Array(n);

    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const a = nodes[i];
        const b = nodes[j];
        const dx = a.cx - b.cx;
        const dy = a.cy - b.cy;
        const dist = Math.sqrt(dx * dx + dy * dy) || MIN_DISTANCE;
        const repulsion = REPULSION_STRENGTH / (dist * dist);
        const ux = dx / dist;
        const uy = dy / dist;
        fx[i] += ux * repulsion;
        fy[i] += uy * repulsion;
        fx[j] -= ux * repulsion;
        fy[j] -= uy * repulsion;
      }
    }

    for (const e of edges) {
      const a = nodes[e.sourceIndex];
      const b = nodes[e.targetIndex];
      const dx = b.cx - a.cx;
      const dy = b.cy - a.cy;
      const dist = Math.sqrt(dx * dx + dy * dy) || MIN_DISTANCE;
      const attraction = ATTRACTION_STRENGTH * dist;
      const ux = dx / dist;
      const uy = dy / dist;
      fx[e.sourceIndex] += ux * attraction;
      fy[e.sourceIndex] += uy * attraction;
      fx[e.targetIndex] -= ux * attraction;
      fy[e.targetIndex] -= uy * attraction;
    }

    for (let i = 0; i < n; i++) {
      const nd = nodes[i];
      fx[i] += (centerX - nd.cx) * CENTER_STRENGTH;
      fy[i] += (centerY - nd.cy) * CENTER_STRENGTH;
    }

    for (let i = 0; i < n; i++) {
      const nd = nodes[i];
      nd.vx = (nd.vx + fx[i]) * DAMPING;
      nd.vy = (nd.vy + fy[i]) * DAMPING;
      nd.cx += nd.vx;
      nd.cy += nd.vy;
    }
  }

  for (const nd of nodes) {
    result.set(nd.id, {
      x: nd.cx - nd.w / 2,
      y: nd.cy - nd.h / 2,
    });
  }
  return result;
}
