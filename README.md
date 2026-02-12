# Braintrust OTEL Cost Calculation Issue — Cached Tokens in Tool Loop Agents

Minimal reproduction showing that Braintrust's cost calculation via OpenTelemetry ignores cached input token discounts for tool loop agents using Gemini 3 Flash Preview.

## The Problem

When a `ToolLoopAgent` (AI SDK v6) runs multiple steps, each step re-sends the full conversation history to the model. Gemini automatically caches repeated prefix content, so later steps report a significant portion of input tokens as **cached** (at 10% of the normal input price). Braintrust appears to charge all input tokens at the full rate, inflating reported costs.

### Pricing (Gemini 3 Flash Preview)

| Token Type | Cost per 1M tokens |
|---|---|
| Input (uncached) | $0.50 |
| Input (cached) | $0.05 (10% of input) |
| Output (incl. thinking) | $3.00 |

Source: https://ai.google.dev/gemini-api/docs/pricing

### What the repro shows

The agent fetches 6 pages of large content sequentially, producing 7 steps with growing context:

| Step | Input Tokens | Cached Tokens | % Cached |
|------|-------------|---------------|----------|
| 1-3  | 200 → 18k   | 0             | 0%       |
| 4    | ~26k        | ~16k          | 62%      |
| 5    | ~34k        | ~24k          | 73%      |
| 6    | ~42k        | ~33k          | 79%      |
| 7    | ~50k        | ~41k          | 82%      |

**Totals:** ~178k input tokens, ~114k cached (64%)

- **Expected cost** (with cache discount): ~$0.04
- **Cost if caching ignored** (all input at full rate): ~$0.09
- **Braintrust reported cost:** check dashboard — expected to be closer to the inflated number

## Setup

1. Install dependencies:
```bash
npm install
```

2. Create a `.env.local` file:
```
BRAINTRUST_API_KEY=your_braintrust_api_key
GOOGLE_GENERATIVE_AI_API_KEY=your_google_api_key
```

3. Run:
```bash
npm start
```

## What to check

After running, go to the Braintrust dashboard:

1. Open https://www.braintrust.dev
2. Find project: **otel-cost-issue-tool-loop**
3. Look at the trace from the run
4. Compare the **Braintrust reported cost** against the **expected cost** printed in the console
5. In the per-step spans, check whether `cacheReadTokens` are factored into the cost or ignored

If Braintrust reports a cost roughly 2x the expected cost, it confirms that cached tokens are being charged at the full input rate.

## How it works

- **`src/tool-loop-example.ts`** — Single file, single run
- Uses `ToolLoopAgent` from AI SDK v6 with `@braintrust/otel` for OpenTelemetry tracing
- Agent is instructed to read a 6-page document by calling `fetchPage` sequentially (one page per tool call)
- Each page returns ~5-8k tokens of content, so context grows from ~200 tokens (step 1) to ~50k tokens (step 7)
- Gemini's implicit caching kicks in around step 4 once the prefix is large enough
- The script logs per-step token usage including `cacheReadTokens` and computes the expected cost using official Gemini pricing

## Stack

- AI SDK v6 (`ai@^6.0.82`) — `ToolLoopAgent`, `tool`, `stepCountIs`
- `@ai-sdk/google` — Gemini 3 Flash Preview
- `@braintrust/otel` — Braintrust OpenTelemetry span processor
- `@opentelemetry/sdk-node` — OpenTelemetry Node SDK
