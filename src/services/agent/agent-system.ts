// =============================================================================
// DeepAnalyze - Agent System Singleton
// =============================================================================
// Lazily-initialized singleton that wires up the full agent pipeline:
// ModelRouter -> EmbeddingManager -> Indexer/Linker/Retriever/Expander ->
// ToolRegistry -> AgentRunner -> Orchestrator.
//
// This avoids circular dependencies and initialization order issues by
// deferring all heavy imports until the first request that needs the agent
// system.
// =============================================================================

import type { Orchestrator } from "./orchestrator.js";
import type { KnowledgeCompounder } from "../../wiki/knowledge-compound.js";
import type { PluginManager } from "../plugins/plugin-manager.js";
import type { Retriever } from "../../wiki/retriever.js";

/** Singleton orchestrator instance. */
let orchestratorInstance: Orchestrator | null = null;

/** Singleton compounder instance. */
let compounderInstance: KnowledgeCompounder | null = null;

/** Singleton plugin manager instance. */
let pluginManagerInstance: PluginManager | null = null;

/** Singleton retriever instance. */
let retrieverInstance: Retriever | null = null;

/** Initialization promise so concurrent callers don't duplicate work. */
let initPromise: Promise<Orchestrator> | null = null;

/**
 * Get (or lazily initialize) the singleton Orchestrator instance.
 *
 * The first call triggers the full initialization pipeline:
 *   1. ModelRouter (reads YAML config, sets up providers)
 *   2. EmbeddingManager (uses ModelRouter for embeddings or hash fallback)
 *   3. Indexer, Linker, Retriever, Expander (wiki subsystem)
 *   4. ToolRegistry (via createConfiguredToolRegistry)
 *   5. AgentRunner (registers all built-in agents)
 *   6. KnowledgeCompounder
 *   7. Orchestrator (with auto-dream support)
 *
 * Subsequent calls return the same cached instance.
 */
export async function getOrchestrator(): Promise<Orchestrator> {
  if (orchestratorInstance) {
    return orchestratorInstance;
  }

  // If initialization is already in progress, await it rather than starting
  // a second initialization.
  if (initPromise) {
    return initPromise;
  }

  initPromise = initializeOrchestrator();

  try {
    orchestratorInstance = await initPromise;
    return orchestratorInstance;
  } catch (err) {
    // Reset so a future call can retry
    initPromise = null;
    throw err;
  }
}

/**
 * Check if the orchestrator has been initialized.
 */
export function isOrchestratorReady(): boolean {
  return orchestratorInstance !== null;
}

/**
 * Reset the singleton (useful for tests or reconfiguration).
 */
export function resetOrchestrator(): void {
  orchestratorInstance = null;
  compounderInstance = null;
  pluginManagerInstance = null;
  retrieverInstance = null;
  initPromise = null;
}

// ---------------------------------------------------------------------------
// Knowledge Compounder
// ---------------------------------------------------------------------------

/**
 * Get (or lazily initialize) the singleton KnowledgeCompounder instance.
 *
 * The compounder is initialized alongside the Orchestrator during the first
 * call to `getOrchestrator()`. If the orchestrator has not been initialized
 * yet, this will trigger the full initialization pipeline.
 */
export async function getCompounder(): Promise<KnowledgeCompounder> {
  // Ensure the orchestrator (and thus the compounder) is initialized
  if (!compounderInstance) {
    await getOrchestrator();
  }
  return compounderInstance!;
}

// ---------------------------------------------------------------------------
// Retriever
// ---------------------------------------------------------------------------

/**
 * Get (or lazily initialize) the singleton Retriever instance.
 *
 * The Retriever is initialized alongside the Orchestrator during the first
 * call to `getOrchestrator()`. If the orchestrator has not been initialized
 * yet, this will trigger the full initialization pipeline.
 */
export async function getRetriever(): Promise<Retriever> {
  // Ensure the orchestrator (and thus the retriever) is initialized
  if (!retrieverInstance) {
    await getOrchestrator();
  }
  return retrieverInstance!;
}

// ---------------------------------------------------------------------------
// Plugin Manager
// ---------------------------------------------------------------------------

/**
 * Get (or lazily initialize) the singleton PluginManager instance.
 *
 * The PluginManager is initialized alongside the Orchestrator during the first
 * call to `getOrchestrator()`. If the orchestrator has not been initialized
 * yet, this will trigger the full initialization pipeline.
 */
export async function getPluginManager(): Promise<PluginManager> {
  // Ensure the orchestrator (and thus the plugin manager) is initialized
  if (!pluginManagerInstance) {
    await getOrchestrator();
  }
  return pluginManagerInstance!;
}

// ---------------------------------------------------------------------------
// Internal initialization
// ---------------------------------------------------------------------------

async function initializeOrchestrator(): Promise<Orchestrator> {
  const { DEEPANALYZE_CONFIG } = await import("../../core/config.js");
  const { ModelRouter } = await import("../../models/router.js");
  const { EmbeddingManager } = await import("../../models/embedding.js");
  const { Indexer } = await import("../../wiki/indexer.js");
  const { Linker } = await import("../../wiki/linker.js");
  const { Retriever } = await import("../../wiki/retriever.js");
  const { Expander } = await import("../../wiki/expander.js");
  const { AgentRunner } = await import("./agent-runner.js");
  const { createConfiguredToolRegistry } = await import("./tool-setup.js");
  const { BUILT_IN_AGENTS } = await import("./agent-definitions.js");
  const { Orchestrator } = await import("./orchestrator.js");

  console.log("[AgentSystem] Initializing agent pipeline...");

  // Step 1: ModelRouter
  const modelRouter = new ModelRouter();
  await modelRouter.initialize();
  console.log("[AgentSystem] ModelRouter initialized");

  // Step 2: EmbeddingManager
  const embeddingManager = new EmbeddingManager(modelRouter);
  await embeddingManager.initialize();
  console.log("[AgentSystem] EmbeddingManager initialized");

  // Step 3: Wiki subsystem
  const linker = new Linker();
  const indexer = new Indexer(embeddingManager);
  const retriever = new Retriever(indexer, linker, embeddingManager);
  retrieverInstance = retriever;
  const expander = new Expander(DEEPANALYZE_CONFIG.dataDir);
  console.log("[AgentSystem] Wiki subsystem initialized");

  // Step 4: Tool registry with all custom tools
  const toolRegistry = createConfiguredToolRegistry({
    retriever,
    linker,
    expander,
    embeddingManager,
    indexer,
    modelRouter,
    dataDir: DEEPANALYZE_CONFIG.dataDir,
  });
  console.log("[AgentSystem] ToolRegistry configured");

  // Step 5: Agent runner with built-in agents
  const runner = new AgentRunner(modelRouter, toolRegistry);
  runner.registerAgents(BUILT_IN_AGENTS);
  console.log("[AgentSystem] AgentRunner initialized with built-in agents");

  // Step 6: Knowledge Compounder (for write-back of agent results and auto-dream)
  const { KnowledgeCompounder } = await import("../../wiki/knowledge-compound.js");
  compounderInstance = new KnowledgeCompounder(DEEPANALYZE_CONFIG.dataDir);
  console.log("[AgentSystem] KnowledgeCompounder initialized");

  // Step 7: Orchestrator (with auto-dream support)
  const orchestrator = new Orchestrator(runner, modelRouter, compounderInstance, linker);
  console.log("[AgentSystem] Orchestrator ready");

  // Step 8: Plugin Manager
  const { PluginManager } = await import("../plugins/plugin-manager.js");
  const pluginManager = new PluginManager(toolRegistry);
  pluginManager.setAgentRunner(runner);
  pluginManager.loadFromDatabase();
  pluginManagerInstance = pluginManager;
  console.log("[AgentSystem] PluginManager initialized");

  // Step 9: Register built-in skills
  const { BUILT_IN_SKILLS } = await import("../skills/built-in-skills.js");
  for (const skill of BUILT_IN_SKILLS) {
    try {
      // Check if skill already exists (by name)
      const existing = pluginManager.listSkills();
      if (!existing.some(s => s.name === skill.name)) {
        pluginManager.createSkill(skill);
      }
    } catch {
      // Skill may already exist, skip
    }
  }
  console.log("[AgentSystem] Built-in skills registered");

  return orchestrator;
}
