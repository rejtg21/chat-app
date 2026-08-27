import { Kicker, structuredBlockStyle } from "./Kicker";
import type { TimelinePayload } from "@/lib/structured";

export function Timeline({ payload }: { payload: TimelinePayload }) {
  return (
    <div style={structuredBlockStyle}>
      <Kicker marginBottom="var(--space-4)">{payload.title}</Kicker>
      <div style={{ display: "flex", flexDirection: "column" }}>
        {payload.events.map((event, index) => (
          <div
            key={index}
            style={{
              display: "grid",
              gridTemplateColumns: "76px 1fr",
              gap: "var(--space-4)",
              paddingBottom: "var(--space-6)",
            }}
          >
            <div
              style={{
                fontSize: 12,
                letterSpacing: "0.06em",
                textTransform: "uppercase",
                color: "var(--color-neutral-600)",
                paddingTop: 2,
              }}
            >
              {event.date}
            </div>
            <div
              style={{
                position: "relative",
                paddingLeft: "var(--space-6)",
                borderLeft: "1px solid var(--color-divider)",
              }}
            >
              {/* The node straddles the rule, which is what makes the line
                  read as a spine rather than a border. */}
              <span
                style={{
                  position: "absolute",
                  left: -4,
                  top: 5,
                  width: 7,
                  height: 7,
                  background: "var(--color-accent)",
                  display: "block",
                }}
              />
              <div
                style={{
                  fontFamily: "var(--font-heading)",
                  fontSize: 17,
                  lineHeight: 1.2,
                }}
              >
                {event.title}
              </div>
              {event.detail ? (
                <div
                  style={{
                    marginTop: 3,
                    fontSize: 13,
                    color: "var(--color-neutral-700)",
                  }}
                >
                  {event.detail}
                </div>
              ) : null}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
