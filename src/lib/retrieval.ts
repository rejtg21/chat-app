import {
  RELATIVE_SIMILARITY_GAP,
  RETRIEVAL_TOP_K,
  SIMILARITY_THRESHOLD,
} from "@/lib/config";
import { asRetrievalError, query, toVectorLiteral } from "@/lib/db";
import { embedText } from "@/lib/embeddings";
import {
  chunkLabel,
  chunkWhere,
  citationWhere,
  normalizeCitationMarkers,
} from "@/lib/format";
import type { Citation, ChunkRecord, RetrievalMeta } from "@/lib/types";

/** A chunk plus how well it matched the question. */
export interface RetrievedChunk extends ChunkRecord {
  score: number;
}

export interface RetrievalResult {
  chunks: RetrievedChunk[];
  meta: RetrievalMeta;
}

interface ScoredRow {
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
  score: number;
}

/**
 * Embed the question, then take the cosine top-k over pgvector.
 *
 * Vectors are stored L2-normalised, so cosine similarity is exactly
 * `1 - (a <=> b)` where `<=>` is pgvector's cosine-distance operator.
 *
 * Two gates trim the result. The absolute SIMILARITY_THRESHOLD answers "is
 * this on the question's topic at all" — it is what keeps an off-topic
 * question from being answered out of unrelated passages. The relative
 * RELATIVE_SIMILARITY_GAP then drops anything sitting well below the best
 * hit, so a strong top match doesn't drag a trail of weak context behind it.
 */
export const retrieve = async (
  documentId: string,
  question: string,
  totalChunks: number,
): Promise<RetrievalResult> => {
  const vector = await embedText(question);

  let rows: ScoredRow[];
  try {
    rows = await query<ScoredRow>(
      `SELECT c.id, c.document_id, c.ordinal, c.section_ordinal, c.section_label,
              c.page, c.line_start, c.line_end, c.token_count, c.text,
              1 - (e.embedding <=> $2::vector) AS score
         FROM embeddings e
         JOIN chunks c ON c.id = e.chunk_id
        WHERE e.document_id = $1
        ORDER BY e.embedding <=> $2::vector
        LIMIT $3`,
      [documentId, toVectorLiteral(vector), RETRIEVAL_TOP_K],
    );
  } catch (cause) {
    // Surfaces as the "Retrieval failed" card. The document and the
    // conversation are untouched — only the lookup failed.
    throw asRetrievalError(cause);
  }

  // `rows` arrives ordered by cosine distance ascending, i.e. score
  // descending, so the first mapped chunk carries the best score.
  const scored: RetrievedChunk[] = rows.map((row) => {
    const location = {
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
      ...location,
      tokenCount: row.token_count,
      text: row.text,
      where: chunkWhere(location),
      score: Number(row.score),
    };
  });

  const topScore = scored[0]?.score ?? 0;
  const chunks = scored.filter(
    (chunk) =>
      chunk.score >= SIMILARITY_THRESHOLD &&
      chunk.score >= topScore - RELATIVE_SIMILARITY_GAP,
  );

  const scores = chunks.map((chunk) => chunk.score);

  return {
    chunks,
    meta: {
      retrieved: chunks.length,
      searched: totalChunks,
      minScore: scores.length ? Math.min(...scores) : null,
      maxScore: scores.length ? Math.max(...scores) : null,
      notFound: chunks.length === 0,
    },
  };
};

/**
 * Render the retrieved chunks as the numbered source list the model sees.
 *
 * The number is the model's only handle on a passage. It never sees, and so
 * can never repeat, a filename or a line range.
 */
export const formatSources = (chunks: readonly RetrievedChunk[]): string => {
  return chunks
    .map((chunk, index) => `[${index + 1}] (${chunk.label})\n${chunk.text}`)
    .join("\n\n");
};

/**
 * Resolve the `[n]` markers the model actually wrote into citations.
 *
 * This is the guard the brief asks for. The model contributes one thing — an
 * index — and everything displayed (filename, section, line range, excerpt)
 * is read from the chunk row. A marker pointing outside the retrieved set
 * refers to a chunk that does not exist, and is dropped silently rather than
 * rendered as a plausible-looking citation.
 */
export const resolveCitations = (
  answer: string,
  chunks: readonly RetrievedChunk[],
  filename: string,
): Citation[] => {
  const markers = [
    ...normalizeCitationMarkers(answer).matchAll(/\[(\d{1,2})\]/g),
  ].map((match) => Number(match[1]));

  const seen = new Set<number>();
  const citations: Citation[] = [];

  for (const marker of markers) {
    if (seen.has(marker)) continue;
    seen.add(marker);

    const chunk = chunks[marker - 1];
    if (!chunk) continue; // Out of range — the cited chunk does not exist.

    citations.push({
      n: marker,
      chunkId: chunk.id,
      where: citationWhere(filename, chunk),
      excerpt: chunk.text,
    });
  }

  return citations.sort((a, b) => a.n - b.n);
};

/** Look a chunk up by the id the model named, for evidence cards. */
export const findByChunkId = (
  chunks: readonly RetrievedChunk[],
  chunkId: string,
): RetrievedChunk | null => {
  return (
    chunks.find((chunk) => chunk.id === chunkId || chunk.label === chunkId) ?? null
  );
};
