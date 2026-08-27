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
  type StructuredPayload,
} from "@/lib/structured";
import { findByChunkId, formatSources, type RetrievedChunk } from "@/lib/retrieval";
import { citationWhere } from "@/lib/format";

/**
 * Prompting and the post-answer annotation pass.
 *
 * The answer is produced in stages on purpose:
 *
 *  1. `streamText` writes the prose, which is what the user watches arrive.
 *  2. Once the prose is complete, a cheap classifier call picks at most one
 *     structured component for it — or "none".
 *  3. If a component was picked, a second cheap call fills in just that one
 *     shape.
 *
 * Steps 2 and 3 are split rather than folded into a single call. A small
 * annotation model handles "choose one label" and "fill one flat object"
 * far more reliably than "emit one member of a six-way discriminated union",
 * which it tends to answer with an invented shape. Every stage fails soft:
 * anything off returns null and the message renders as plain prose, which is
 * always a correct rendering.
 *
 * Splitting the prose from the annotation also buys what the design requires:
 * the structured component and the citations mount only after streaming
 * finishes, and the component is chosen with the finished answer in view
 * rather than being guessed at token three.
 */

export const buildSystemPrompt = (input: {
  filename: string;
  sources: readonly RetrievedChunk[];
}): string => {
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
    "Cite with plain ASCII square brackets that match the source numbers: [1],",
    "[2]. Never use 【 】, 〔 〕, parentheses or any other bracket character, and",
    "never group numbers as [1, 2] — write [1][2]. Put the marker at the end of",
    "the sentence it supports. Cite every factual claim.",
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
};

/**
 * Sent as a trailing user turn when a segment stopped because it hit the
 * model's output-token ceiling, not because the answer was finished. The
 * partial answer is replayed to the model as the preceding assistant turn, so
 * this only has to ask for a seamless continuation — no preamble, no repeat.
 */
export const CONTINUE_ANSWER_INSTRUCTION = [
  "Your previous message was cut off before it finished. Continue it from the",
  "exact point it stopped. Do not repeat any text you already wrote, do not",
  "add an introduction, a recap or a closing note, and keep the same paragraph",
  "flow and the same [n] citation style.",
].join("\n");

/**
 * The component labels the classifier chooses between. "none" is a
 * first-class member so the call always has a well-formed answer.
 */
const COMPONENT_KINDS = [
  "none",
  "comparisonTable",
  "timeline",
  "keyFigures",
  "checklist",
  "evidenceCards",
] as const;
type ComponentKind = (typeof COMPONENT_KINDS)[number];
type BuiltKind = Exclude<ComponentKind, "none">;

const classifierSchema = z.object({ kind: z.enum(COMPONENT_KINDS) });

/**
 * The builder call is handed one shape, not the union, and it does not have
 * to reproduce the `kind` discriminant — we know it and add it back. That
 * leaves the model only the fields that actually vary.
 */
const bodySchemas = {
  comparisonTable: comparisonTableSchema.omit({ kind: true }),
  timeline: timelineSchema.omit({ kind: true }),
  keyFigures: keyFiguresSchema.omit({ kind: true }),
  checklist: checklistSchema.omit({ kind: true }),
  evidenceCards: evidenceCardsSchema.omit({ kind: true }),
} as const;

// const CLASSIFIER_INSTRUCTIONS = [
//   "An answer has already been written. Choose at least one structured component",
//   "whose shape the answer calls for, or 'none'.",
//   "",
//   '  comparisonTable — the answer compares things across the same measures',
//   '  timeline        — the answer describes change over time',
//   '  keyFigures      — the answer is carried by three to six headline numbers',
//   '  checklist       — the answer is a set of actions to take',
//   '  evidenceCards   — the answer rests on a few specific passages',
//   '  none            — anything else, including short or hedging answers',
//   "",
//   "Prefer 'none' over a weak fit. A component must add something the prose",
//   "does not already give; it is not a decoration. Answer with the label only.",
// ].join("\n");
const CLASSIFIER_INSTRUCTIONS = [
  "Given an already-written answer, choose at least one of the best structured component or none.",
  "Choose only if the format materially improves scanning, comparison, verification, or action.",
  "Prefer none over a weak/forced fit. Do not infer missing data or rely on outside knowledge.",
  "",
  "comparisonTable — use when 2+ alternatives/entities are compared across",
  "                  2+ criteria, even if the comparison is written as prose.",
  "                  Extract the shared criteria and align them into rows.",
  "timeline        — events, stages, or changes ordered by time",
  "keyFigures      — 3–6 important numbers central to the answer",
  "checklist       — concrete actions, tasks, requirements, or verification items",
  "evidenceCards   — important claims supported by specific source passages",
  "none            — otherwise, including short, conversational, speculative, or hedging answers",
  "",
  "A date, number, action, or source alone does not justify a component.",
  "If multiple fit, choose the one that adds the most value.",
  "Return the label only.",
].join("\n");

const BUILDER_INSTRUCTIONS = [
  "Build the selected component from the answer and provided sources.",
  "",
  "Use only information explicitly supported by them. Never invent, estimate,",
  "infer, or add unsupported values. Preserve qualifiers.",
  "",
  "For comparisonTable, extract the comparison criteria already present in",
  "the answer and align the compared entities against those criteria.",
  "Do not create new criteria or fill missing cells with assumptions.",
  "",
  "Keep labels concise and avoid unnecessary duplication.",
  "If data is missing, do not guess.",
  "",
  "For evidenceCards, `chunkId` must exactly match a provided chunk label.",
  "Evidence must directly support its associated claim.",
].join("\n");

/** QUESTION / ANSWER / SOURCES — the shared context both calls read. */
const buildAnnotationPrompt = (input: {
  question: string;
  answer: string;
  sources: readonly RetrievedChunk[];
}): string =>
  [
    `QUESTION\n${input.question}`,
    "",
    `ANSWER\n${input.answer}`,
    "",
    "SOURCES",
    input.sources
      .map((chunk, index) => `[${index + 1}] ${chunk.label}\n${chunk.text}`)
      .join("\n\n"),
  ].join("\n");

const reason = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

/** Step 2: pick a component label, or null if the call is unusable. */
const classifyAnswer = async (prompt: string): Promise<ComponentKind | null> => {
  try {
    const { output } = await generateText({
      model: ANNOTATION_MODEL,
      output: Output.object({ schema: classifierSchema }),
      system: CLASSIFIER_INSTRUCTIONS,
      prompt,
    });
    return output.kind;
  } catch (error) {
    console.warn("[annotation] classifier failed, prose only:", reason(error));
    return null;
  }
};

/** Step 3: fill in the one chosen shape, or null if the call is unusable. */
const buildComponent = async (
  kind: BuiltKind,
  prompt: string,
): Promise<StructuredPayload | null> => {
  const common = {
    model: ANNOTATION_MODEL,
    system: BUILDER_INSTRUCTIONS,
    prompt,
  } as const;

  try {
    // A per-kind branch so each call is given one concrete schema, not the
    // union — the model, and the type checker, only ever see one shape.
    switch (kind) {
      case "comparisonTable": {
        const { output } = await generateText({
          ...common,
          output: Output.object({ schema: bodySchemas.comparisonTable }),
        });
        return { kind, ...output };
      }
      case "timeline": {
        const { output } = await generateText({
          ...common,
          output: Output.object({ schema: bodySchemas.timeline }),
        });
        return { kind, ...output };
      }
      case "keyFigures": {
        const { output } = await generateText({
          ...common,
          output: Output.object({ schema: bodySchemas.keyFigures }),
        });
        return { kind, ...output };
      }
      case "checklist": {
        const { output } = await generateText({
          ...common,
          output: Output.object({ schema: bodySchemas.checklist }),
        });
        return { kind, ...output };
      }
      case "evidenceCards": {
        const { output } = await generateText({
          ...common,
          output: Output.object({ schema: bodySchemas.evidenceCards }),
        });
        return { kind, ...output };
      }
    }
  } catch (error) {
    console.warn(
      `[annotation] could not build ${kind}, prose only:`,
      reason(error),
    );
    return null;
  }
};

/**
 * Pick and validate a structured component for a finished answer.
 *
 * Returns null whenever anything is off — the model declines, validation
 * fails, or the call errors. Null means the message renders as plain prose,
 * which is the documented fallback and is always a correct rendering.
 */
export const annotateAnswer = async (input: {
  question: string;
  answer: string;
  sources: readonly RetrievedChunk[];
  filename: string;
}): Promise<RenderablePayload | null> => {
  if (input.sources.length === 0 || !input.answer.trim()) return null;

  const prompt = buildAnnotationPrompt(input);

  const kind = await classifyAnswer(prompt);
  if (!kind || kind === "none") return null;

  const built = await buildComponent(kind, prompt);
  if (!built) return null;

  // Evidence cards are the one component that names chunks. Resolve them
  // here so the excerpt and location come from the database, exactly as
  // citations do — and drop any card naming a chunk that was not retrieved.
  if (built.kind === "evidenceCards") {
    const cards = built.cards
      .map((card) => {
        const chunk = findByChunkId(input.sources, card.chunkId);
        if (!chunk) return null;
        return {
          label: card.label,
          chunkId: chunk.id,
          score: `${Math.round(chunk.score * 100)}% match`,
          excerpt: chunk.text,
          where: citationWhere(input.filename, chunk),
        };
      })
      .filter((card): card is NonNullable<typeof card> => card !== null);

    if (cards.length === 0) return null;
    return parseRenderablePayload({
      kind: "resolvedEvidenceCards",
      title: built.title,
      cards,
    });
  }

  // Guard against a table whose rows do not line up with its columns —
  // schema-valid, but it would render as a ragged grid.
  if (built.kind === "comparisonTable") {
    const width = built.columns.length;
    if (built.rows.some((row) => row.cells.length !== width)) return null;
  }

  return parseRenderablePayload(built);
};
