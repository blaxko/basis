"use client";

import { useState } from "react";
import { describeInstructionResult, type InstructionOutcomeText } from "./instruction-result";

const EXAMPLES = ["Buy $200 of MSFT", "Buy $1000 of MSFT", "Buy $100 of NVDA"];

interface Reply {
  httpStatus: number | null;
  body: unknown;
  text: InstructionOutcomeText;
}

// Type an instruction in plain English; the server reads it with the AI
// and runs it through the same guardrails as the automatic loop.
export function InstructionBox() {
  const [instruction, setInstruction] = useState("");
  const [sending, setSending] = useState(false);
  const [reply, setReply] = useState<Reply | null>(null);

  async function send() {
    const text = instruction.trim();
    if (!text || sending) return;
    setSending(true);
    setReply(null);
    let httpStatus: number | null = null;
    let body: unknown = null;
    try {
      const res = await fetch("/api/instruction", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ instruction: text }),
      });
      httpStatus = res.status;
      const raw = await res.text();
      try {
        body = JSON.parse(raw);
      } catch {
        body = raw;
      }
    } catch (err) {
      body = { message: err instanceof Error ? err.message : String(err) };
    } finally {
      setReply({ httpStatus, body, text: describeInstructionResult(httpStatus, body) });
      setSending(false);
    }
  }

  return (
    <section className="panel instruction-panel">
      <h2 className="panel-title">Give an instruction</h2>

      <p className="instruction-help">
        Type an order in plain English. The AI only reads your sentence into a stock, buy or sell, and a dollar amount;
        whether anything happens is decided by the guardrails and live market data, never by the AI.
      </p>

      <form
        className="instruction-form"
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
      >
        <input
          className="instruction-input"
          type="text"
          value={instruction}
          onChange={(e) => setInstruction(e.target.value)}
          placeholder="e.g. Buy $200 of MSFT"
          maxLength={200}
          aria-label="Instruction"
        />
        <button className="instruction-send" type="submit" disabled={sending || !instruction.trim()}>
          {sending ? "Sending…" : "Send"}
        </button>
      </form>

      <div className="instruction-examples">
        <span>Try:</span>
        {EXAMPLES.map((example) => (
          <button key={example} type="button" className="instruction-example" onClick={() => setInstruction(example)}>
            {example}
          </button>
        ))}
      </div>

      {reply && (
        <div className={`instruction-result instruction-result--${reply.text.tone}`} role="status">
          <p className="instruction-headline">{reply.text.headline}</p>
          {reply.text.detail && <p className="instruction-detail">{reply.text.detail}</p>}
          <details className="instruction-raw">
            <summary>Raw reply{reply.httpStatus !== null ? ` (HTTP ${reply.httpStatus})` : ""}</summary>
            <pre>{typeof reply.body === "string" ? reply.body : JSON.stringify(reply.body, null, 2)}</pre>
          </details>
        </div>
      )}
    </section>
  );
}
