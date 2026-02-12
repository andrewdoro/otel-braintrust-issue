import { config } from "dotenv";
import { BraintrustSpanProcessor } from "@braintrust/otel";
import { NodeSDK } from "@opentelemetry/sdk-node";
import { google } from "@ai-sdk/google";
import { Experimental_Agent as ToolLoopAgent, tool, stepCountIs } from "ai";
import { z } from "zod";

// Load environment variables from .env.local
config({ path: ".env.local" });

console.log("Braintrust API Key present:", !!process.env.BRAINTRUST_API_KEY);
console.log(
	"Google API Key present:",
	!!process.env.GOOGLE_GENERATIVE_AI_API_KEY,
);

// Initialize Braintrust with OpenTelemetry
const sdk = new NodeSDK({
	serviceName: "otel-cost-issue-tool-loop",
	spanProcessors: [
		new BraintrustSpanProcessor({
			parent: "project_name:otel-cost-issue-tool-loop",
			filterAISpans: true,
		}),
	],
});

sdk.start();
console.log("Braintrust OTEL SDK initialized\n");

// Paginated content — agent MUST call fetchPage sequentially since each page
// tells it what the next page number is and whether there's more.
const TOTAL_PAGES = 6;

function generatePageContent(page: number): string {
	const topics = [
		{
			title: "Introduction to Distributed Systems",
			body:
				`Distributed systems are collections of independent computers that appear to users as a single coherent system. ` +
				`They enable horizontal scaling, fault tolerance, and geographic distribution of services. ` +
				`Key challenges include network partitions, clock synchronization, consensus, and maintaining consistency across nodes. ` +
				`The CAP theorem states that a distributed system can only guarantee two of three properties: Consistency, Availability, and Partition tolerance. ` +
				`${"Modern distributed systems rely on protocols like Raft and Paxos for consensus, gossip protocols for membership, and vector clocks for causal ordering of events. ".repeat(250)}`,
		},
		{
			title: "Consensus Algorithms Deep Dive",
			body:
				`Raft is a consensus algorithm designed to be understandable. It separates the key elements of consensus into leader election, log replication, and safety. ` +
				`Paxos, while theoretically elegant, is notoriously difficult to implement correctly. Multi-Paxos extends single-decree Paxos to handle a sequence of values. ` +
				`${"Byzantine fault tolerance (BFT) algorithms like PBFT can tolerate up to f malicious nodes given 3f+1 total nodes, at the cost of O(n^2) message complexity per round. ".repeat(250)}`,
		},
		{
			title: "Database Replication Strategies",
			body:
				`Single-leader replication sends all writes to one node which streams changes to followers. This is simple but the leader is a bottleneck. ` +
				`Multi-leader replication allows writes on multiple nodes but introduces write conflicts that must be resolved. Last-write-wins (LWW) is simple but loses data. ` +
				`${"CRDTs (Conflict-free Replicated Data Types) enable automatic conflict resolution by ensuring that concurrent updates always converge to the same state regardless of ordering. ".repeat(250)}`,
		},
		{
			title: "Event Sourcing and CQRS Patterns",
			body:
				`Event sourcing stores all changes to application state as a sequence of events. Instead of storing current state, you store the history of state transitions. ` +
				`CQRS (Command Query Responsibility Segregation) separates read and write models, allowing each to be optimized independently. ` +
				`${"Event-driven architectures with message brokers like Kafka provide durability, replay capability, and decoupling between producers and consumers, enabling complex event processing pipelines. ".repeat(250)}`,
		},
		{
			title: "Observability and Monitoring at Scale",
			body:
				`The three pillars of observability are metrics, logs, and traces. OpenTelemetry provides a vendor-neutral standard for collecting all three. ` +
				`Distributed tracing connects spans across service boundaries using context propagation, enabling end-to-end latency analysis. ` +
				`${"Effective cost tracking in observability platforms requires accurate attribution of resource usage including cached vs uncached token counts, which is critical for LLM-based applications. ".repeat(250)}`,
		},
		{
			title: "Cost Optimization for LLM Applications",
			body:
				`LLM cost optimization starts with understanding token pricing tiers: input tokens, cached input tokens, and output tokens each have different rates. ` +
				`Prompt caching can reduce costs by 75-90% on repeated prefixes. Tool loop agents are especially impacted because each step re-sends the full conversation history. ` +
				`${"When observability platforms miscalculate cached token costs by charging full input token rates instead of discounted cached rates, the reported costs can be significantly inflated compared to actual provider billing. ".repeat(250)}`,
		},
	];

	const topic = topics[page - 1];
	return JSON.stringify({
		page,
		totalPages: TOTAL_PAGES,
		hasMore: page < TOTAL_PAGES,
		nextPage: page < TOTAL_PAGES ? page + 1 : null,
		title: topic.title,
		content: topic.body,
		metadata: {
			wordCount: topic.body.split(" ").length,
			readingTimeMinutes: Math.ceil(topic.body.split(" ").length / 200),
			lastUpdated: new Date().toISOString(),
			author: "Systems Research Team",
			tags: ["distributed-systems", "architecture", "engineering"],
		},
	});
}

let toolCallCount = 0;

const researchAgent = new ToolLoopAgent({
	model: google("gemini-3-flash-preview"),
	instructions: `You are a research assistant that reads paginated content.
You have a fetchPage tool that retrieves one page at a time from a document.
When asked to read a document, you MUST fetch ALL pages sequentially starting from page 1.
Each page response tells you the totalPages and whether hasMore is true.
Keep calling fetchPage with the nextPage number until you have read every page.
Only after reading ALL pages should you provide your summary.`,
	stopWhen: stepCountIs(15),
	tools: {
		fetchPage: tool({
			description:
				"Fetch a single page of content from the document. Returns the page content and pagination info. You must call this sequentially for each page.",
			inputSchema: z.object({
				page: z.number().describe("The page number to fetch (starts at 1)"),
			}),
			execute: async ({ page }) => {
				toolCallCount++;
				console.log(`  [Tool call #${toolCallCount}] fetchPage(${page})`);
				if (page < 1 || page > TOTAL_PAGES) {
					return {
						error: `Page ${page} not found. Valid pages: 1-${TOTAL_PAGES}`,
					};
				}
				return generatePageContent(page);
			},
		}),
	},
	experimental_telemetry: {
		isEnabled: true,
		functionId: "research-agent",
	},
});

async function main() {
	console.log("Running ToolLoopAgent with Gemini 3 Flash Preview...\n");
	console.log(
		`Document has ${TOTAL_PAGES} pages. Agent must fetch them sequentially.`,
	);
	console.log(
		"Each page returns large content. Context grows with every step.\n",
	);

	const prompt = `Read the entire document by fetching all pages starting from page 1. After reading everything, give me a 2-sentence summary of each section.`;

	console.log(`Prompt: "${prompt}"\n`);

	const result = await researchAgent.generate({
		prompt,
		onStepFinish: (step) => {
			console.log(
				`  [Step] input=${step.usage.inputTokens} output=${step.usage.outputTokens} cacheRead=${step.usage.inputTokenDetails.cacheReadTokens ?? 0} cacheWrite=${step.usage.inputTokenDetails.cacheWriteTokens ?? 0}`,
			);
		},
	});

	console.log(`\nAnswer:`, result.text.slice(0, 500) + "...\n");

	const totalUsage = result.totalUsage;
	console.log("Total usage:", {
		inputTokens: totalUsage.inputTokens,
		outputTokens: totalUsage.outputTokens,
		cacheReadTokens: totalUsage.inputTokenDetails.cacheReadTokens ?? 0,
		cacheWriteTokens: totalUsage.inputTokenDetails.cacheWriteTokens ?? 0,
	});
	console.log(`Tool calls: ${toolCallCount}, Steps: ${result.steps.length}`);

	// Per-step breakdown
	console.log("\nPer-step breakdown:");
	for (let i = 0; i < result.steps.length; i++) {
		const s = result.steps[i];
		console.log(
			`  Step ${i + 1}: input=${s.usage.inputTokens} output=${s.usage.outputTokens} cacheRead=${s.usage.inputTokenDetails.cacheReadTokens ?? 0}`,
		);
	}

	const cost = calculateGemini3FlashCost({
		inputTokens: totalUsage.inputTokens ?? 0,
		outputTokens: totalUsage.outputTokens ?? 0,
		cachedInputTokens: totalUsage.inputTokenDetails.cacheReadTokens ?? 0,
	});
	console.log(`\nExpected cost: $${cost.toFixed(6)}`);

	// Flush traces
	console.log("\nShutting down OTEL SDK to flush traces...");
	try {
		await sdk.shutdown();
		console.log("SDK shutdown complete, traces flushed.");
	} catch (error) {
		console.error("Error shutting down SDK:", error);
	}

	console.log(
		"\nCheck Braintrust dashboard (project: otel-cost-issue-tool-loop)",
	);
	console.log(
		"Look for cost discrepancies especially on steps with high cacheReadTokens.",
	);
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
	// Gemini 3 Flash Preview pricing (per 1M tokens)
	// https://ai.google.dev/gemini-api/docs/pricing
	const INPUT_COST_PER_MIL = 0.5;
	const CACHED_COST_PER_MIL = 0.05; // 10% of input cost
	const OUTPUT_COST_PER_MIL = 3.0;

	const uncachedInputTokens = inputTokens - cachedInputTokens;
	const uncachedCost = (uncachedInputTokens / 1_000_000) * INPUT_COST_PER_MIL;
	const cachedCost = (cachedInputTokens / 1_000_000) * CACHED_COST_PER_MIL;
	const outputCost = (outputTokens / 1_000_000) * OUTPUT_COST_PER_MIL;

	return uncachedCost + cachedCost + outputCost;
}

main().catch(console.error);
