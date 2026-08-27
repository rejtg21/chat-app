/**
 * 3b. Openers, and the same grammar reused as follow-ups.
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
 *
 * `variant` decides where the list is standing:
 *   - "intro"    — above the first question, with the document heading.
 *   - "followup" — under the latest answer, as continuation prompts. Rows the
 *     reader has already asked are dropped, so the list only ever offers a
 *     next step; when nothing is left it renders nothing.
 */
const SUGGESTIONS = [
  { kind: "Table", question: "Compare the main options this document weighs up." },
  { kind: "Timeline", question: "How did things change over the period it covers?" },
  { kind: "Figures", question: "Give me the headline numbers." },
  { kind: "Checklist", question: "What does it say we should do next?" },
  { kind: "Evidence", question: "What is the strongest evidence for its main claim?" },
] as const;

const normalise = (question: string) => question.trim().toLowerCase();

export const Suggestions = ({
  variant = "intro",
  filename,
  askedQuestions = [],
  onAsk,
}: {
  variant?: "intro" | "followup";
  filename?: string;
  askedQuestions?: string[];
  onAsk: (question: string) => void;
}) => {
  const asked = new Set(askedQuestions.map(normalise));
  const rows = SUGGESTIONS.filter((row) => !asked.has(normalise(row.question)));
  if (rows.length === 0) return null;

  return (
    <div style={{ maxWidth: 660, margin: "0 auto" }}>
      {variant === "intro" ? (
        <>
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
            Every answer points to the exact section and lines it came from.
          </p>
        </>
      ) : (
        <p
          style={{
            margin: "0 0 var(--space-3)",
            fontSize: 10,
            letterSpacing: "0.1em",
            textTransform: "uppercase",
            color: "var(--color-neutral-700)",
          }}
        >
          Ask a follow-up
        </p>
      )}
      <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
        {rows.map((suggestion) => (
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
