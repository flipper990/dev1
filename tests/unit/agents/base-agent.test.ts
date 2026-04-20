import { describe, it, expect, jest } from '@jest/globals';
import { BaseAgent } from '../../services/agents/src/base-agent.js';
import type { AgentContext } from '../../services/agents/src/base-agent.js';
import type { MemoryEntry } from '../../core/src/types.js';

// ─── Concrete test subclass ────────────────────────────────────────────────

class EchoAgent extends BaseAgent<{ text: string }, { echo: string }> {
  constructor() {
    super('planner', 'You are an echo agent. Repeat the input as JSON {"echo": "..."}');
  }

  protected buildPrompt(input: { text: string }, _memories: MemoryEntry[]): string {
    return `Echo this: ${input.text}`;
  }

  protected parseOutput(raw: string): { echo: string } {
    return this.extractJson<{ echo: string }>(raw);
  }
}

// ─── Mock context ──────────────────────────────────────────────────────────

function makeCtx(responseContent = '{"echo": "hello"}'): AgentContext {
  return {
    sessionId: 'sess_test',
    projectId: 'proj_test',
    memory: {
      store: jest.fn(async (entry) => ({ ...entry, id: 'mem_1', createdAt: new Date().toISOString() })),
      retrieve: jest.fn(async () => []),
    },
    llm: {
      complete: jest.fn(async () => ({
        content: responseContent,
        model: 'gpt-4o-mini',
        provider: 'openai' as const,
        inputTokens: 10,
        outputTokens: 5,
        costUsd: 0.001,
        durationMs: 200,
      })),
    },
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────

describe('BaseAgent', () => {
  it('runs successfully and returns typed output', async () => {
    const agent = new EchoAgent();
    const ctx = makeCtx('{"echo": "hello world"}');

    const result = await agent.run({ text: 'hello world' }, ctx);

    expect(result.output.echo).toBe('hello world');
    expect(result.inputTokens).toBe(10);
    expect(result.outputTokens).toBe(5);
    expect(result.costUsd).toBeCloseTo(0.001);
  });

  it('extracts JSON from fenced code block', async () => {
    const agent = new EchoAgent();
    const ctx = makeCtx('```json\n{"echo": "fenced"}\n```');

    const result = await agent.run({ text: 'fenced' }, ctx);
    expect(result.output.echo).toBe('fenced');
  });

  it('calls memory.retrieve on run', async () => {
    const agent = new EchoAgent();
    const ctx = makeCtx();

    await agent.run({ text: 'test' }, ctx);
    expect(ctx.memory.retrieve).toHaveBeenCalledWith(
      expect.objectContaining({ agentRole: 'planner', sessionId: 'sess_test' }),
    );
  });

  it('calls memory.store with output after run', async () => {
    const agent = new EchoAgent();
    const ctx = makeCtx();

    await agent.run({ text: 'test' }, ctx);
    expect(ctx.memory.store).toHaveBeenCalledTimes(1);
  });

  it('throws on invalid JSON output', async () => {
    const agent = new EchoAgent();
    const ctx = makeCtx('NOT JSON AT ALL');

    await expect(agent.run({ text: 'test' }, ctx)).rejects.toThrow();
  });
});
