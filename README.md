# Braintrust OTEL Cost Calculation Issue

This is a minimal reproduction example for the Braintrust cost calculation issue with OpenTelemetry and Gemini 3 Flash caching.

## Issue

When using AI SDK with experimental telemetry and Braintrust's OpenTelemetry integration, the cost calculation for Gemini 3 Flash appears to be incorrect when cached tokens are involved.

### Expected Behavior

For Gemini 3 Flash:
- Input (Uncached): $0.50 / 1M tokens
- Cached Read: $0.05 / 1M tokens (10% of input cost)
- Output: $3.00 / 1M tokens

**Example calculation:**
- Prompt tokens: 4,133,765
- Cached tokens: 3,558,755
- Uncached tokens: 575,010 (4,133,765 - 3,558,755)
- Completion tokens: 13,041

Expected cost:
- Uncached: 575,010 / 1,000,000 × $0.50 = $0.2875
- Cached: 3,558,755 / 1,000,000 × $0.05 = $0.1779
- Output: 13,041 / 1,000,000 × $3.00 = $0.0391
- **Total: ~$0.50**

### Actual Behavior

Braintrust dashboard shows: **$2.80** (approximately 5.6x higher)

## Setup

1. Install dependencies:
```bash
npm install
```

2. Set environment variables:
```bash
export BRAINTRUST_API_KEY=your_api_key
export GOOGLE_GENERATIVE_AI_API_KEY=your_google_api_key
```

3. Run the examples:

```bash
# Simple example
npm start

# Tool loop example (more similar to production usage)
npx tsx src/tool-loop-example.ts
```

## What to Check

After running the examples:

1. Check the console output for the calculated costs (note: cached tokens may not be visible in console but are sent via OTEL)
2. Go to your Braintrust dashboard at https://www.braintrust.dev
3. Find the traces for the project `otel-cost-issue-repro` or `otel-cost-issue-tool-loop`
4. Compare the costs shown in Braintrust with the expected costs from console
5. Look at the trace details to see:
   - How many tokens were cached vs uncached
   - What cost Braintrust calculated
   - Compare with the expected cost formula

**Note:** Gemini's automatic caching information is sent via OpenTelemetry to Braintrust, but may not be visible in the console `usage` object from the AI SDK. The issue is in how Braintrust calculates costs from the OTEL trace data.

## Files

- [src/index.ts](src/index.ts) - Simple generateText example with caching
- [src/tool-loop-example.ts](src/tool-loop-example.ts) - ToolLoopAgent example (closer to production usage)

## Notes

- This example uses **AI SDK experimental telemetry** with **@braintrust/otel** (matching production setup), NOT `wrapAISDK`
- The cost calculation function in the examples matches the formula from Gemini's pricing page
- Gemini 3 Flash uses automatic caching (implicit caching), not explicit cache control
- The tool-loop example currently has issues with Gemini 3 Flash preview requiring thought signatures - use the simple example to demonstrate the cost issue

## Checking Braintrust Dashboard

After running the simple example (`npm start`), check:

1. Go to https://www.braintrust.dev
2. Look for the project: **otel-cost-issue-repro**
3. Find the traces from today
4. Each trace now includes custom attributes:
   - `expected_cost`: The correct cost calculated using Gemini 3 Flash pricing
   - `expected_cost_usd`: Formatted USD string of the expected cost
5. Compare the estimated cost shown in Braintrust vs the `expected_cost` attribute
6. Check the token breakdown to see if cached tokens are being accounted for correctly

**Expected vs Actual:**
- Expected total cost: **~$0.0066**
- Braintrust should show this in the trace attributes for easy comparison
