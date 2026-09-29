"use client";

import { useState } from "react";
import { describeInstructionResult, type InstructionOutcomeText } from "./instruction-result";

// Clickable examples: the text that fills the box, and a hint about what
// it shows. Hints carry no numbers: limits come from the server's reply.
const EXAMPLES: ReadonlyArray<{ text: string; hint: string }> = [
  { text: "Buy $200 of MSFT", hint: "a normal order" },
  { text: "Buy $1000 of MSFT", hint: "over the per-trade cap" },
  { text: "Buy $100 of NVDA", hint: "no verified pools" },
  { text: "Sell $50 of MSFT", hint: "sells are refused" },
];

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
    } catch {
      // Network failure: no HTTP status. describeInstructionResult words
      // it; the browser's own error text is never shown.
      body = null;
    } finally {
      setReply({ httpStatus, body, text: describeInstructionResult(httpStatus, body) });
      setSending(false);
    }
  }

  return (
    <section className="panel instruction-panel" id="instruction">
      <div className="panel-head">
        <h2 className="panel-title">Instruction</h2>
        <span className="pill pill--plain">AI reads it · guardrails decide</span>
      </div>

      <form
        className="instruction-form"
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
      >
        <label className="prompt">
          <span className="prompt-caret mono" aria-hidden="true">
            &gt;
          </span>
          <input
            className="instruction-input"
            type="text"
            value={instruction}
            onChange={(e) => setInstruction(e.target.value)}
            placeholder="e.g. Buy $200 of MSFT"
            maxLength={200}
            aria-label="Instruction"
          />
        </label>
        <button className="instruction-send" type="submit" disabled={sending || !instruction.trim()}>
          {sending ? "Sending…" : "Send"}
        </button>
      </form>

      <p className="instruction-help">The AI only reads your sentence; the guardrails decide. Other languages work too.</p>

      <div className="instruction-examples">
        <span className="examples-label">Try:</span>
        {EXAMPLES.map((example) => (
          <button key={example.text} type="button" className="instruction-example" onClick={() => setInstruction(example.text)}>
            <span className="mono">{example.text}</span>
            <span className="example-hint">{example.hint}</span>
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
