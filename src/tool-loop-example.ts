import { config } from 'dotenv';
import { BraintrustSpanProcessor } from '@braintrust/otel';
import { NodeSDK } from '@opentelemetry/sdk-node';
import { google } from '@ai-sdk/google';
import { generateText } from 'ai';
import { z } from 'zod';

// Load environment variables from .env.local
config({ path: '.env.local' });

// Initialize Braintrust with OpenTelemetry (matching production setup)
const sdk = new NodeSDK({
  serviceName: 'otel-cost-issue-tool-loop',
  spanProcessors: [
    new BraintrustSpanProcessor({
      parent: 'project_name:otel-cost-issue-tool-loop',
      filterAISpans: true,
    }),
  ],
});

sdk.start();

async function main() {
  console.log('Running generateText with tools, Gemini 3 Flash and caching...\n');

  const systemPrompt = `You are a helpful assistant. Here is some context that should be cached:

${'This is important context information. '.repeat(1000)}

Always use the getWeather tool when asked about weather.`;

  // First call
  console.log('Call 1: Making first request...');
  const result1 = await generateText({
    model: google('gemini-3-flash-preview'),
    system: systemPrompt,
    prompt: 'What is the weather in San Francisco?',
    tools: {
      getWeather: {
        description: 'Get the weather for a location',
        parameters: z.object({
          location: z.string().describe('The location to get weather for'),
        }),
        execute: async ({ location }) => {
          console.log(`[Tool] Getting weather for: ${location}`);
          return {
            location,
            temperature: 72,
            condition: 'sunny',
          };
        },
      },
    },
    maxSteps: 5,
    experimental_telemetry: {
      isEnabled: true,
      functionId: 'test-gemini-tools-1',
    },
  });

  console.log('Result 1:', result1.text);
  console.log('Usage 1:', {
    promptTokens: result1.usage.promptTokens,
    completionTokens: result1.usage.completionTokens,
    cachedPromptTokens: (result1.usage as any).cachedPromptTokens || 0,
  });

  const cost1 = calculateGemini3FlashCost({
    inputTokens: result1.usage.promptTokens,
    outputTokens: result1.usage.completionTokens,
    cachedInputTokens: (result1.usage as any).cachedPromptTokens || 0,
  });
  console.log('Expected cost 1:', `$${cost1.toFixed(4)}\n`);

  // Second call - should use cache
  console.log('Call 2: Making second request (should use cache)...');
  const result2 = await generateText({
    model: google('gemini-3-flash-preview'),
    system: systemPrompt,
    prompt: 'What is the weather in New York?',
    tools: {
      getWeather: {
        description: 'Get the weather for a location',
        parameters: z.object({
          location: z.string().describe('The location to get weather for'),
        }),
        execute: async ({ location }) => {
          console.log(`[Tool] Getting weather for: ${location}`);
          return {
            location,
            temperature: 65,
            condition: 'cloudy',
          };
        },
      },
    },
    maxSteps: 5,
    experimental_telemetry: {
      isEnabled: true,
      functionId: 'test-gemini-tools-2',
    },
  });

  console.log('Result 2:', result2.text);
  console.log('Usage 2:', {
    promptTokens: result2.usage.promptTokens,
    completionTokens: result2.usage.completionTokens,
    cachedPromptTokens: (result2.usage as any).cachedPromptTokens || 0,
  });

  const cost2 = calculateGemini3FlashCost({
    inputTokens: result2.usage.promptTokens,
    outputTokens: result2.usage.completionTokens,
    cachedInputTokens: (result2.usage as any).cachedPromptTokens || 0,
  });
  console.log('Expected cost 2:', `$${cost2.toFixed(4)}\n`);

  // Shutdown SDK to flush traces
  await sdk.shutdown();

  console.log('\nCheck Braintrust dashboard to see if costs match expected values.');
  console.log('Expected total cost:', `$${(cost1 + cost2).toFixed(4)}`);
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
