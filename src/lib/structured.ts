import { z } from "zod";

/**
 * The five in-chat structured components, as a discriminated union.
 *
 * This module is the seam between the model and the UI:
 *  - the server turns each member into an AI SDK tool (see src/lib/tools.ts),
 *    so the model can only emit a shape that already type-checks;
 *  - the client re-validates the tool input with `structuredPayloadSchema`
 *    before rendering, and falls back to plain prose when validation fails.
 *
 * Re-validating on the client is deliberate. Tool input arrives over the
 * wire and may also come back out of the database, where an older row could
 * carry a shape this build no longer understands. Prose is always correct;
 * a half-rendered table is not.
 */

const nonEmpty = z.string().min(1);

/** 1. Comparison table — kicker "Format comparison" in the reference design. */
export const comparisonTableSchema = z.object({
  kind: z.literal("comparisonTable"),
  title: nonEmpty.describe(
    "Short uppercase kicker naming the comparison, e.g. 'Format comparison'.",
  ),
  columns: z
    .array(
      z.object({
        label: nonEmpty,
        /** Numeric columns are right-aligned and get tabular figures. */
        numeric: z.boolean().default(false),
      }),
    )
    .min(2)
    .max(6),
  rows: z
    .array(
      z.object({
        cells: z.array(z.string()).min(2).max(6),
        /**
         * At most one row should be highlighted — the "winner". The
         * highlight replaces chart colour in this design system.
         */
        highlighted: z.boolean().default(false),
      }),
    )
    .min(1)
    .max(12),
});

/** 2. Timeline — kicker "Cadence changes". */
export const timelineSchema = z.object({
  kind: z.literal("timeline"),
  title: nonEmpty,
  events: z
    .array(
      z.object({
        date: nonEmpty.describe("Short date label, e.g. 'Jul' or '8 Aug'."),
        title: nonEmpty,
        detail: z.string().default(""),
      }),
    )
    .min(2)
    .max(10),
});

/** 3. Key figures — kicker "Key figures". */
export const keyFiguresSchema = z.object({
  kind: z.literal("keyFigures"),
  title: nonEmpty,
  figures: z
    .array(
      z.object({
        value: nonEmpty.describe("The number itself, e.g. '56' or '+1,321'."),
        label: nonEmpty,
        note: z.string().default(""),
      }),
    )
    .min(2)
    .max(6),
});

/** 4. Checklist — kicker "Recommended actions". Ticks persist per message. */
export const checklistSchema = z.object({
  kind: z.literal("checklist"),
  title: nonEmpty,
  items: z
    .array(
      z.object({
        label: nonEmpty,
        source: z
          .string()
          .default("")
          .describe("Where it came from, e.g. '§6 · L156'."),
      }),
    )
    .min(2)
    .max(12),
});

/** 5. Evidence cards — kicker "Retrieved evidence". Collapsed by default. */
export const evidenceCardsSchema = z.object({
  kind: z.literal("evidenceCards"),
  title: nonEmpty,
  cards: z
    .array(
      z.object({
        label: nonEmpty.describe("What the passage is about."),
        chunkId: nonEmpty.describe(
          "The id of a retrieved chunk, exactly as given in the sources list.",
        ),
      }),
    )
    .min(1)
    .max(6),
});

export const structuredPayloadSchema = z.discriminatedUnion("kind", [
  comparisonTableSchema,
  timelineSchema,
  keyFiguresSchema,
  checklistSchema,
  evidenceCardsSchema,
]);

export type ComparisonTablePayload = z.infer<typeof comparisonTableSchema>;
export type TimelinePayload = z.infer<typeof timelineSchema>;
export type KeyFiguresPayload = z.infer<typeof keyFiguresSchema>;
export type ChecklistPayload = z.infer<typeof checklistSchema>;
export type EvidenceCardsPayload = z.infer<typeof evidenceCardsSchema>;
export type StructuredPayload = z.infer<typeof structuredPayloadSchema>;
export type StructuredKind = StructuredPayload["kind"];

/**
 * Evidence cards are enriched server-side: the model only ever names a
 * chunk id, and the excerpt plus the human-readable location are resolved
 * from the database. This is the shape that actually reaches the UI.
 */
export const resolvedEvidenceCardsSchema = z.object({
  kind: z.literal("resolvedEvidenceCards"),
  title: nonEmpty,
  cards: z.array(
    z.object({
      label: nonEmpty,
      chunkId: nonEmpty,
      score: z.string(),
      excerpt: z.string(),
      where: z.string(),
    }),
  ),
});
export type ResolvedEvidenceCardsPayload = z.infer<
  typeof resolvedEvidenceCardsSchema
>;

/** What the UI actually renders, after server-side resolution. */
export const renderablePayloadSchema = z.union([
  comparisonTableSchema,
  timelineSchema,
  keyFiguresSchema,
  checklistSchema,
  resolvedEvidenceCardsSchema,
]);
export type RenderablePayload = z.infer<typeof renderablePayloadSchema>;

/**
 * Parse an unknown value into something safe to render.
 * Returns null when the payload does not validate — the caller then shows
 * prose only, which is the documented fallback.
 */
export const parseRenderablePayload = (value: unknown): RenderablePayload | null => {
  const result = renderablePayloadSchema.safeParse(value);
  return result.success ? result.data : null;
};
