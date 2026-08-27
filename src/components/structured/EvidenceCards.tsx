"use client";

import { ChevronDown } from "lucide-react";
import { Blueprint } from "@/components/Blueprint";
import { Kicker, structuredBlockStyle } from "./Kicker";
import type { ResolvedEvidenceCardsPayload } from "@/lib/structured";

/**
 * Evidence cards are the retrieval pipeline made inspectable: the rank, the
 * cosine score and the passage itself. The model only ever named a chunk —
 * the excerpt and the location were resolved from the database before this
 * ever reached the browser.
 */
export const EvidenceCards = ({
  payload,
  expanded,
  onToggle,
  onOpenInSource,
}: {
  payload: ResolvedEvidenceCardsPayload;
  expanded: Record<string, boolean>;
  onToggle: (index: number) => void;
  onOpenInSource: (chunkId: string) => void;
}) => {
  return (
    <div style={structuredBlockStyle}>
      <Kicker>{payload.title}</Kicker>
      <div
        style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)" }}
      >
        {payload.cards.map((card, index) => {
          const isOpen = Boolean(expanded[String(index)]);
          return (
            <Blueprint key={index} style={{ padding: 0 }}>
              <button
                type="button"
                className="evidence-head"
                aria-expanded={isOpen}
                onClick={() => onToggle(index)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "var(--space-3)",
                  width: "100%",
                  padding: "var(--space-3) var(--space-4)",
                  background: "transparent",
                  border: 0,
                  font: "inherit",
                  textAlign: "left",
                  cursor: "pointer",
                  color: "inherit",
                }}
              >
                <span
                  style={{
                    fontFamily: "var(--font-heading)",
                    fontSize: 13,
                    width: 20,
                    color: "var(--color-accent)",
                  }}
                >
                  {String(index + 1).padStart(2, "0")}
                </span>
                <span style={{ flex: 1, fontSize: 13 }}>{card.label}</span>
                <span
                  style={{
                    fontSize: 11,
                    fontFamily: "var(--font-mono)",
                    color: "var(--color-neutral-600)",
                  }}
                >
                  {card.score}
                </span>
                <ChevronDown
                  size={14}
                  strokeWidth={1.5}
                  aria-hidden
                  style={{
                    transform: `rotate(${isOpen ? 180 : 0}deg)`,
                    transition: "transform 140ms ease",
                  }}
                />
              </button>

              {isOpen ? (
                <div style={{ padding: "0 var(--space-4) var(--space-4)" }}>
                  <p
                    style={{
                      margin: "0 0 var(--space-3)",
                      paddingLeft: "var(--space-4)",
                      borderLeft: "2px solid var(--color-accent)",
                      fontSize: 13,
                      lineHeight: 1.6,
                      color: "var(--color-neutral-800)",
                    }}
                  >
                    {card.excerpt}
                  </p>
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "var(--space-3)",
                      fontSize: 11,
                      color: "var(--color-neutral-600)",
                    }}
                  >
                    <span>{card.where}</span>
                    <button
                      type="button"
                      className="btn btn-ghost"
                      style={{ height: 24, fontSize: 11 }}
                      onClick={() => onOpenInSource(card.chunkId)}
                    >
                      Open in source
                    </button>
                  </div>
                </div>
              ) : null}
            </Blueprint>
          );
        })}
      </div>
    </div>
  );
};
