import { generateText, Output } from "ai";
import { z } from "zod";
import { ANNOTATION_MODEL } from "@/lib/config";
import {
  checklistSchema,
  comparisonTableSchema,
  keyFiguresSchema,
  timelineSchema,
  evidenceCardsSchema,
  parseRenderablePayload,
  type RenderablePayload,
} from "@/lib/structured";
import { findByChunkId, formatSources, type RetrievedChunk } from "@/lib/retrieval";
import { citationWhere } from "@/lib/format";

/**
 * Prompting and the post-answer annotation pass.
 *
 * The answer is produced in two passes on purpose:
 *
 *  1. `streamText` writes the prose, which is what the user watches arrive.
 *  2. Once the prose is complete, a second, cheaper call picks at most one
 *     structured component for it.
 *
 * Splitting them buys two things the design actually requires. The structured
 * component and the citations mount only after streaming finishes, which is
 * the specified behaviour — and the component is chosen with the finished
 * answer in view, rather than being guessed at token three.
 */

export function buildSystemPrompt(input: {
  filename: string;
  sources: readonly RetrievedChunk[];
}): string {
  if (input.sources.length === 0) {
    return [
      `You answer questions about an uploaded document called "${input.filename}".`,
      "",
      "Nothing in the document scored above the retrieval threshold for this question.",
      "Say so plainly, in two short sentences, and name what the document does cover",
      "so the reader can judge whether they asked the wrong question or uploaded the",
      "wrong file. Do not apologise, do not hedge, and do not answer from general",
      "knowledge. Do not use citation markers — there are no sources to cite.",
    ].join("\n");
  }

  return [
    `You answer questions about an uploaded document called "${input.filename}".`,
    "",
    "Answer ONLY from the numbered sources below. If they do not contain the answer,",
    "say so rather than reaching for general knowledge.",
    "",
    "Cite with bracketed markers that match the source numbers: [1], [2]. Put the",
    "marker at the end of the sentence it supports. Cite every factual claim.",
    "Never write a filename, section name, page or line number yourself — the",
    "marker is your only way to point at a passage, and the application resolves",
    "it to a real location.",
    "",
    "Keep it tight: two or three short paragraphs, no headings, no bullet lists,",
    "no restating the question.",
    "",
    "SOURCES",
    formatSources(input.sources),
  ].join("\n");
}

/**
 * The annotation schema. "none" is a first-class member so the model always
 * returns a well-formed object — asking for an optional field invites a null
 * that some providers render as a broken partial object.
 */
const annotationSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("none"),
  }),
  comparisonTableSchema,
  timelineSchema,
  keyFiguresSchema,
  checklistSchema,
  evidenceCardsSchema,
]);

const ANNOTATION_INSTRUCTIONS = [
  "You choose at most one structured component to accompany an answer that has",
  "already been written. Pick the one the answer's own shape calls for:",
  "",
  '  comparisonTable — the answer compares things across the same measures',
  '  timeline        — the answer describes change over time',
  '  keyFigures      — the answer is carried by three to six headline numbers',
  '  checklist       — the answer is a set of actions to take',
  '  evidenceCards   — the answer rests on a few specific passages',
  '  none            — anything else, including short or hedging answers',
  "",
  "Prefer 'none' over a weak fit. A component must add something the prose does",
  "not already give; it is not a decoration and it must not contradict the",
  "answer or introduce a figure the sources do not support.",
  "",
  "Every value must come from the answer or the sources. Never invent a number.",
  "For evidenceCards, `chunkId` must be one of the chunk labels given below,",
  "copied exactly.",
].join("\n");

/**
 * Pick and validate a structured component for a finished answer.
 *
 * Returns null whenever anything is off — the model declines, validation
 * fails, or the call errors. Null means the message renders as plain prose,
 * which is the documented fallback and is always a correct rendering.
 */
export async function annotateAnswer(input: {
  question: string;
  answer: string;
  sources: readonly RetrievedChunk[];
  filename: string;
}): Promise<RenderablePayload | null> {
  if (input.sources.length === 0 || !input.answer.trim()) return null;

  try {
    const { output } = await generateText({
      model: ANNOTATION_MODEL,
      output: Output.object({ schema: annotationSchema }),
      system: ANNOTATION_INSTRUCTIONS,
      prompt: [
        `QUESTION\n${input.question}`,
        "",
        `ANSWER\n${input.answer}`,
        "",
        "SOURCES",
        input.sources
          .map((chunk, index) => `[${index + 1}] ${chunk.label}\n${chunk.text}`)
          .join("\n\n"),
      ].join("\n"),
    });

    if (output.kind === "none") return null;

    // Evidence cards are the one component that names chunks. Resolve them
    // here so the excerpt and location come from the database, exactly as
    // citations do — and drop any card naming a chunk that was not retrieved.
    if (output.kind === "evidenceCards") {
      const cards = output.cards
        .map((card) => {
          const chunk = findByChunkId(input.sources, card.chunkId);
          if (!chunk) return null;
          return {
            label: card.label,
            chunkId: chunk.id,
            score: chunk.score.toFixed(2),
            excerpt: chunk.text,
            where: citationWhere(input.filename, chunk),
          };
        })
        .filter((card): card is NonNullable<typeof card> => card !== null);

      if (cards.length === 0) return null;
      return parseRenderablePayload({
        kind: "resolvedEvidenceCards",
        title: output.title,
        cards,
      });
    }

    // Guard against a table whose rows do not line up with its columns —
    // schema-valid, but it would render as a ragged grid.
    if (output.kind === "comparisonTable") {
      const width = output.columns.length;
      if (output.rows.some((row) => row.cells.length !== width)) return null;
    }

    return parseRenderablePayload(output);
  } catch (error) {
    // Annotation is an enhancement. Losing it must never lose the answer.
    console.error("[annotation] falling back to prose", error);
    return null;
  }
}
