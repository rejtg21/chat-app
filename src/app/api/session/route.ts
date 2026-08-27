import { ApiError, toErrorResponse } from "@/lib/errors";
import {
  buildOutline,
  getChunks,
  getCurrentDocument,
  getDocument,
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
 *
 * With `?documentId=…` it instead restores that specific document's chat
 * room — this is how the document dropdown switches between conversations.
 * Without it, the most recently indexed document wins, as before.
 */
export const runtime = "nodejs";

export const GET = async (request: Request): Promise<Response> => {
  try {
    const requestedId = new URL(request.url).searchParams.get("documentId");
    const document = requestedId
      ? await getDocument(requestedId)
      : await getCurrentDocument();

    if (requestedId && (!document || document.status !== "ready")) {
      throw new ApiError("ERR_NOT_FOUND", "That document is not available.", {
        detail: `document ${requestedId} is ${document?.status ?? "missing"}`,
      });
    }

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
};
