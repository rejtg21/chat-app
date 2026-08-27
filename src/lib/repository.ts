import { randomUUID } from "node:crypto";
import { EMBEDDING_MODEL } from "@/lib/config";
import { execute, query, toVectorLiteral } from "@/lib/db";
import { chunkLabel, chunkWhere } from "@/lib/format";
import type { PreparedChunk } from "@/lib/chunk";
import {
  messageUiStateSchema,
  retrievalMetaSchema,
  citationSchema,
  EMPTY_UI_STATE,
  type ChunkRecord,
  type Citation,
  type DocumentKind,
  type DocumentSummary,
  type MessageUiState,
  type OutlineSection,
  type RetrievalMeta,
  type StoredMessage,
} from "@/lib/types";
import { parseRenderablePayload } from "@/lib/structured";

/**
 * Every read of a jsonb column goes through a Zod parse rather than a cast.
 * These columns are the one place where a row written by an older build can
 * carry a shape this build does not understand, and a `as` cast would let
 * that reach the renderer.
 */

/* ── documents ─────────────────────────────────────────────────────────── */

interface DocumentRow {
  id: string;
  filename: string;
  kind: DocumentKind;
  mime_type: string;
  size_bytes: number;
  page_count: number | null;
  line_count: number | null;
  chunk_count: number;
  status: "parsing" | "ready" | "failed";
  created_at: string;
}

function toDocument(row: DocumentRow): DocumentSummary {
  return {
    id: row.id,
    filename: row.filename,
    kind: row.kind,
    mimeType: row.mime_type,
    sizeBytes: Number(row.size_bytes),
    pageCount: row.page_count,
    lineCount: row.line_count,
    chunkCount: Number(row.chunk_count),
    status: row.status,
    createdAt: new Date(row.created_at).toISOString(),
  };
}

export async function createDocument(input: {
  filename: string;
  kind: DocumentKind;
  mimeType: string;
  sizeBytes: number;
}): Promise<string> {
  const id = randomUUID();
  await execute(
    `INSERT INTO documents (id, filename, kind, mime_type, size_bytes, status)
     VALUES ($1, $2, $3, $4, $5, 'parsing')`,
    [id, input.filename, input.kind, input.mimeType, input.sizeBytes],
  );
  return id;
}

export async function markDocumentReady(
  documentId: string,
  counts: { pageCount: number | null; lineCount: number | null; chunkCount: number },
): Promise<void> {
  await execute(
    `UPDATE documents
        SET status = 'ready', page_count = $2, line_count = $3, chunk_count = $4
      WHERE id = $1`,
    [documentId, counts.pageCount, counts.lineCount, counts.chunkCount],
  );
}

export async function markDocumentFailed(
  documentId: string,
  message: string,
): Promise<void> {
  await execute(
    `UPDATE documents SET status = 'failed', error_message = $2 WHERE id = $1`,
    [documentId, message],
  );
}

/**
 * The document the app is currently grounded in: the most recent one that
 * finished indexing. "Replace" simply indexes a newer document, which then
 * wins here — and brings its own chat with it.
 */
export async function getCurrentDocument(): Promise<DocumentSummary | null> {
  const rows = await query<DocumentRow>(
    `SELECT id, filename, kind, mime_type, size_bytes, page_count, line_count,
            chunk_count, status, created_at
       FROM documents
      WHERE status = 'ready'
      ORDER BY created_at DESC
      LIMIT 1`,
  );
  return rows[0] ? toDocument(rows[0]) : null;
}

export async function getDocument(id: string): Promise<DocumentSummary | null> {
  const rows = await query<DocumentRow>(
    `SELECT id, filename, kind, mime_type, size_bytes, page_count, line_count,
            chunk_count, status, created_at
       FROM documents WHERE id = $1`,
    [id],
  );
  return rows[0] ? toDocument(rows[0]) : null;
}

/* ── chunks + embeddings ───────────────────────────────────────────────── */

interface ChunkRow {
  id: string;
  document_id: string;
  ordinal: number;
  section_ordinal: number;
  section_label: string;
  page: number | null;
  line_start: number | null;
  line_end: number | null;
  token_count: number;
  text: string;
}

function toChunk(row: ChunkRow): ChunkRecord {
  const base = {
    sectionOrdinal: row.section_ordinal,
    sectionLabel: row.section_label,
    page: row.page,
    lineStart: row.line_start,
    lineEnd: row.line_end,
  };
  return {
    id: row.id,
    documentId: row.document_id,
    ordinal: row.ordinal,
    label: chunkLabel(row.ordinal),
    ...base,
    tokenCount: row.token_count,
    text: row.text,
    where: chunkWhere(base),
  };
}

/**
 * Write chunks and their vectors.
 *
 * Batched rather than row-at-a-time: the Neon HTTP driver does one round trip
 * per statement, so a 200-chunk document would otherwise be 400 round trips.
 */
export async function insertChunksWithEmbeddings(
  documentId: string,
  prepared: readonly PreparedChunk[],
  vectors: readonly number[][],
): Promise<void> {
  const BATCH = 40;

  for (let offset = 0; offset < prepared.length; offset += BATCH) {
    const slice = prepared.slice(offset, offset + BATCH);
    const ids = slice.map(() => randomUUID());

    const chunkValues: unknown[] = [];
    const chunkPlaceholders = slice.map((chunk, index) => {
      const base = index * 10;
      chunkValues.push(
        ids[index],
        documentId,
        chunk.ordinal,
        chunk.sectionOrdinal,
        chunk.sectionLabel,
        chunk.page,
        chunk.lineStart,
        chunk.lineEnd,
        chunk.tokenCount,
        chunk.text,
      );
      return `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6}, $${base + 7}, $${base + 8}, $${base + 9}, $${base + 10})`;
    });

    await execute(
      `INSERT INTO chunks (id, document_id, ordinal, section_ordinal, section_label,
                           page, line_start, line_end, token_count, text)
       VALUES ${chunkPlaceholders.join(", ")}`,
      chunkValues,
    );

    const embeddingValues: unknown[] = [];
    const embeddingPlaceholders = slice.map((_, index) => {
      const base = index * 4;
      embeddingValues.push(
        ids[index],
        documentId,
        toVectorLiteral(vectors[offset + index]),
        EMBEDDING_MODEL,
      );
      return `($${base + 1}, $${base + 2}, $${base + 3}::vector, $${base + 4})`;
    });

    await execute(
      `INSERT INTO embeddings (chunk_id, document_id, embedding, model)
       VALUES ${embeddingPlaceholders.join(", ")}`,
      embeddingValues,
    );
  }
}

export async function getChunks(documentId: string): Promise<ChunkRecord[]> {
  const rows = await query<ChunkRow>(
    `SELECT id, document_id, ordinal, section_ordinal, section_label, page,
            line_start, line_end, token_count, text
       FROM chunks WHERE document_id = $1 ORDER BY ordinal`,
    [documentId],
  );
  return rows.map(toChunk);
}

/** The Outline tab, derived from the chunks' section columns. */
export function buildOutline(chunks: readonly ChunkRecord[]): OutlineSection[] {
  const sections = new Map<number, OutlineSection>();

  for (const chunk of chunks) {
    const existing = sections.get(chunk.sectionOrdinal);
    if (existing) {
      existing.chunkCount += 1;
      existing.range = extendRange(existing.range, chunk);
      continue;
    }
    sections.set(chunk.sectionOrdinal, {
      ordinal: chunk.sectionOrdinal,
      title: chunk.sectionLabel || `Section ${chunk.sectionOrdinal}`,
      range: initialRange(chunk),
      chunkCount: 1,
      firstChunkId: chunk.id,
    });
  }

  return [...sections.values()].sort((a, b) => a.ordinal - b.ordinal);
}

function initialRange(chunk: ChunkRecord): string {
  if (chunk.page !== null) return `p.${chunk.page}`;
  if (chunk.lineStart !== null && chunk.lineEnd !== null) {
    return `L${chunk.lineStart}–${chunk.lineEnd}`;
  }
  return "";
}

function extendRange(range: string, chunk: ChunkRecord): string {
  if (chunk.page !== null) {
    const start = /^p\.(\d+)/.exec(range)?.[1];
    return start && Number(start) !== chunk.page
      ? `p.${start}–${chunk.page}`
      : range;
  }
  const match = /^L(\d+)–(\d+)$/.exec(range);
  if (!match || chunk.lineEnd === null) return range;
  return `L${match[1]}–${Math.max(Number(match[2]), chunk.lineEnd)}`;
}

/* ── chats + messages ──────────────────────────────────────────────────── */

/**
 * One chat per document. Keying the conversation on document_id is what
 * makes a browser reload restore the thread — there is no session cookie and
 * no client-side copy of the history.
 */
export async function getOrCreateChat(documentId: string): Promise<string> {
  const existing = await query<{ id: string }>(
    `SELECT id FROM chats WHERE document_id = $1`,
    [documentId],
  );
  if (existing[0]) return existing[0].id;

  const id = randomUUID();
  const created = await query<{ id: string }>(
    `INSERT INTO chats (id, document_id) VALUES ($1, $2)
     ON CONFLICT (document_id) DO UPDATE SET document_id = EXCLUDED.document_id
     RETURNING id`,
    [id, documentId],
  );
  return created[0]?.id ?? id;
}

interface MessageRow {
  id: string;
  role: "user" | "assistant";
  content: string;
  structured: unknown;
  citations: unknown;
  retrieval: unknown;
  ui_state: unknown;
}

function toMessage(row: MessageRow): StoredMessage {
  const citations = citationSchema.array().safeParse(row.citations);
  const retrieval = retrievalMetaSchema.safeParse(row.retrieval);
  const uiState = messageUiStateSchema.safeParse(row.ui_state);

  return {
    id: row.id,
    role: row.role,
    content: row.content,
    structured: row.structured === null ? null : parseRenderablePayload(row.structured),
    citations: citations.success ? citations.data : [],
    retrieval: retrieval.success ? retrieval.data : null,
    uiState: uiState.success ? uiState.data : EMPTY_UI_STATE,
  };
}

export async function getMessages(chatId: string): Promise<StoredMessage[]> {
  const rows = await query<MessageRow>(
    `SELECT id, role, content, structured, citations, retrieval, ui_state
       FROM messages
      WHERE chat_id = $1 AND role IN ('user', 'assistant')
      ORDER BY seq`,
    [chatId],
  );
  return rows.map(toMessage);
}

export async function insertMessage(input: {
  id: string;
  chatId: string;
  role: "user" | "assistant";
  content: string;
  structured?: unknown;
  citations?: readonly Citation[];
  retrieval?: RetrievalMeta | null;
}): Promise<void> {
  await execute(
    `INSERT INTO messages (id, chat_id, role, content, structured, citations, retrieval, ui_state)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     ON CONFLICT (id) DO UPDATE
        SET content = EXCLUDED.content,
            structured = EXCLUDED.structured,
            citations = EXCLUDED.citations,
            retrieval = EXCLUDED.retrieval`,
    [
      input.id,
      input.chatId,
      input.role,
      input.content,
      input.structured === undefined || input.structured === null
        ? null
        : JSON.stringify(input.structured),
      JSON.stringify(input.citations ?? []),
      input.retrieval ? JSON.stringify(input.retrieval) : null,
      JSON.stringify(EMPTY_UI_STATE),
    ],
  );
}

export async function updateMessageUiState(
  messageId: string,
  uiState: MessageUiState,
): Promise<void> {
  await execute(`UPDATE messages SET ui_state = $2 WHERE id = $1`, [
    messageId,
    JSON.stringify(uiState),
  ]);
}
