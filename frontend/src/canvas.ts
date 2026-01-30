import type { Diagram, Table, Relationship } from "./types";

const TABLE_WIDTH = 200; // minimum/default width
const ROW_HEIGHT = 22;
const HEADER_HEIGHT = 28;
const ARROW_LENGTH = 14;
const ARROW_HALF_WIDTH = 8;
const TABLE_PADDING_LEFT = 10; // match text x position in app
const TABLE_PADDING_RIGHT = 10;
const TABLE_COLUMN_GAP = 12; // gap between name and type columns
const TABLE_CHAR_WIDTH = 6.5; // approximate px per character at 12px font (field text)

export type TableSide = "left" | "right" | "top" | "bottom";

function getTableHeight(table: Table): number {
  return HEADER_HEIGHT + table.fields.length * ROW_HEIGHT;
}

/** X position where the type column starts in the field table (name column | type column). */
export function getTableFieldColumnStart(table: Table): number {
  const maxNameLen = Math.max(0, ...table.fields.map((f) => f.name.length));
  return (
    TABLE_PADDING_LEFT +
    Math.ceil(maxNameLen * TABLE_CHAR_WIDTH) +
    TABLE_COLUMN_GAP
  );
}

/** Table width: at least TABLE_WIDTH, or wider if table/field names need more space. */
export function getTableWidth(table: Table): number {
  const headerWidth = table.name.length * TABLE_CHAR_WIDTH;
  const maxNameLen = Math.max(0, ...table.fields.map((f) => f.name.length));
  const maxTypeLen = Math.max(0, ...table.fields.map((f) => f.type.length));
  const nameColWidth = maxNameLen * TABLE_CHAR_WIDTH;
  const typeColWidth = maxTypeLen * TABLE_CHAR_WIDTH;
  const fieldsWidth = nameColWidth + TABLE_COLUMN_GAP + typeColWidth;
  const contentWidth = Math.max(headerWidth, fieldsWidth);
  return Math.max(
    TABLE_WIDTH,
    TABLE_PADDING_LEFT + Math.ceil(contentWidth) + TABLE_PADDING_RIGHT,
  );
}

export function getFieldAnchor(
  table: Table,
  fieldIndex: number,
  side: TableSide,
): { x: number; y: number } {
  const w = getTableWidth(table);
  const fieldY =
    table.y + HEADER_HEIGHT + fieldIndex * ROW_HEIGHT + ROW_HEIGHT / 2;
  const h = getTableHeight(table);
  const centerX = table.x + w / 2;
  const centerY = table.y + h / 2;

  switch (side) {
    case "left":
      return { x: table.x, y: fieldY };
    case "right":
      return { x: table.x + w, y: fieldY };
    case "top":
      return { x: centerX, y: table.y };
    case "bottom":
      return { x: centerX, y: table.y + h };
    default:
      return { x: table.x + w, y: fieldY };
  }
}

function getTableCenter(table: Table): { x: number; y: number } {
  const h = getTableHeight(table);
  const w = getTableWidth(table);
  return {
    x: table.x + w / 2,
    y: table.y + h / 2,
  };
}

function pickBestSide(
  fromTable: Table,
  fromFieldIndex: number,
  toCenter: { x: number; y: number },
): TableSide {
  const sides: TableSide[] = ["left", "right", "top", "bottom"];
  let best: TableSide = "right";
  let bestDist = Infinity;
  for (const side of sides) {
    const p = getFieldAnchor(fromTable, fromFieldIndex, side);
    const d =
      (p.x - toCenter.x) * (p.x - toCenter.x) +
      (p.y - toCenter.y) * (p.y - toCenter.y);
    if (d < bestDist) {
      bestDist = d;
      best = side;
    }
  }
  return best;
}

/** Anchor point for a group of fields on one side of the table (midpoint of the fields on that side). */
function getFieldGroupAnchor(
  table: Table,
  fieldIndices: number[],
  side: TableSide,
): { x: number; y: number } {
  const w = getTableWidth(table);
  const h = getTableHeight(table);
  const centerX = table.x + w / 2;
  const avgFieldY =
    fieldIndices.reduce((sum, fi) => {
      return sum + table.y + HEADER_HEIGHT + fi * ROW_HEIGHT + ROW_HEIGHT / 2;
    }, 0) / fieldIndices.length;
  switch (side) {
    case "left":
      return { x: table.x, y: avgFieldY };
    case "right":
      return { x: table.x + w, y: avgFieldY };
    case "top":
      return { x: centerX, y: table.y };
    case "bottom":
      return { x: centerX, y: table.y + h };
    default:
      return { x: table.x + w, y: avgFieldY };
  }
}

function pickBestSideForGroup(
  table: Table,
  fieldIndices: number[],
  toPoint: { x: number; y: number },
): TableSide {
  const sides: TableSide[] = ["left", "right", "top", "bottom"];
  let best: TableSide = "right";
  let bestDist = Infinity;
  for (const side of sides) {
    const p = getFieldGroupAnchor(table, fieldIndices, side);
    const d =
      (p.x - toPoint.x) * (p.x - toPoint.x) +
      (p.y - toPoint.y) * (p.y - toPoint.y);
    if (d < bestDist) {
      bestDist = d;
      best = side;
    }
  }
  return best;
}

export interface RelationshipPathResult {
  pathD: string;
  arrowheadPathD: string;
}

function getSingleRelationshipPath(
  d: Diagram,
  sourceTableId: string,
  sourceFieldId: string,
  targetTableId: string,
  targetFieldId: string,
): RelationshipPathResult | null {
  const srcT = d.tables.find((t) => t.id === sourceTableId);
  const tgtT = d.tables.find((t) => t.id === targetTableId);
  if (!srcT || !tgtT) return null;
  const srcFi = srcT.fields.findIndex((f) => f.id === sourceFieldId);
  const tgtFi = tgtT.fields.findIndex((f) => f.id === targetFieldId);
  if (srcFi < 0 || tgtFi < 0) return null;

  const tgtCenter = getTableCenter(tgtT);
  const srcCenter = getTableCenter(srcT);
  const srcSide = pickBestSide(srcT, srcFi, tgtCenter);
  const tgtSide = pickBestSide(tgtT, tgtFi, srcCenter);

  const src = getFieldAnchor(srcT, srcFi, srcSide);
  const tgt = getFieldAnchor(tgtT, tgtFi, tgtSide);

  const midX = (src.x + tgt.x) / 2;
  const midY = (src.y + tgt.y) / 2;
  const moreHorizontal = Math.abs(tgt.x - src.x) > Math.abs(tgt.y - src.y);
  const c1x = moreHorizontal ? midX : src.x;
  const c1y = moreHorizontal ? src.y : midY;
  const c2x = moreHorizontal ? midX : tgt.x;
  const c2y = moreHorizontal ? tgt.y : midY;

  const dx = tgt.x - c2x;
  const dy = tgt.y - c2y;
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len;
  const uy = dy / len;
  const baseX = tgt.x - ux * ARROW_LENGTH;
  const baseY = tgt.y - uy * ARROW_LENGTH;

  const pathD = `M ${src.x} ${src.y} C ${c1x} ${c1y}, ${c2x} ${c2y}, ${baseX} ${baseY}`;

  const angle = Math.atan2(uy, ux);
  const perpX = Math.cos(angle + Math.PI / 2);
  const perpY = Math.sin(angle + Math.PI / 2);
  const ax1 = baseX + perpX * ARROW_HALF_WIDTH;
  const ay1 = baseY + perpY * ARROW_HALF_WIDTH;
  const ax2 = baseX - perpX * ARROW_HALF_WIDTH;
  const ay2 = baseY - perpY * ARROW_HALF_WIDTH;
  const arrowheadPathD = `M ${tgt.x} ${tgt.y} L ${ax1} ${ay1} L ${ax2} ${ay2} Z`;

  return { pathD, arrowheadPathD };
}

/** Single path for a compound-key relationship (one line between tables). */
function getCompoundRelationshipPath(
  d: Diagram,
  sourceTableId: string,
  sourceFieldIds: string[],
  targetTableId: string,
  targetFieldIds: string[],
): RelationshipPathResult | null {
  const srcT = d.tables.find((t) => t.id === sourceTableId);
  const tgtT = d.tables.find((t) => t.id === targetTableId);
  if (!srcT || !tgtT) return null;
  const srcIndices = sourceFieldIds
    .map((id) => srcT.fields.findIndex((f) => f.id === id))
    .filter((i) => i >= 0);
  const tgtIndices = targetFieldIds
    .map((id) => tgtT.fields.findIndex((f) => f.id === id))
    .filter((i) => i >= 0);
  if (srcIndices.length === 0 || tgtIndices.length === 0) return null;

  const tgtCenter = getTableCenter(tgtT);
  const srcCenter = getTableCenter(srcT);
  const srcSide = pickBestSideForGroup(srcT, srcIndices, tgtCenter);
  const tgtSide = pickBestSideForGroup(tgtT, tgtIndices, srcCenter);

  const src = getFieldGroupAnchor(srcT, srcIndices, srcSide);
  const tgt = getFieldGroupAnchor(tgtT, tgtIndices, tgtSide);

  const midX = (src.x + tgt.x) / 2;
  const midY = (src.y + tgt.y) / 2;
  const moreHorizontal = Math.abs(tgt.x - src.x) > Math.abs(tgt.y - src.y);
  const c1x = moreHorizontal ? midX : src.x;
  const c1y = moreHorizontal ? src.y : midY;
  const c2x = moreHorizontal ? midX : tgt.x;
  const c2y = moreHorizontal ? tgt.y : midY;

  const dx = tgt.x - c2x;
  const dy = tgt.y - c2y;
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len;
  const uy = dy / len;
  const baseX = tgt.x - ux * ARROW_LENGTH;
  const baseY = tgt.y - uy * ARROW_LENGTH;

  const pathD = `M ${src.x} ${src.y} C ${c1x} ${c1y}, ${c2x} ${c2y}, ${baseX} ${baseY}`;

  const angle = Math.atan2(uy, ux);
  const perpX = Math.cos(angle + Math.PI / 2);
  const perpY = Math.sin(angle + Math.PI / 2);
  const ax1 = baseX + perpX * ARROW_HALF_WIDTH;
  const ay1 = baseY + perpY * ARROW_HALF_WIDTH;
  const ax2 = baseX - perpX * ARROW_HALF_WIDTH;
  const ay2 = baseY - perpY * ARROW_HALF_WIDTH;
  const arrowheadPathD = `M ${tgt.x} ${tgt.y} L ${ax1} ${ay1} L ${ax2} ${ay2} Z`;

  return { pathD, arrowheadPathD };
}

export function getRelationshipPaths(d: Diagram, r: Relationship): string[] {
  const results = getRelationshipPathData(d, r);
  return results.map((x) => x.pathD);
}

export function getRelationshipPathData(
  d: Diagram,
  r: Relationship,
): RelationshipPathResult[] {
  if (r.sourceFieldIds?.length && r.targetFieldIds?.length) {
    const p = getCompoundRelationshipPath(
      d,
      r.sourceTableId,
      r.sourceFieldIds,
      r.targetTableId,
      r.targetFieldIds,
    );
    return p ? [p] : [];
  }
  const p = getSingleRelationshipPath(
    d,
    r.sourceTableId,
    r.sourceFieldId,
    r.targetTableId,
    r.targetFieldId,
  );
  return p ? [p] : [];
}

export { TABLE_WIDTH, ROW_HEIGHT, HEADER_HEIGHT };
