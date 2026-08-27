import { Blueprint } from "@/components/Blueprint";
import { Kicker, structuredBlockStyle } from "./Kicker";
import type { KeyFiguresPayload } from "@/lib/structured";

export const KeyFigures = ({ payload }: { payload: KeyFiguresPayload }) => {
  return (
    <div style={structuredBlockStyle}>
      <Kicker>{payload.title}</Kicker>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
          gap: "var(--space-4)",
        }}
      >
        {payload.figures.map((figure, index) => (
          <Blueprint key={index} style={{ padding: "var(--space-4)" }}>
            <div
              style={{
                fontFamily: "var(--font-heading)",
                fontSize: 30,
                lineHeight: 1,
                // accent-800, not accent: the figure is large but it is still
                // type, and the base accent is only a 3:1 pair on this ground.
                color: "var(--color-accent-800)",
              }}
            >
              {figure.value}
            </div>
            <div style={{ marginTop: 7, fontSize: 12 }}>{figure.label}</div>
            {figure.note ? (
              <div
                style={{
                  marginTop: 3,
                  fontSize: 11,
                  color: "var(--color-neutral-600)",
                }}
              >
                {figure.note}
              </div>
            ) : null}
          </Blueprint>
        ))}
      </div>
    </div>
  );
};
