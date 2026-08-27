import type { ChunkRecord, DocumentKind, DocumentSummary } from "./types";

/** Display label for a stored document kind. */
export const kindLabel = (kind: DocumentKind): string => {
  switch (kind) {
    case "pdf":
      return "PDF";
    case "txt":
      return "Plain text";
    case "md":
      return "Markdown";
  }
};

export const formatBytes = (bytes: number): string => {
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${Math.max(1, Math.round(kb))} KB`;
  return `${(kb / 1024).toFixed(1)} MB`;
};

export const pluralise = (count: number, noun: string): string => {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
};

/** "Markdown · 42 KB · 9 excerpts" — the document bar and outline header. */
export const documentMeta = (document: DocumentSummary): string => {
  return [
    kindLabel(document.kind),
    formatBytes(document.sizeBytes),
    pluralise(document.chunkCount, "excerpt"),
  ].join(" · ");
};

/** "Excerpt 4" from a zero-based ordinal. */
export const chunkLabel = (ordinal: number): string => {
  return `Excerpt ${ordinal + 1}`;
};

/**
 * The location half of a citation: "Section 3 · Engagement by format · lines
 * 44–52", or "Section 2 · Methods · page 4" for a PDF. Built only from stored
 * columns, never from anything the model produced.
 */
export const chunkWhere = (chunk: {
  sectionOrdinal: number;
  sectionLabel: string;
  page: number | null;
  lineStart: number | null;
  lineEnd: number | null;
}): string => {
  const section = chunk.sectionLabel
    ? `Section ${chunk.sectionOrdinal} · ${chunk.sectionLabel}`
    : `Section ${chunk.sectionOrdinal}`;
  const locus =
    chunk.page !== null
      ? `page ${chunk.page}`
      : chunk.lineStart !== null && chunk.lineEnd !== null
        ? `lines ${chunk.lineStart}–${chunk.lineEnd}`
        : null;
  return locus ? `${section} · ${locus}` : section;
};

/** "report.md · §3 Engagement by format · L44–52" */
export const citationWhere = (filename: string, chunk: ChunkRecord): string => {
  return `${filename} · ${chunk.where}`;
};

/** "Based on 3 excerpts", or the not-found variant. */
export const retrievalLabel = (meta: {
  retrieved: number;
  minScore: number | null;
  maxScore: number | null;
  notFound: boolean;
}): string => {
  if (meta.notFound || meta.retrieved === 0) {
    return "Nothing in this document matched";
  }
  return `Based on ${pluralise(meta.retrieved, "excerpt")}`;
};
