import type { UIMessage } from "ai";
import type { RenderablePayload } from "@/lib/structured";
import type { Citation, RetrievalMeta } from "@/lib/types";

/**
 * The message shape shared by the chat route and the chat UI.
 *
 * The three data parts are the side channel the design needs. Prose streams
 * as ordinary text; everything that can only be known before or after that
 * text — what was retrieved, what it cited, which component to draw — travels
 * as a typed data part rather than being parsed back out of the prose.
 */
export type ChatUIMessage = UIMessage<
  never,
  {
    /** Written as soon as retrieval returns, which ends the shimmer. */
    retrieval: RetrievalMeta;
    /** Written after the prose completes; markers already resolved. */
    citations: Citation[];
    /** Written after the annotation pass, or never. */
    structured: RenderablePayload;
  }
>;

export const RETRIEVAL_PART_ID = "retrieval";
export const CITATIONS_PART_ID = "citations";
export const STRUCTURED_PART_ID = "structured";

/** Concatenate the text parts of a message. */
export function messageText(message: ChatUIMessage): string {
  return message.parts
    .filter((part): part is { type: "text"; text: string } => part.type === "text")
    .map((part) => part.text)
    .join("");
}

/** The most recent user question, which is what retrieval runs against. */
export function lastUserText(messages: readonly ChatUIMessage[]): string {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message.role === "user") return messageText(message).trim();
  }
  return "";
}
