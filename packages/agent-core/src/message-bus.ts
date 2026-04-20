// ─────────────────────────────────────────────────────────────
// Message Bus — Redis Streams-based agent communication
// ─────────────────────────────────────────────────────────────

import type { AgentMessage, AgentRole } from './types';
import type { MessageBus, Logger } from './base-agent';

/**
 * Redis Streams-backed message bus for inter-agent communication.
 *
 * Design:
 * - Each agent role has its own stream: "agent:{role}:inbox"
 * - Orchestrator has stream: "orchestrator:inbox"
 * - Broadcast messages go to "agent:broadcast"
 * - Consumer groups ensure at-least-once delivery
 * - Messages are acknowledged after processing
 *
 * This is an interface + in-memory implementation for testing.
 * Production implementation wraps ioredis.
 */

// ── Redis Implementation (production) ───────────────────────

export interface RedisClient {
  xadd(stream: string, id: string, ...fields: string[]): Promise<string>;
  xreadgroup(
    group: string,
    consumer: string,
    count: number,
    block: number,
    ...streams: string[]
  ): Promise<Array<[string, Array<[string, string[]]>]> | null>;
  xack(stream: string, group: string, ...ids: string[]): Promise<number>;
  xgroup(command: 'CREATE', stream: string, group: string, id: string, mkstream?: 'MKSTREAM'): Promise<string>;
}

export class RedisMessageBus implements MessageBus {
  private redis: RedisClient;
  private logger: Logger;
  private handlers: Map<string, (msg: AgentMessage) => Promise<void>> = new Map();
  private consumerName: string;
  private groupName = 'agent-workers';
  private running = false;

  constructor(redis: RedisClient, logger: Logger, consumerName?: string) {
    this.redis = redis;
    this.logger = logger;
    this.consumerName = consumerName ?? `worker-${Date.now()}`;
  }

  async publish(message: AgentMessage): Promise<void> {
    const stream = this.getStream(message.to);
    const serialized = JSON.stringify(message);

    await this.redis.xadd(stream, '*', 'data', serialized);

    this.logger.debug(`Published message to ${stream}`, {
      from: message.from,
      to: message.to,
      type: message.type,
    });
  }

  subscribe(agentRole: AgentRole, handler: (msg: AgentMessage) => Promise<void>): void {
    const stream = this.getStream(agentRole);
    this.handlers.set(stream, handler);

    // Ensure consumer group exists
    this.ensureGroup(stream).catch(err => {
      this.logger.warn(`Failed to create consumer group for ${stream}`, { error: err.message });
    });

    if (!this.running) {
      this.running = true;
      this.pollLoop();
    }
  }

  unsubscribe(agentRole: AgentRole): void {
    const stream = this.getStream(agentRole);
    this.handlers.delete(stream);

    if (this.handlers.size === 0) {
      this.running = false;
    }
  }

  private getStream(target: string): string {
    if (target === 'broadcast') return 'agent:broadcast';
    if (target === 'orchestrator') return 'orchestrator:inbox';
    return `agent:${target}:inbox`;
  }

  private async ensureGroup(stream: string): Promise<void> {
    try {
      await this.redis.xgroup('CREATE', stream, this.groupName, '0', 'MKSTREAM');
    } catch {
      // Group already exists — safe to ignore
    }
  }

  private async pollLoop(): Promise<void> {
    while (this.running) {
      try {
        const streams = Array.from(this.handlers.keys());
        if (streams.length === 0) break;

        // Read from all subscribed streams
        const results = await this.redis.xreadgroup(
          this.groupName,
          this.consumerName,
          10,     // count
          1000,   // block ms
          ...streams.flatMap(s => [s, '>']),
        );

        if (!results) continue;

        for (const [stream, messages] of results) {
          const handler = this.handlers.get(stream);
          if (!handler) continue;

          for (const [id, fields] of messages) {
            try {
              const data = fields[fields.indexOf('data') + 1];
              const message: AgentMessage = JSON.parse(data);
              await handler(message);
              await this.redis.xack(stream, this.groupName, id);
            } catch (err) {
              this.logger.error(`Failed to process message ${id} from ${stream}`, {
                error: (err as Error).message,
              });
              // Message will be re-delivered on next read (not acked)
            }
          }
        }
      } catch (err) {
        this.logger.error('Poll loop error', { error: (err as Error).message });
        // Brief pause before retrying
        await new Promise(r => setTimeout(r, 500));
      }
    }
  }
}

// ── In-Memory Implementation (testing / development) ────────

export class InMemoryMessageBus implements MessageBus {
  private handlers: Map<string, (msg: AgentMessage) => Promise<void>> = new Map();
  private messageLog: AgentMessage[] = [];

  async publish(message: AgentMessage): Promise<void> {
    this.messageLog.push(message);

    const key = message.to === 'broadcast' ? 'broadcast' : message.to;
    const handler = this.handlers.get(key);
    if (handler) {
      await handler(message);
    }

    // Broadcast to all handlers
    if (message.to === 'broadcast') {
      for (const [, h] of this.handlers) {
        await h(message);
      }
    }
  }

  subscribe(agentRole: AgentRole, handler: (msg: AgentMessage) => Promise<void>): void {
    this.handlers.set(agentRole, handler);
  }

  unsubscribe(agentRole: AgentRole): void {
    this.handlers.delete(agentRole);
  }

  // Test helpers
  getMessages(): AgentMessage[] {
    return [...this.messageLog];
  }

  getMessagesFor(target: AgentRole | 'orchestrator'): AgentMessage[] {
    return this.messageLog.filter(m => m.to === target);
  }

  clear(): void {
    this.messageLog = [];
    this.handlers.clear();
  }
}
