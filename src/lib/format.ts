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

/**
 * Fold the citation markers a model actually writes into the one form the
 * app understands: `[1]`, `[2]`.
 *
 * `gpt-oss` and some other models reach for CJK/full-width brackets —
 * `【1】`, `〔1〕`, `⟦1⟧`, `［1］` — or double square brackets, and a few emit a
 * bracketed list like `[1, 2]`. The retrieval-side resolver only matches
 * ASCII `[n]`, so without this every such citation is silently dropped and
 * the answer renders with no citation strip. Applied to the answer text
 * before it is resolved, streamed to the client and persisted, so the inline
 * markers and the citation chips always agree.
 */
export const normalizeCitationMarkers = (text: string): string => {
  return text
    .replace(/[【〔⟦［]\s*(\d{1,2}(?:\s*[,、]\s*\d{1,2})*)\s*[】〕⟧］]/g, "[$1]")
    .replace(/\[\[\s*(\d{1,2})\s*\]\]/g, "[$1]")
    .replace(/\[\s*(\d{1,2})(?:\s*[,、]\s*(\d{1,2}))+\s*\]/g, (match) => {
      const numbers = match.match(/\d{1,2}/g) ?? [];
      return numbers.map((n) => `[${n}]`).join("");
    });
};

/**
 * A message's time for the thread: "2:34 PM" when it is from today, otherwise
 * "24 Aug, 2:34 PM". Locale- and timezone-aware; only ever rendered client
 * side, so there is no hydration concern.
 */
export const formatMessageTime = (iso: string): string => {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";

  const now = new Date();
  const sameDay =
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate();

  const time = date.toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
  if (sameDay) return time;

  const day = date.toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
  });
  return `${day}, ${time}`;
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
