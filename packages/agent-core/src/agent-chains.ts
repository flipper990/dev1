// Pre-built chain definitions and ChainBuilder fluent API.
// The AgentRunner.runChain() method accepts the ChainStep[] arrays built here.

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

/** Full generation chain: expand → plan → architect → develop → devops → review → test → debug → quality → optimize */
export function fullGenerationChain(): ChainStep[] {
  return new ChainBuilder()
    .step('intent_expander')
    .stepWithTransform('planner', (input, outputs) => {
      const expanded = outputs.get('intent_expander') as any;
      const expandedPrompts: string[] = Array.isArray(expanded?.expandedPrompts)
        ? expanded.expandedPrompts.filter((p: unknown) => typeof p === 'string' && p.length > 0)
        : [];
      return {
        prompts: expandedPrompts.length > 0 ? expandedPrompts : (input.prompts ?? []),
        expandedSpec: expanded ?? {},
        userPreferences: input.userPreferences ?? {},
      };
    })
    .stepWithTransform('architect', (input, outputs) => ({
      plan: outputs.get('planner') ?? {},
      expandedSpec: outputs.get('intent_expander') ?? {},
      userPreferences: input.userPreferences ?? {},
    }))
    .stepWithTransform('developer', (_input, outputs) => ({
      spec: outputs.get('architect') ?? {},
      expandedSpec: outputs.get('intent_expander') ?? {},
      fileAssignment: (outputs.get('architect') as any)?.fileTree ?? [],
    }))
    .stepWithTransform('devops', (_input, outputs) => ({
      spec: outputs.get('architect') ?? {},
      fileTree: (outputs.get('architect') as any)?.fileTree ?? [],
    }), { onError: 'skip' })
    .stepWithTransform('reviewer', (_input, outputs) => ({
      spec: outputs.get('architect') ?? {},
      expandedSpec: outputs.get('intent_expander') ?? {},
      files: (outputs.get('developer') as any)?.files ?? [],
    }))
    .stepWithTransform('tester', (_input, outputs) => ({
      files: (outputs.get('developer') as any)?.files ?? [],
      apiContracts: (outputs.get('architect') as any)?.apiContracts ?? [],
      spec: outputs.get('architect') ?? {},
      expandedSpec: outputs.get('intent_expander') ?? {},
    }), { onError: 'skip' })
    .stepIf(
      (outputs) => {
        const review = outputs.get('reviewer') as any;
        return review?.issues?.length > 0;
      },
      'debugger',
      {
        inputTransform: (_input, outputs) => ({
          issues: (outputs.get('reviewer') as any)?.issues ?? [],
          affectedFiles: (outputs.get('developer') as any)?.files ?? [],
          spec: outputs.get('architect') ?? {},
          expandedSpec: outputs.get('intent_expander') ?? {},
        }),
        onError: 'continue',
      },
    )
    .stepWithTransform('quality_enforcer', (_input, outputs) => ({
      expandedSpec: outputs.get('intent_expander') ?? {},
      spec: outputs.get('architect') ?? {},
      files: (outputs.get('developer') as any)?.files ?? [],
      reviewReport: outputs.get('reviewer') ?? {},
      unresolvedIssues: (outputs.get('debugger') as any)?.unresolved ?? [],
    }), { onError: 'continue' })
    .stepWithTransform('optimizer', (_input, outputs) => ({
      files: (outputs.get('developer') as any)?.files ?? [],
      spec: outputs.get('architect') ?? {},
      expandedSpec: outputs.get('intent_expander') ?? {},
      qaReport: outputs.get('reviewer') ?? {},
      qualityReport: outputs.get('quality_enforcer') ?? {},
    }), { onError: 'skip' })
    .build();
}

/** Quick review: develop → review only */
export function quickReviewChain(): ChainStep[] {
  return new ChainBuilder()
    .step('developer')
    .stepWithTransform('reviewer', (_input, outputs) => ({
      spec: {},
      files: (outputs.get('developer') as any)?.files ?? [],
    }))
    .build();
}

/** Fix and optimize: review → debug (conditional) → optimize */
export function fixAndOptimizeChain(): ChainStep[] {
  return new ChainBuilder()
    .step('reviewer')
    .stepIf(
      (outputs) => {
        const review = outputs.get('reviewer') as any;
        return review?.issues?.some((i: any) => i.severity === 'critical' || i.severity === 'high');
      },
      'debugger',
      {
        inputTransform: (input, outputs) => ({
          issues: (outputs.get('reviewer') as any)?.issues ?? [],
          affectedFiles: input.files ?? [],
        }),
      },
    )
    .step('optimizer', { onError: 'skip' })
    .build();
}
