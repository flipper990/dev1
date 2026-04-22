// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Task Queue â€” BullMQ-based job queue for agent tasks
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

import { Queue, Worker, type Job } from 'bullmq';
import type { AgentRole, Task } from '../../../../packages/agent-core/src/types.js';
import type { Logger } from '../../../../packages/agent-core/src/base-agent.js';

export interface QueueConfig {
  redisUrl: string;
  concurrency: number;
}

interface AgentJobData {
  task: Task;
  agentRole: AgentRole;
}

interface AgentJobResult {
  task: Task;
}

export class TaskQueue {
  private queue: Queue<AgentJobData, AgentJobResult>;
  private worker: Worker<AgentJobData, AgentJobResult> | null = null;
  private logger: Logger;
  private redisConfig: { host: string; port: number };

  constructor(queueConfig: QueueConfig, logger: Logger) {
    this.logger = logger;
    this.redisConfig = parseRedisUrl(queueConfig.redisUrl);

    this.queue = new Queue<AgentJobData, AgentJobResult>('agent-tasks', {
      connection: this.redisConfig,
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: 'exponential', delay: 2000 },
        removeOnComplete: { count: 1000 },
        removeOnFail: { count: 500 },
      },
    });
  }

  /** Enqueue a task for an agent */
  async enqueue(task: Task, priority?: number): Promise<string> {
    const job = await this.queue.add(
      `${task.agentRole}-task`,
      { task, agentRole: task.agentRole },
      {
        priority: priority ?? task.priority,
        jobId: task.id,
      },
    );
    this.logger.debug(`Enqueued task ${task.id} for ${task.agentRole}`, { jobId: job.id });
    return job.id!;
  }

  /** Start processing with a handler */
  startProcessing(
    handler: (task: Task, agentRole: AgentRole) => Promise<Task>,
    concurrency: number = 3,
  ): void {
    this.worker = new Worker<AgentJobData, AgentJobResult>(
      'agent-tasks',
      async (job: Job<AgentJobData>) => {
        this.logger.info(`Processing job ${job.id} for ${job.data.agentRole}`);
        const result = await handler(job.data.task, job.data.agentRole);
        return { task: result };
      },
      {
        connection: this.redisConfig,
        concurrency,
      },
    );

    this.worker.on('completed', (job) => {
      this.logger.info(`Job ${job.id} completed`);
    });

    this.worker.on('failed', (job, err) => {
      this.logger.error(`Job ${job?.id} failed`, { error: err.message });
    });

    this.worker.on('error', (err) => {
      this.logger.error('Worker error', { error: err.message });
    });
  }

  /** Get job status */
  async getJobStatus(jobId: string): Promise<{
    state: string;
    progress: number;
    result?: AgentJobResult;
  } | null> {
    const job = await this.queue.getJob(jobId);
    if (!job) return null;

    const state = await job.getState();
    return {
      state,
      progress: job.progress as number,
      result: job.returnvalue ?? undefined,
    };
  }

  /** Graceful shutdown */
  async shutdown(): Promise<void> {
    if (this.worker) {
      await this.worker.close();
    }
    await this.queue.close();
  }
}

function parseRedisUrl(url: string): { host: string; port: number } {
  try {
    const parsed = new URL(url);
    return {
      host: parsed.hostname || 'localhost',
      port: parseInt(parsed.port || '6379', 10),
    };
  } catch {
    return { host: 'localhost', port: 6379 };
  }
}
