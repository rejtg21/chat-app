import { z } from "zod";
import { ApiError, toErrorResponse } from "@/lib/errors";
import { updateMessageUiState } from "@/lib/repository";
import { messageUiStateSchema } from "@/lib/types";

/**
 * Persist per-message user state — checklist ticks and expanded evidence
 * cards.
 *
 * These are the user's own marks on an answer, not the model's output, so
 * they belong in the database alongside the message rather than in browser
 * storage. "Tick off the recommendations, come back tomorrow" only works if
 * the ticks survive.
 */
export const runtime = "nodejs";

const bodySchema = z.object({
  messageId: z.string().min(1),
  uiState: messageUiStateSchema,
});

export async function POST(request: Request): Promise<Response> {
  try {
    const parsed = bodySchema.safeParse(await request.json());
    if (!parsed.success) {
      throw new ApiError("ERR_BAD_REQUEST", "Malformed UI state update.", {
        detail: parsed.error.message,
      });
    }

    await updateMessageUiState(parsed.data.messageId, parsed.data.uiState);
    return Response.json({ ok: true });
  } catch (error) {
    return toErrorResponse(error);
  }
}
