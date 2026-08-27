import type { ReactNode } from "react";

/**
 * The small uppercase accent label that sits above every structured
 * component. All five share this grammar, per the handoff.
 */
export const Kicker = ({
  children,
  trailing,
  marginBottom = "var(--space-3)",
}: {
  children: ReactNode;
  trailing?: ReactNode;
  marginBottom?: string;
}) => {
  if (trailing !== undefined) {
    return (
      <div
        style={{
          display: "flex",
          alignItems: "baseline",
          gap: "var(--space-3)",
          marginBottom,
        }}
      >
        <span style={kickerText}>{children}</span>
        <span style={{ fontSize: 11, color: "var(--color-neutral-600)" }}>
          {trailing}
        </span>
      </div>
    );
  }

  return <div style={{ ...kickerText, marginBottom }}>{children}</div>;
};

const kickerText = {
  fontSize: 10,
  letterSpacing: "0.12em",
  textTransform: "uppercase",
  color: "var(--color-accent)",
} as const;

/** Every structured component hangs the same distance below the prose. */
export const structuredBlockStyle = { marginTop: "var(--space-6)" } as const;
