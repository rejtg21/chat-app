/**
 * The prototype's "Demo" cluster (Bad file / Retrieval error / Reset) is not
 * product surface — it existed to make the error states reachable in a
 * static mock. Both errors are reachable for real here (upload a .pptx; lose
 * the database), so the cluster is dropped rather than shipped behind a flag.
 */
export const Header = ({ hasDocument }: { hasDocument: boolean }) => {
  return (
    <header
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: "var(--space-6)",
        padding: "var(--space-3) var(--space-6)",
        borderBottom: "1px solid var(--color-divider)",
        flex: "none",
      }}
    >
      <div style={{ display: "flex", alignItems: "baseline", gap: "var(--space-3)" }}>
        <span
          style={{
            fontFamily: "var(--font-heading)",
            fontWeight: 700,
            fontSize: 19,
            letterSpacing: "0.02em",
            textTransform: "uppercase",
          }}
        >
          Docdesk
        </span>
        <span
          style={{
            fontSize: 11,
            letterSpacing: "0.14em",
            textTransform: "uppercase",
            color: "var(--color-neutral-600)",
          }}
        >
          Document chat
        </span>
      </div>

      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 7,
          fontSize: 11,
          letterSpacing: "0.08em",
          textTransform: "uppercase",
          color: "var(--color-neutral-700)",
        }}
      >
        <span
          style={{
            width: 6,
            height: 6,
            background: "var(--color-accent)",
            display: "block",
          }}
        />
        <span>{hasDocument ? "Conversation saved" : "Connected"}</span>
      </div>
    </header>
  );
};
