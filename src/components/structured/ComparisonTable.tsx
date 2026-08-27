import { Blueprint } from "@/components/Blueprint";
import { Kicker, structuredBlockStyle } from "./Kicker";
import type { ComparisonTablePayload } from "@/lib/structured";

/**
 * The highlighted row carries the emphasis a chart would otherwise carry with
 * colour — this system has no decorative colour to spend, so the "winner" is
 * marked with an accent tint and weight instead.
 */
export function ComparisonTable({ payload }: { payload: ComparisonTablePayload }) {
  return (
    <div style={structuredBlockStyle}>
      <Kicker>{payload.title}</Kicker>
      <Blueprint
        style={{ padding: "var(--space-4) var(--space-4) var(--space-2)" }}
      >
        {/* Narrow viewports scroll the table, never the page. */}
        <div style={{ overflowX: "auto" }}>
          <table
            className="table"
            style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}
          >
            <thead>
              <tr>
                {payload.columns.map((column, index) => (
                  <th
                    key={index}
                    scope="col"
                    style={{
                      textAlign: column.numeric ? "right" : "left",
                      padding: "0 var(--space-3) var(--space-2) 0",
                      fontSize: 10,
                      letterSpacing: "0.1em",
                      textTransform: "uppercase",
                      fontWeight: 600,
                      color: "var(--color-neutral-600)",
                      borderBottom: "1px solid var(--color-divider)",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {column.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {payload.rows.map((row, rowIndex) => (
                <tr
                  key={rowIndex}
                  style={{
                    background: row.highlighted
                      ? "color-mix(in srgb, var(--color-accent) 10%, transparent)"
                      : "transparent",
                  }}
                >
                  {row.cells.map((cell, cellIndex) => (
                    <td
                      key={cellIndex}
                      style={{
                        textAlign: payload.columns[cellIndex]?.numeric
                          ? "right"
                          : "left",
                        padding: "var(--space-2) var(--space-3) var(--space-2) 0",
                        borderBottom:
                          "1px solid color-mix(in srgb, var(--color-text) 8%, transparent)",
                        fontWeight: cellIndex === 0 || row.highlighted ? 600 : 400,
                        fontVariantNumeric: "tabular-nums",
                      }}
                    >
                      {cell}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Blueprint>
    </div>
  );
}
