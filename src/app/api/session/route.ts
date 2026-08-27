import { toErrorResponse } from "@/lib/errors";
import {
  buildOutline,
  getChunks,
  getCurrentDocument,
  getMessages,
  getOrCreateChat,
} from "@/lib/repository";
import type { SessionPayload } from "@/lib/types";

/**
 * Restore the whole app state from the database.
 *
 * This is what makes reload durability real rather than a localStorage
 * illusion: the document, its chunks, its outline and the entire
 * conversation are read back from Neon, keyed by the current document.
 */
export const runtime = "nodejs";

export async function GET(): Promise<Response> {
  try {
    const document = await getCurrentDocument();

    if (!document) {
      const empty: SessionPayload = {
        document: null,
        chunks: [],
        outline: [],
        chatId: null,
        messages: [],
      };
      return Response.json(empty, { headers: { "Cache-Control": "no-store" } });
    }

    const [chunks, chatId] = await Promise.all([
      getChunks(document.id),
      getOrCreateChat(document.id),
    ]);

    const payload: SessionPayload = {
      document,
      chunks,
      outline: buildOutline(chunks),
      chatId,
      messages: await getMessages(chatId),
    };

    return Response.json(payload, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return toErrorResponse(error);
  }
}
