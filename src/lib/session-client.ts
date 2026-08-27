import type { ChatUIMessage } from "@/lib/ui-messages";
import {
  CITATIONS_PART_ID,
  RETRIEVAL_PART_ID,
  STRUCTURED_PART_ID,
} from "@/lib/ui-messages";
import type { StoredMessage } from "@/lib/types";

/**
 * Turn a row read back from the database into the same UIMessage shape the
 * live stream produces.
 *
 * Restored and live messages then render through exactly one path. The
 * alternative — a second renderer for "historical" messages — is how the two
 * drift until a reload quietly looks different from the session that made it.
 */
export const toUIMessage = (message: StoredMessage): ChatUIMessage => {
  if (message.role === "user") {
    return {
      id: message.id,
      role: "user",
      parts: [{ type: "text", text: message.content }],
    };
  }

  const parts: ChatUIMessage["parts"] = [
    { type: "text", text: message.content },
  ];

  if (message.retrieval) {
    parts.push({
      type: "data-retrieval",
      id: RETRIEVAL_PART_ID,
      data: message.retrieval,
    });
  }
  if (message.citations.length > 0) {
    parts.push({
      type: "data-citations",
      id: CITATIONS_PART_ID,
      data: message.citations,
    });
  }
  if (message.structured) {
    parts.push({
      type: "data-structured",
      id: STRUCTURED_PART_ID,
      data: message.structured,
    });
  }

  return { id: message.id, role: "assistant", parts };
};

/** Pull the typed data parts back out of a message for rendering. */
export const readDataParts = (message: ChatUIMessage) => {
  let retrieval: Extract<
    ChatUIMessage["parts"][number],
    { type: "data-retrieval" }
  >["data"] | null = null;
  let citations: Extract<
    ChatUIMessage["parts"][number],
    { type: "data-citations" }
  >["data"] = [];
  let structured: unknown = null;
  let text = "";

  for (const part of message.parts) {
    if (part.type === "text") text += part.text;
    else if (part.type === "data-retrieval") retrieval = part.data;
    else if (part.type === "data-citations") citations = part.data;
    else if (part.type === "data-structured") structured = part.data;
  }

  return { text, retrieval, citations, structured };
};
