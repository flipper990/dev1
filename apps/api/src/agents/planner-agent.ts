// ─────────────────────────────────────────────────────────────
// Planner Agent — Decomposes prompts into execution plan
// ─────────────────────────────────────────────────────────────

import { BaseAgent } from '../../../packages/agent-core/src/base-agent.js';
import type { Task, MemoryEntry } from '../../../packages/agent-core/src/types.js';

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
      sections.push(`## User Preferences\n\n\`\`\`json\n${JSON.stringify(userPreferences, null, 2)}\n\`\`\``);
    }

    if (memories.length > 0) {
      sections.push('## Relevant Past Experience\n');
      const grouped = new Map<string, MemoryEntry[]>();
      for (const mem of memories) {
        const group = grouped.get(mem.type) ?? [];
        group.push(mem);
        grouped.set(mem.type, group);
      }
      for (const [type, entries] of grouped) {
        sections.push(`### ${type}`);
        for (const e of entries) {
          sections.push(`- ${e.content}`);
        }
      }
    }

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
      content: `Planned "${plan.projectName}" with stack ${JSON.stringify(plan.stackHints)} — ${plan.tasks.length} tasks`,
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

// ── Shared JSON extraction utility ──────────────────────────

export function extractJSON(raw: string): Record<string, unknown> {
  try {
    return JSON.parse(raw);
  } catch {
    const fenceMatch = raw.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
    if (fenceMatch) {
      try {
        return JSON.parse(fenceMatch[1].trim());
      } catch {
        // Fall through to brace matching
      }
    }

    const braceStart = raw.indexOf('{');
    if (braceStart !== -1) {
      let depth = 0;
      let inString = false;
      let escape = false;
      for (let i = braceStart; i < raw.length; i++) {
        const ch = raw[i];
        if (escape) { escape = false; continue; }
        if (ch === '\\') { escape = true; continue; }
        if (ch === '"') { inString = !inString; continue; }
        if (inString) continue;
        if (ch === '{') depth++;
        if (ch === '}') { depth--; if (depth === 0) return JSON.parse(raw.slice(braceStart, i + 1)); }
      }
    }

    throw new Error(`Failed to extract JSON from LLM output (length: ${raw.length})`);
  }
}
