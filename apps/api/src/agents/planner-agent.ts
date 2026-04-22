// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Planner Agent â€” Decomposes prompts into execution plan
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

import { BaseAgent } from '../../../../packages/agent-core/src/base-agent.js';
import type { Task, MemoryEntry } from '../../../../packages/agent-core/src/types.js';
import { extractJSON } from './utils.js';
// Re-export for backward compatibility
export { extractJSON } from './utils.js';

export class PlannerAgent extends BaseAgent {
  protected async buildPrompt(task: Task, memories: MemoryEntry[]): Promise<string> {
    const { prompts, userPreferences } = task.input as {
      prompts: string[];
      userPreferences?: Record<string, unknown>;
    };

    const sections: string[] = [];

    sections.push('## User Prompts\n');
    prompts.forEach((p, i) => {
      sections.push(`**Prompt ${i + 1}:** ${p}`);
    });

    if (userPreferences && Object.keys(userPreferences).length > 0) {
      sections.push(`## User Preferences\n\n\`\`\`json\n${JSON.stringify(userPreferences)}\n\`\`\``);
    }

    sections.push(this.formatMemoriesForPrompt(memories));

    sections.push('Analyze these prompts and produce the execution plan as specified in your system prompt.');
    return sections.join('\n\n');
  }

  protected async parseOutput(raw: string, _task: Task): Promise<Record<string, unknown>> {
    return extractJSON(raw);
  }

  protected async validateOutput(output: Record<string, unknown>, _task: Task): Promise<void> {
    if (!output.projectName || typeof output.projectName !== 'string') {
      throw new Error('Validation: missing or invalid projectName');
    }
    if (!output.summary || typeof output.summary !== 'string') {
      throw new Error('Validation: missing or invalid summary');
    }
    if (!output.tasks || !Array.isArray(output.tasks) || output.tasks.length === 0) {
      throw new Error('Validation: missing or empty tasks array');
    }
    for (const t of output.tasks as Record<string, unknown>[]) {
      if (!t.id || !t.title || !t.assignedAgent) {
        throw new Error(`Validation: task missing required fields (id, title, assignedAgent)`);
      }
    }
    if (!output.stackHints || typeof output.stackHints !== 'object') {
      throw new Error('Validation: missing stackHints');
    }
    const taskIds = new Set((output.tasks as { id: string }[]).map(t => t.id));
    for (const t of output.tasks as { id: string; dependsOn?: string[] }[]) {
      if (t.dependsOn) {
        for (const dep of t.dependsOn) {
          if (!taskIds.has(dep)) {
            throw new Error(`Validation: task ${t.id} depends on non-existent task ${dep}`);
          }
          if (dep === t.id) {
            throw new Error(`Validation: task ${t.id} depends on itself`);
          }
        }
      }
    }
  }

  protected async extractLearnings(_task: Task, output: Record<string, unknown>): Promise<MemoryEntry[]> {
    const plan = output as { projectName: string; stackHints: Record<string, string>; tasks: unknown[]; constraints?: string[] };
    const learnings: MemoryEntry[] = [];

    learnings.push({
      agentRole: 'planner',
      type: 'pattern',
      content: `Planned "${plan.projectName}" with stack ${JSON.stringify(plan.stackHints)} â€” ${plan.tasks.length} tasks`,
      relevanceScore: 1.0,
      tags: ['architecture', 'tech-stack'],
      metadata: { stackHints: plan.stackHints, taskCount: plan.tasks.length },
    } as MemoryEntry);

    if (plan.constraints && plan.constraints.length > 0) {
      learnings.push({
        agentRole: 'planner',
        type: 'decision',
        content: `Constraints for "${plan.projectName}": ${plan.constraints.join('; ')}`,
        relevanceScore: 0.8,
        tags: ['architecture'],
        metadata: { projectName: plan.projectName },
      } as MemoryEntry);
    }

    return learnings;
  }
}

import { extractJSON } from './utils.js';
