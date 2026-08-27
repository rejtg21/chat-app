import type { ChunkRecord, DocumentKind, DocumentSummary } from "./types";

/** Display label for a stored document kind. */
export function kindLabel(kind: DocumentKind): string {
  switch (kind) {
    case "pdf":
      return "PDF";
    case "txt":
      return "Plain text";
    case "md":
      return "Markdown";
  }
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${Math.max(1, Math.round(kb))} KB`;
  return `${(kb / 1024).toFixed(1)} MB`;
}

export function pluralise(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

/** "Markdown · 42 KB · 9 chunks" — the document bar and outline header. */
export function documentMeta(document: DocumentSummary): string {
  return [
    kindLabel(document.kind),
    formatBytes(document.sizeBytes),
    pluralise(document.chunkCount, "chunk"),
  ].join(" · ");
}

/** "chunk_04" from a zero-based ordinal. */
export function chunkLabel(ordinal: number): string {
  return `chunk_${String(ordinal + 1).padStart(2, "0")}`;
}

/**
 * The location half of a citation: "§3 Engagement by format · L44–52", or
 * "§2 Methods · p.4" for a PDF. Built only from stored columns, never from
 * anything the model produced.
 */
export function chunkWhere(chunk: {
  sectionOrdinal: number;
  sectionLabel: string;
  page: number | null;
  lineStart: number | null;
  lineEnd: number | null;
}): string {
  const section = chunk.sectionLabel
    ? `§${chunk.sectionOrdinal} ${chunk.sectionLabel}`
    : `§${chunk.sectionOrdinal}`;
  const locus =
    chunk.page !== null
      ? `p.${chunk.page}`
      : chunk.lineStart !== null && chunk.lineEnd !== null
        ? `L${chunk.lineStart}–${chunk.lineEnd}`
        : null;
  return locus ? `${section} · ${locus}` : section;
}

/** "report.md · §3 Engagement by format · L44–52" */
export function citationWhere(filename: string, chunk: ChunkRecord): string {
  return `${filename} · ${chunk.where}`;
}

/** "vector[384] · 142 tokens" — the chunk card footer. */
export function vectorLine(dimensions: number, tokenCount: number): string {
  return `vector[${dimensions}] · ${pluralise(tokenCount, "token")}`;
}

/** "3 chunks retrieved · cosine 0.71–0.91", or the not-found variant. */
export function retrievalLabel(meta: {
  retrieved: number;
  minScore: number | null;
  maxScore: number | null;
  notFound: boolean;
}): string {
  if (meta.notFound || meta.retrieved === 0) return "no passage above threshold";
  const range =
    meta.minScore !== null && meta.maxScore !== null
      ? ` · cosine ${meta.minScore.toFixed(2)}–${meta.maxScore.toFixed(2)}`
      : "";
  return `${pluralise(meta.retrieved, "chunk")} retrieved${range}`;
}
