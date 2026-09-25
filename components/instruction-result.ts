// Turns a reply from POST /api/instruction into one plain-language
// sentence for the instruction box. Pure, so every case is tested
// (test/instruction-result.test.ts). It only rephrases what the server
// decided; it never re-decides anything.

export type ResultTone = "approved" | "blocked" | "info" | "error";

export interface InstructionOutcomeText {
  tone: ResultTone;
  headline: string;
  detail?: string;
}

// What the guardrail checks are, in plain words, for "Blocked by …".
const CHECK_NAMES: Record<string, string> = {
  sanityAndLiquidity: "the price-sanity and liquidity check",
  marketStatus: "the market-status check",
  referencePrice: "the Binance reference-price check",
  perTradeCap: "the per-trade limit",
  dailyCap: "the daily spending limit",
  dryRunFloor: "the simulated-output floor",
};

function pct(value: unknown): string {
  const n = typeof value === "number" && Number.isFinite(value) ? value : NaN;
  if (Number.isNaN(n)) return "unknown";
  return `${n > 0 ? "+" : ""}${(n * 100).toFixed(2)}%`;
}

type Json = Record<string, unknown>;
const obj = (v: unknown): Json => (v && typeof v === "object" ? (v as Json) : {});
const str = (v: unknown): string => (typeof v === "string" ? v : "");

export function describeInstructionResult(httpStatus: number | null, body: unknown): InstructionOutcomeText {
  if (httpStatus === null) {
    return { tone: "error", headline: "Couldn't reach the server.", detail: str(obj(body).message) || undefined };
  }

  const b = obj(body);

  if (httpStatus === 429) {
    return {
      tone: "error",
      headline: "Too many requests, wait a minute and try again.",
      detail: "This public demo accepts up to 5 instructions a minute from each visitor.",
    };
  }

  if (httpStatus === 400) {
    return { tone: "error", headline: "Please type an instruction first, for example: Buy $200 of MSFT." };
  }

  if (httpStatus === 422) {
    const e = obj(b.error);
    switch (e.kind) {
      case "warming_up": {
        const readings = Number(e.readings);
        const required = Number(e.required);
        const missing = Number.isFinite(readings) && Number.isFinite(required) ? Math.max(0, required - readings) : NaN;
        const minutes = Number.isFinite(missing) ? Math.max(1, Math.ceil((missing * 30) / 60)) : NaN;
        return {
          tone: "info",
          headline: `Still warming up: ${Number.isFinite(readings) ? readings : "?"} of ${Number.isFinite(required) ? required : "?"} price readings collected.`,
          detail:
            "After every restart Basis collects one price reading every 30 seconds before it will judge any order, so a strange price can't slip through." +
            (Number.isFinite(minutes) ? ` Try again in about ${minutes} minute${minutes === 1 ? "" : "s"}.` : ""),
        };
      }
      case "pool_resolution_failed":
        return {
          tone: "info",
          headline: `No pools known for ${str(e.ticker) || "that stock"}; Basis won't guess.`,
          detail: "Basis only trades tokens whose exchange pools it has verified on-chain. Today that's MSFT (MSFTB).",
        };
      case "llm_error":
        return {
          tone: "error",
          headline: "The AI couldn't read the instruction right now, so nothing was evaluated.",
          detail: str(e.message) || undefined,
        };
      case "invalid_json":
      case "schema_validation":
        return {
          tone: "error",
          headline: "The AI couldn't turn that into an order (a stock, buy or sell, and a dollar amount).",
          detail: "Try something like: Buy $200 of MSFT.",
        };
      default:
        return { tone: "error", headline: "The instruction was refused.", detail: str(e.message) || undefined };
    }
  }

  if (httpStatus !== 200 || b.ok !== true) {
    return { tone: "error", headline: `Unexpected reply from the server (HTTP ${httpStatus}).`, detail: str(b.error) || undefined };
  }

  const verdict = obj(b.verdict);
  const order = obj(b.order);
  const edge = pct(order.adjustedSpread);
  const outcome = str(b.outcome);

  if (verdict.approved !== true) {
    const blockedBy = str(verdict.blockedBy);
    const reason = str(verdict.reason);
    if (verdict.status === "error") {
      return { tone: "blocked", headline: "Blocked: the guardrail check hit an internal error, so it failed safe.", detail: reason || undefined };
    }
    return {
      tone: "blocked",
      headline: `Blocked by ${blockedBy || "a guardrail"}: ${reason || "a check failed"}.`,
      detail: blockedBy && CHECK_NAMES[blockedBy] ? `That's ${CHECK_NAMES[blockedBy]}. Nothing was sent.` : "Nothing was sent.",
    };
  }

  const approved = "Approved by all guardrails";
  switch (outcome) {
    case "no_edge":
      return {
        tone: "approved",
        headline: `${approved}, but not sent: net edge ${edge} is below zero.`,
        detail: "After both pools' fees, slippage and gas, this trade would lose money, so Basis doesn't make it.",
      };
    case "tolerance_exceeds_edge":
      return {
        tone: "approved",
        headline: `${approved}, but not sent: net edge ${edge} is too small to protect on-chain.`,
        detail: "The swap's minimum-output protection would cost more than the edge is worth.",
      };
    case "simulated":
      return {
        tone: "approved",
        headline: `${approved}. Simulation mode: checks only, nothing sent.`,
        detail: `Net edge ${edge}.`,
      };
    case "two_leg_execution_not_implemented":
      return {
        tone: "approved",
        headline: `${approved}, but not sent: live arbitrage is switched off.`,
        detail: "Only one half of the trade (the buy) is built, and one half alone doesn't capture the gap.",
      };
    case "spread_closed":
      return { tone: "approved", headline: `${approved}, but not sent: the gap closed when the pools were re-read.` };
    case "dry_run_only":
      return { tone: "approved", headline: `${approved} and rehearsed (dry-run). Nothing sent in dry-run mode.`, detail: `Net edge ${edge}.` };
    case "dry_run_failed":
      return { tone: "blocked", headline: "Approved, but the rehearsal failed, so nothing was sent." };
    case "approval_failed":
    case "send_failed":
      return { tone: "blocked", headline: "Approved, but sending failed. Check the Audit Ledger." };
    case "executed":
      return { tone: "approved", headline: "Approved and sent." };
    default:
      return { tone: "info", headline: `${approved}. Outcome: ${outcome || "unknown"}.` };
  }
}
