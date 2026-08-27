import { z } from "zod";
import type { RenderablePayload } from "./structured";

/**
 * Application-level shapes. These mirror db/migrations/0001_init.sql — when a
 * column changes there, it changes here.
 */

export type DocumentStatus = "parsing" | "ready" | "failed";
/** Stored form. `kindLabel()` in ./format turns it into display copy. */
export type DocumentKind = "pdf" | "txt" | "md";

export interface DocumentSummary {
  id: string;
  filename: string;
  kind: DocumentKind;
  mimeType: string;
  sizeBytes: number;
  /** Set for PDFs; null for text. */
  pageCount: number | null;
  /** Set for TXT/MD; null for PDF. */
  lineCount: number | null;
  chunkCount: number;
  status: DocumentStatus;
  createdAt: string;
}

export interface ChunkRecord {
  id: string;
  documentId: string;
  ordinal: number;
  /** "chunk_04" — derived from ordinal, shown in the source pane. */
  label: string;
  sectionOrdinal: number;
  sectionLabel: string;
  page: number | null;
  lineStart: number | null;
  lineEnd: number | null;
  tokenCount: number;
  text: string;
  /** "§3 Engagement by format · L44–52" — precomputed for display. */
  where: string;
}

export interface OutlineSection {
  ordinal: number;
  title: string;
  /** "L1–12" for text, "p.3–4" for a PDF. */
  range: string;
  chunkCount: number;
  firstChunkId: string | null;
}

/**
 * A citation is always resolved from the database. The model contributes only
 * the marker number, which indexes into the numbered sources it was shown;
 * the filename, section, line range and excerpt are read from the chunk row.
 * The model never writes a location.
 */
export const citationSchema = z.object({
  n: z.number().int().positive(),
  chunkId: z.string(),
  /** "report.md · §3 Engagement by format · L44–52" */
  where: z.string(),
  excerpt: z.string(),
});
export type Citation = z.infer<typeof citationSchema>;

/** Drives the "3 chunks retrieved · cosine 0.71–0.91" meta label. */
export const retrievalMetaSchema = z.object({
  retrieved: z.number().int().nonnegative(),
  searched: z.number().int().nonnegative(),
  minScore: z.number().nullable(),
  maxScore: z.number().nullable(),
  /** True when nothing cleared SIMILARITY_THRESHOLD. */
  notFound: z.boolean(),
});
export type RetrievalMeta = z.infer<typeof retrievalMetaSchema>;

/** Per-message user state that has to survive a reload. */
export const messageUiStateSchema = z.object({
  /** Checklist ticks, keyed by item index as a string. */
  checked: z.record(z.string(), z.boolean()).default({}),
  /** Expanded evidence cards, keyed by card index as a string. */
  expanded: z.record(z.string(), z.boolean()).default({}),
});
export type MessageUiState = z.infer<typeof messageUiStateSchema>;

export const EMPTY_UI_STATE: MessageUiState = { checked: {}, expanded: {} };

export interface StoredMessage {
  id: string;
  /**
   * `system` is the app speaking for itself — an error it wants the reader to
   * see after the fact. It carries only `content`; the citation/retrieval/
   * structured fields are always empty.
   */
  role: "user" | "assistant" | "system";
  content: string;
  structured: RenderablePayload | null;
  citations: Citation[];
  retrieval: RetrievalMeta | null;
  uiState: MessageUiState;
}

export interface SessionPayload {
  document: DocumentSummary | null;
  chunks: ChunkRecord[];
  outline: OutlineSection[];
  chatId: string | null;
  messages: StoredMessage[];
}

/**
 * An error shaped for one of the designed error cards. `kind` is the card's
 * uppercase label, `code` the small monospace line beneath the message.
 */
export interface AppError {
  kind: string;
  message: string;
  code: string;
}

/** The five stages the right pane reports while a document is indexed. */
export const INDEXING_STAGES = [
  "Uploading file",
  "Extracting text",
  "Chunking",
  "Embedding",
  "Writing to Neon",
] as const;
export type IndexingStage = (typeof INDEXING_STAGES)[number];

/**
 * Newline-delimited events streamed by POST /api/documents while indexing, so
 * the five-stage progress in the right pane reflects real work rather than a
 * timer.
 */
export type IndexingEvent =
  | { type: "stage"; stage: number; label: string }
  | { type: "done"; session: SessionPayload }
  | { type: "error"; code: string; message: string; detail?: string };
