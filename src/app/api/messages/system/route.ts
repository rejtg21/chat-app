import { z } from "zod";
import { ApiError, toErrorResponse } from "@/lib/errors";
import { insertSystemMessage } from "@/lib/repository";

/**
 * Persist a system message — the app's own note in the thread that it hit an
 * error worth remembering (a failed document switch, a retrieval failure, a
 * rejected upload).
 *
 * The client already shows the live error card; this is the durable half, so
 * the record survives a reload and sits in sequence with the surrounding
 * turns. The row's id and created_at are returned so the client can drop the
 * same message — timestamp and all — into the open thread without a refetch.
 */
export const runtime = "nodejs";

const bodySchema = z.object({
  chatId: z.string().min(1),
  content: z.string().min(1).max(2000),
});

export const POST = async (request: Request): Promise<Response> => {
  try {
    const parsed = bodySchema.safeParse(await request.json());
    if (!parsed.success) {
      throw new ApiError("ERR_BAD_REQUEST", "Malformed system message.", {
        detail: parsed.error.message,
      });
    }

    const { id, createdAt } = await insertSystemMessage(parsed.data);
    return Response.json({ id, createdAt });
  } catch (error) {
    return toErrorResponse(error);
  }
};
