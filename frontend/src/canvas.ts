import type { Diagram, Table, Relationship } from "./types";

const TABLE_WIDTH = 200;
const ROW_HEIGHT = 22;
const HEADER_HEIGHT = 28;

export function getFieldAnchor(
  table: Table,
  fieldIndex: number,
  side: "left" | "right" = "right",
): { x: number; y: number } {
  const x = side === "right" ? table.x + TABLE_WIDTH : table.x;
  const y = table.y + HEADER_HEIGHT + fieldIndex * ROW_HEIGHT + ROW_HEIGHT / 2;
  return { x, y };
}

function getSingleRelationshipPath(
  d: Diagram,
  sourceTableId: string,
  sourceFieldId: string,
  targetTableId: string,
  targetFieldId: string,
): string {
  const srcT = d.tables.find((t) => t.id === sourceTableId);
  const tgtT = d.tables.find((t) => t.id === targetTableId);
  if (!srcT || !tgtT) return "";
  const srcFi = srcT.fields.findIndex((f) => f.id === sourceFieldId);
  const tgtFi = tgtT.fields.findIndex((f) => f.id === targetFieldId);
  if (srcFi < 0 || tgtFi < 0) return "";
  const src = getFieldAnchor(srcT, srcFi, "right");
  const tgt = getFieldAnchor(tgtT, tgtFi, "left");
  const midX = (src.x + tgt.x) / 2;
  return `M ${src.x} ${src.y} C ${midX} ${src.y}, ${midX} ${tgt.y}, ${tgt.x} ${tgt.y}`;
}

export function getRelationshipPaths(d: Diagram, r: Relationship): string[] {
  if (r.sourceFieldIds?.length && r.targetFieldIds?.length) {
    const n = Math.min(r.sourceFieldIds.length, r.targetFieldIds.length);
    const paths: string[] = [];
    for (let i = 0; i < n; i++) {
      paths.push(
        getSingleRelationshipPath(
          d,
          r.sourceTableId,
          r.sourceFieldIds[i],
          r.targetTableId,
          r.targetFieldIds[i],
        ),
      );
    }
    return paths;
  }
  const single = getSingleRelationshipPath(
    d,
    r.sourceTableId,
    r.sourceFieldId,
    r.targetTableId,
    r.targetFieldId,
  );
  return single ? [single] : [];
}

export { TABLE_WIDTH, ROW_HEIGHT, HEADER_HEIGHT };
