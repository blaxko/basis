import "server-only";
import { z } from "zod";
import type { Side } from "../guardrails/check";
import { MVP_UNDERLYINGS } from "../data/quotes";
import { chatCompletion, type GroqChatMessage, type GroqChatResult } from "./groq-client";

// Deliberately narrower than ProposedOrder (lib/guardrails/check.ts):
// free text can convey what the user wants to trade, not the live
// market data (price, recent ticks, liquidity, adjusted spread) that
// order also carries. Merging this intent with fresh market data into a
// full ProposedOrder happens downstream of this phase, right before it
// is handed to check() — never here.
export interface OrderIntent {
  ticker: (typeof MVP_UNDERLYINGS)[number];
  side: Side;
  sizeUsd: number;
}

export type IntentParseError =
  | { kind: "llm_error"; message: string }
  | { kind: "invalid_json"; message: string }
  | { kind: "schema_validation"; message: string; issues: string[] };

export type IntentParseResult = { ok: true; intent: OrderIntent } | { ok: false; error: IntentParseError };

const OrderIntentSchema = z.object({
  ticker: z.enum(MVP_UNDERLYINGS),
  side: z.enum(["buy", "sell"]),
  sizeUsd: z.number().positive(),
});

const SYSTEM_PROMPT = `You parse a trader's free-text instruction into a structured order intent.
Respond with ONLY a JSON object of the form {"ticker": string, "side": "buy" | "sell", "sizeUsd": number}.
"ticker" must be one of: ${MVP_UNDERLYINGS.join(", ")}.
Do not include any explanation, markdown formatting, or extra fields — JSON only.`;

// Strips a ```json ... ``` (or plain ``` ... ```) fence if the model
// wrapped its response in one, despite the system prompt asking it not to.
function stripCodeFence(content: string): string {
  const fenced = content.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  return (fenced?.[1] ?? content).trim();
}

function parseChatResult(result: GroqChatResult): IntentParseResult {
  if (!result.ok) {
    return { ok: false, error: { kind: "llm_error", message: result.error.message } };
  }

  let raw: unknown;
  try {
    raw = JSON.parse(stripCodeFence(result.content));
  } catch {
    return { ok: false, error: { kind: "invalid_json", message: "Groq response was not valid JSON" } };
  }

  const parsed = OrderIntentSchema.safeParse(raw);
  if (!parsed.success) {
    // Never a best-effort guess dressed up as valid — a missing field, a
    // wrong type, or a ticker outside the confirmed 4-underlying list
    // all resolve to a typed parse failure here.
    return {
      ok: false,
      error: {
        kind: "schema_validation",
        message: "Groq response did not match the order intent schema",
        issues: parsed.error.issues.map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`),
      },
    };
  }

  return { ok: true, intent: parsed.data };
}

// Injectable so tests can mock the Groq call without needing live
// credentials, same pattern as Phase 3's walletClient injection.
export async function parseIntent(
  instruction: string,
  deps: { chatCompletion?: typeof chatCompletion } = {}
): Promise<IntentParseResult> {
  const doChatCompletion = deps.chatCompletion ?? chatCompletion;
  const messages: GroqChatMessage[] = [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: instruction },
  ];
  const result = await doChatCompletion(messages);
  return parseChatResult(result);
}
