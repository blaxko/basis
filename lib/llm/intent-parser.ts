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

// Which part of the order was missing or wrong, so the dashboard can say
// so in one plain sentence instead of "couldn't read it":
//   amount       — no dollar amount, or not above $0
//   ticker       — a stock outside MVP_UNDERLYINGS
//   side         — neither buy nor sell
//   not_an_order — none of the three (nonsense, or not JSON at all)
export type IntentProblem = "amount" | "ticker" | "side" | "not_an_order";

export type IntentParseError =
  | { kind: "llm_error"; message: string }
  | { kind: "invalid_json"; message: string; problem: "not_an_order" }
  | { kind: "schema_validation"; message: string; issues: string[]; problem: IntentProblem };

export type IntentParseResult = { ok: true; intent: OrderIntent } | { ok: false; error: IntentParseError };

const OrderIntentSchema = z.object({
  ticker: z.enum(MVP_UNDERLYINGS),
  side: z.enum(["buy", "sell"]),
  sizeUsd: z.number().positive(),
});

const SYSTEM_PROMPT = `You parse a trader's free-text instruction into a structured order intent.
The instruction may be written in any language; company names map to tickers (e.g. Microsoft -> MSFT).
Respond with ONLY a JSON object of the form {"ticker": string | null, "side": "buy" | "sell" | null, "sizeUsd": number | null}.
"ticker" must be one of: ${MVP_UNDERLYINGS.join(", ")}; for any other stock, use its own ticker symbol.
Use null for any field the instruction doesn't state. Never guess an amount: "sizeUsd" is the US dollar amount written in the instruction, or null.
Do not include any explanation, markdown formatting, or extra fields — JSON only.`;

// Which field failed, from the model's raw JSON. Nothing is coerced or
// guessed: this only names the problem for the error message.
function classifyProblem(raw: unknown): IntentProblem {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const tickerOk = typeof r.ticker === "string" && (MVP_UNDERLYINGS as readonly string[]).includes(r.ticker);
  const tickerStated = typeof r.ticker === "string" && r.ticker.trim() !== "";
  const sideOk = r.side === "buy" || r.side === "sell";
  const amountOk = typeof r.sizeUsd === "number" && Number.isFinite(r.sizeUsd) && r.sizeUsd > 0;
  const amountStated = typeof r.sizeUsd === "number";
  if (!tickerStated && !sideOk && !amountStated) return "not_an_order";
  if (!amountOk) return "amount";
  if (!tickerOk) return "ticker";
  return "side";
}

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
    return { ok: false, error: { kind: "invalid_json", message: "Groq response was not valid JSON", problem: "not_an_order" } };
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
        problem: classifyProblem(raw),
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
