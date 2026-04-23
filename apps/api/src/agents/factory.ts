// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Agent Factory â€” Instantiates all agents from registry
// Supports middleware, hooks, and prompt overrides.
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

import type { AgentRole, AgentMiddleware, AgentHooks, PromptConfig } from '../../../../packages/agent-core/src/types.js';
import { BaseAgent, type AgentConfig, type LLMClient, type MemoryStore, type MessageBus, type Logger } from '../../../../packages/agent-core/src/base-agent.js';
import { AGENT_DEFINITIONS } from '../../../../packages/agent-core/src/agent-registry.js';

import { PlannerAgent } from './planner-agent.js';
import { ArchitectAgent } from './architect-agent.js';
import { DeveloperAgent } from './developer-agent.js';
import { ReviewerAgent } from './reviewer-agent.js';
import { TesterAgent } from './tester-agent.js';
import { DebuggerAgent } from './debugger-agent.js';
import { DevOpsAgent } from './devops-agent.js';
import { OptimizerAgent } from './optimizer-agent.js';
import { IntentExpanderAgent } from './intent-expander-agent.js';
import { QualityEnforcerAgent } from './quality-enforcer-agent.js';

const AGENT_CLASSES: Record<AgentRole, new (...args: ConstructorParameters<typeof BaseAgent>) => BaseAgent> = {
  intent_expander:  IntentExpanderAgent,
  planner:          PlannerAgent,
  architect:        ArchitectAgent,
  developer:        DeveloperAgent,
  reviewer:         ReviewerAgent,
  tester:           TesterAgent,
  debugger:         DebuggerAgent,
  devops:           DevOpsAgent,
  optimizer:        OptimizerAgent,
  quality_enforcer: QualityEnforcerAgent,
};

export interface AgentFactoryOptions {
  /** Global middleware applied to all agents */
  middleware?: AgentMiddleware[];
  /** Per-agent middleware */
  middlewareByRole?: Partial<Record<AgentRole, AgentMiddleware[]>>;
  /** Per-agent hooks */
  hooksByRole?: Partial<Record<AgentRole, AgentHooks>>;
  /** Per-agent prompt overrides */
  promptOverrides?: Partial<Record<AgentRole, Partial<PromptConfig>>>;
  /** Log agent I/O (default: true) */
  logIO?: boolean;
}

export function createAllAgents(
  llm: LLMClient,
  memory: MemoryStore,
  bus: MessageBus,
  logger: Logger,
  options?: AgentFactoryOptions,
): Map<AgentRole, BaseAgent> {
  const agents = new Map<AgentRole, BaseAgent>();

  for (const [role, definition] of Object.entries(AGENT_DEFINITIONS)) {
    const agentRole = role as AgentRole;
    const AgentClass = AGENT_CLASSES[agentRole];
    if (!AgentClass) {
      logger.warn(`No implementation class for agent role: ${role}`);
      continue;
    }

    const agentLogger: Logger = {
      info: (msg, meta) => logger.info(`[${role}] ${msg}`, meta),
      warn: (msg, meta) => logger.warn(`[${role}] ${msg}`, meta),
      error: (msg, meta) => logger.error(`[${role}] ${msg}`, meta),
      debug: (msg, meta) => logger.debug(`[${role}] ${msg}`, meta),
    };

    // Build per-agent config from factory options
    const agentConfig: AgentConfig = {
      middleware: [
        ...(options?.middleware ?? []),
        ...(options?.middlewareByRole?.[agentRole] ?? []),
      ],
      hooks: options?.hooksByRole?.[agentRole],
      promptOverrides: options?.promptOverrides?.[agentRole],
      logIO: options?.logIO ?? true,
    };

    agents.set(agentRole, new AgentClass(definition, llm, memory, bus, agentLogger, agentConfig));
  }

  return agents;
}

/** Create a single agent for isolated testing or standalone use */
export function createAgent(
  role: AgentRole,
  llm: LLMClient,
  memory: MemoryStore,
  bus: MessageBus,
  logger: Logger,
  config?: AgentConfig,
): BaseAgent {
  const AgentClass = AGENT_CLASSES[role];
  if (!AgentClass) throw new Error(`No implementation for agent role: ${role}`);

  const definition = AGENT_DEFINITIONS[role];
  if (!definition) throw new Error(`No definition for agent role: ${role}`);
  return new AgentClass(definition, llm, memory, bus, logger, config);
}
