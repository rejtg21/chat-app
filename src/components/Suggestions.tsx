

/**
 * 3b. Openers, shown until the first question.
 *
 * The prototype's questions ("Which post format performed best?") belonged to
 * its invented LinkedIn corpus and mean nothing against a document the user
 * actually uploaded. These keep the design's grammar — a fixed-width kind
 * label beside the question, one per structured component — but ask things
 * any document can answer.
 *
 * The prototype's sixth row, "No answer", was a demo affordance for reaching
 * the no-passage state. That state is reachable here by asking anything the
 * document does not cover, so the row is gone.
 */
const SUGGESTIONS = [
  { kind: "Table", question: "Compare the main options this document weighs up." },
  { kind: "Timeline", question: "How did things change over the period it covers?" },
  { kind: "Figures", question: "Give me the headline numbers." },
  { kind: "Checklist", question: "What does it say we should do next?" },
  { kind: "Evidence", question: "What is the strongest evidence for its main claim?" },
] as const;

export const Suggestions = ({
  filename,
  chunkCount,
  onAsk,
}: {
  filename: string;
  chunkCount: number;
  onAsk: (question: string) => void;
}) => {
  return (
    <div style={{ maxWidth: 660, margin: "0 auto" }}>
      <h2 style={{ margin: "0 0 var(--space-2)", fontSize: 24 }}>
        Ask about {filename}
      </h2>
      <p
        style={{
          margin: "0 0 var(--space-6)",
          fontSize: 14,
          color: "var(--color-neutral-700)",
        }}
      >
        {chunkCount} chunks indexed · answers cite the section and lines they came
        from.
      </p>
      <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
        {SUGGESTIONS.map((suggestion) => (
          <button
            key={suggestion.kind}
            type="button"
            className="blueprint suggestion"
            onClick={() => onAsk(suggestion.question)}
            style={{
              display: "flex",
              alignItems: "center",
              gap: "var(--space-3)",
              width: "100%",
              padding: "var(--space-3) var(--space-4)",
              background: "transparent",
              font: "inherit",
              fontSize: 14,
              textAlign: "left",
              cursor: "pointer",
              color: "inherit",
            }}
          >
            <i className="corner tl" />
            <i className="corner tr" />
            <i className="corner bl" />
            <i className="corner br" />
            <span
              style={{
                fontSize: 10,
                letterSpacing: "0.1em",
                textTransform: "uppercase",
                color: "var(--color-accent)",
                minWidth: 74,
              }}
            >
              {suggestion.kind}
            </span>
            <span>{suggestion.question}</span>
          </button>
        ))}
      </div>
    </div>
  );
};
