import { config } from 'dotenv';
import { BraintrustSpanProcessor } from '@braintrust/otel';
import { NodeSDK } from '@opentelemetry/sdk-node';
import { trace } from '@opentelemetry/api';
import { google } from '@ai-sdk/google';
import { generateText } from 'ai';

// Load environment variables from .env.local
config({ path: '.env.local' });

console.log('Braintrust API Key present:', !!process.env.BRAINTRUST_API_KEY);
console.log('Google API Key present:', !!process.env.GOOGLE_GENERATIVE_AI_API_KEY);

// Initialize Braintrust with OpenTelemetry (matching production setup)
const sdk = new NodeSDK({
  serviceName: 'otel-cost-issue-repro',
  spanProcessors: [
    new BraintrustSpanProcessor({
      parent: 'project_name:otel-cost-issue-repro',
      filterAISpans: true,
    }),
  ],
});

sdk.start();
console.log('Braintrust OTEL SDK initialized\n');

async function main() {
  console.log('Running Gemini 3 Flash with caching...\n');

  // First call - this will create the cache
  console.log('Call 1: Creating cache...');
  const result1 = await generateText({
    model: google('gemini-3-flash-preview'),
    prompt: `You are a helpful assistant. Please read this long context carefully:

${'This is a very long piece of context that should be cached. '.repeat(500)}

Now answer: What is 2+2?`,
    experimental_telemetry: {
      isEnabled: true,
      functionId: 'test-gemini-caching-1',
    },
  });

  console.log('Result 1:', result1.text);
  console.log('Full Usage 1:', result1.usage);
  console.log('Usage 1:', {
    promptTokens: result1.usage.promptTokens,
    completionTokens: result1.usage.completionTokens,
    totalTokens: result1.usage.totalTokens,
  });

  const cost1 = calculateGemini3FlashCost({
    inputTokens: result1.usage.promptTokens,
    outputTokens: result1.usage.completionTokens,
    cachedInputTokens: 0,
  });
  console.log('Expected cost 1:', `$${cost1.toFixed(4)}\n`);

  // Add expected cost to trace
  const span1 = trace.getActiveSpan();
  if (span1) {
    span1.setAttribute('expected_cost', cost1);
    span1.setAttribute('expected_cost_usd', `$${cost1.toFixed(6)}`);
  }

  // Second call - this should use the cache
  console.log('Call 2: Using cache...');
  const result2 = await generateText({
    model: google('gemini-3-flash-preview'),
    prompt: `You are a helpful assistant. Please read this long context carefully:

${'This is a very long piece of context that should be cached. '.repeat(500)}

Now answer: What is 3+3?`,
    experimental_telemetry: {
      isEnabled: true,
      functionId: 'test-gemini-caching-2',
    },
  });

  console.log('Result 2:', result2.text);
  console.log('Full Usage 2:', result2.usage);
  console.log('Usage 2:', {
    promptTokens: result2.usage.promptTokens,
    completionTokens: result2.usage.completionTokens,
    totalTokens: result2.usage.totalTokens,
  });

  const cost2 = calculateGemini3FlashCost({
    inputTokens: result2.usage.promptTokens,
    outputTokens: result2.usage.completionTokens,
    cachedInputTokens: 0,
  });
  console.log('Expected cost 2:', `$${cost2.toFixed(4)}\n`);

  // Add expected cost to trace
  const span2 = trace.getActiveSpan();
  if (span2) {
    span2.setAttribute('expected_cost', cost2);
    span2.setAttribute('expected_cost_usd', `$${cost2.toFixed(6)}`);
  }

  const totalExpectedCost = cost1 + cost2;
  console.log('Expected total cost:', `$${totalExpectedCost.toFixed(4)}`);

  // Flush traces
  console.log('\nShutting down OTEL SDK to flush traces...');
  try {
    await sdk.shutdown();
    console.log('✓ SDK shutdown successfully, traces flushed');
  } catch (error) {
    console.error('✗ Error shutting down SDK:', error);
  }

  console.log('\nCheck Braintrust dashboard to compare:');
  console.log(`  Expected cost: $${totalExpectedCost.toFixed(6)}`);
  console.log('  Braintrust cost: (check dashboard)');
}

function calculateGemini3FlashCost({
  inputTokens,
  outputTokens,
  cachedInputTokens,
}: {
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
}): number {
  // Gemini 3 Flash pricing
  const INPUT_COST_PER_MIL = 0.5; // $0.50 per 1M tokens
  const CACHED_COST_PER_MIL = 0.05; // $0.05 per 1M tokens (10% of input)
  const OUTPUT_COST_PER_MIL = 3.0; // $3.00 per 1M tokens

  const uncachedInputTokens = inputTokens - cachedInputTokens;

  const uncachedCost = (uncachedInputTokens / 1_000_000) * INPUT_COST_PER_MIL;
  const cachedCost = (cachedInputTokens / 1_000_000) * CACHED_COST_PER_MIL;
  const outputCost = (outputTokens / 1_000_000) * OUTPUT_COST_PER_MIL;

  return uncachedCost + cachedCost + outputCost;
}

main().catch(console.error);
