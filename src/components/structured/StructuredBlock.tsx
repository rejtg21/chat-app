"use client";

import { parseRenderablePayload } from "@/lib/structured";
import { ComparisonTable } from "./ComparisonTable";
import { Timeline } from "./Timeline";
import { KeyFigures } from "./KeyFigures";
import { Checklist } from "./Checklist";
import { EvidenceCards } from "./EvidenceCards";
import type { MessageUiState } from "@/lib/types";

/**
 * Renders whichever structured component an answer carries.
 *
 * Validation happens here, at the render boundary, even though the server
 * already validated: this payload may equally have come out of the database,
 * where a row written by an earlier build could carry a shape this one no
 * longer understands. Anything that fails returns null and the message keeps
 * its prose — the documented fallback, and always a correct rendering.
 */
export function StructuredBlock({
  payload,
  uiState,
  onToggleChecklistItem,
  onToggleEvidenceCard,
  onOpenInSource,
}: {
  payload: unknown;
  uiState: MessageUiState;
  onToggleChecklistItem: (index: number) => void;
  onToggleEvidenceCard: (index: number) => void;
  onOpenInSource: (chunkId: string) => void;
}) {
  const parsed = parseRenderablePayload(payload);
  if (!parsed) return null;

  switch (parsed.kind) {
    case "comparisonTable":
      return <ComparisonTable payload={parsed} />;
    case "timeline":
      return <Timeline payload={parsed} />;
    case "keyFigures":
      return <KeyFigures payload={parsed} />;
    case "checklist":
      return (
        <Checklist
          payload={parsed}
          checked={uiState.checked}
          onToggle={onToggleChecklistItem}
        />
      );
    case "resolvedEvidenceCards":
      return (
        <EvidenceCards
          payload={parsed}
          expanded={uiState.expanded}
          onToggle={onToggleEvidenceCard}
          onOpenInSource={onOpenInSource}
        />
      );
  }
}
