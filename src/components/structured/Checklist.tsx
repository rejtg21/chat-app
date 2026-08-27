"use client";

import { Check } from "lucide-react";
import { Blueprint } from "@/components/Blueprint";
import { Kicker, structuredBlockStyle } from "./Kicker";
import type { ChecklistPayload } from "@/lib/structured";

/**
 * Ticks are the user's own state, not the model's, so they are persisted per
 * message rather than recomputed — recommendations are things you act on over
 * days, and a reload must not wipe the marks.
 */
export function Checklist({
  payload,
  checked,
  onToggle,
}: {
  payload: ChecklistPayload;
  checked: Record<string, boolean>;
  onToggle: (index: number) => void;
}) {
  const done = payload.items.filter((_, index) => checked[String(index)]).length;

  return (
    <div style={structuredBlockStyle}>
      <Kicker trailing={`${done} of ${payload.items.length} planned`}>
        {payload.title}
      </Kicker>
      <Blueprint style={{ padding: "var(--space-2) var(--space-4)" }}>
        {payload.items.map((item, index) => {
          const isChecked = Boolean(checked[String(index)]);
          return (
            <button
              key={index}
              type="button"
              aria-pressed={isChecked}
              onClick={() => onToggle(index)}
              style={{
                display: "flex",
                alignItems: "flex-start",
                gap: "var(--space-3)",
                width: "100%",
                padding: "var(--space-3) 0",
                background: "transparent",
                border: 0,
                borderBottom:
                  "1px solid color-mix(in srgb, var(--color-text) 8%, transparent)",
                font: "inherit",
                textAlign: "left",
                cursor: "pointer",
                color: "inherit",
              }}
            >
              <span
                style={{
                  flex: "none",
                  width: 17,
                  height: 17,
                  marginTop: 2,
                  border: `1.5px solid ${
                    isChecked ? "var(--color-accent)" : "var(--color-divider)"
                  }`,
                  background: isChecked ? "var(--color-accent)" : "transparent",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <Check
                  size={11}
                  strokeWidth={2.5}
                  color="var(--color-bg)"
                  style={{ opacity: isChecked ? 1 : 0 }}
                  aria-hidden
                />
              </span>
              <span style={{ flex: 1 }}>
                <span
                  style={{
                    display: "block",
                    fontSize: 14,
                    textDecoration: isChecked ? "line-through" : "none",
                    color: isChecked
                      ? "var(--color-neutral-700)"
                      : "var(--color-text)",
                  }}
                >
                  {item.label}
                </span>
                {item.source ? (
                  <span
                    style={{
                      display: "block",
                      marginTop: 2,
                      fontSize: 11,
                      color: "var(--color-neutral-600)",
                    }}
                  >
                    {item.source}
                  </span>
                ) : null}
              </span>
            </button>
          );
        })}
      </Blueprint>
    </div>
  );
}
