import { NextResponse } from "next/server";
import { z } from "zod";
import { handleInstruction } from "../../../lib/orchestration/handle-instruction";

const BodySchema = z.object({
  instruction: z.string().min(1),
});

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "request body must be JSON" }, { status: 400 });
  }

  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "body must be { instruction: string }" }, { status: 400 });
  }

  const result = await handleInstruction(parsed.data.instruction);

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 422 });
  }

  return NextResponse.json(result);
}
