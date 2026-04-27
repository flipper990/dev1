// Pre-built chain definitions and ChainBuilder fluent API.
// AgentRunner.runChain() consumes the ChainStep[] arrays built here.
//
// 4-agent pipeline: spec → builder → qa → polish
// Re-build loop (qa → builder again on 'needs-improvement') is implemented
// outside ChainBuilder by the project-generator.

import type { AgentRole, ChainStep } from './types';

export class ChainBuilder {
  private steps: ChainStep[] = [];

  step(agentRole: AgentRole, options?: Omit<ChainStep, 'agentRole'>): this {
    this.steps.push({ agentRole, ...options });
    return this;
  }

  stepIf(
    condition: ChainStep['condition'],
    agentRole: AgentRole,
    options?: Omit<ChainStep, 'agentRole' | 'condition'>,
  ): this {
    this.steps.push({ agentRole, condition, ...options });
    return this;
  }

  stepWithTransform(
    agentRole: AgentRole,
    inputTransform: ChainStep['inputTransform'],
    options?: Omit<ChainStep, 'agentRole' | 'inputTransform'>,
  ): this {
    this.steps.push({ agentRole, inputTransform, ...options });
    return this;
  }

  build(): ChainStep[] {
    return [...this.steps];
  }
}

/** Full generation chain: spec → builder → qa → polish (linear, no loop here). */
export function fullGenerationChain(): ChainStep[] {
  return new ChainBuilder()
    .step('spec')
    .stepWithTransform('builder', (input, outputs) => ({
      spec: outputs.get('spec') ?? {},
      iteration: 1,
      userPreferences: input.userPreferences ?? {},
    }))
    .stepWithTransform('qa', (_input, outputs) => ({
      spec: outputs.get('spec') ?? {},
      files: (outputs.get('builder') as any)?.files ?? [],
    }))
    .stepWithTransform('polish', (_input, outputs) => ({
      spec: outputs.get('spec') ?? {},
      files: (outputs.get('builder') as any)?.files ?? [],
    }), { onError: 'skip' })
    .build();
}

/** Quick review: builder → qa only. */
export function quickReviewChain(): ChainStep[] {
  return new ChainBuilder()
    .step('builder')
    .stepWithTransform('qa', (_input, outputs) => ({
      spec: {},
      files: (outputs.get('builder') as any)?.files ?? [],
    }))
    .build();
}

/** Fix and polish: qa → polish (conditional). */
export function fixAndOptimizeChain(): ChainStep[] {
  return new ChainBuilder()
    .step('qa')
    .stepIf(
      (outputs) => {
        const qa = outputs.get('qa') as any;
        return qa?.verdict !== 'needs-improvement';
      },
      'polish',
      {
        inputTransform: (input, outputs) => ({
          spec: input.spec ?? {},
          files: input.files ?? (outputs.get('qa') as any)?.files ?? [],
        }),
        onError: 'skip',
      },
    )
    .build();
}
