// ─────────────────────────────────────────────────────────────
// Polish Agent — UI/UX, performance, accessibility, prod-readiness pass.
// ─────────────────────────────────────────────────────────────

import { BaseAgent } from '../../../../packages/agent-core/src/base-agent.js';
import type { Task, MemoryEntry } from '../../../../packages/agent-core/src/types.js';
import { extractJSON } from './utils.js';

interface DesignAudit {
  rawHtmlButtons: Array<{ file: string; count: number }>;
  rawHtmlInputs:  Array<{ file: string; count: number }>;
  inlineHexColors: Array<{ file: string; count: number; samples: string[] }>;
  defaultTailwindBlue: Array<{ file: string; count: number }>;
  inlineStyles: Array<{ file: string; count: number }>;
  magicSpacing: Array<{ file: string; count: number; samples: string[] }>;
  useEffectFetches: Array<{ file: string; count: number }>;
  missingPrimitives: string[];
  missingAppShell: boolean;
  missingDesignTokens: boolean;
  missingTailwindConfig: boolean;
  totalViolations: number;
}

interface PolishInput {
  spec: Record<string, unknown>;
  files: Array<{ path: string; content: string; language?: string }>;
  designAudit?: DesignAudit;
}

export class PolishAgent extends BaseAgent {
  protected async buildPrompt(task: Task, memories: MemoryEntry[]): Promise<string> {
    const { spec, files, designAudit } = task.input as unknown as PolishInput;

    let prompt = `## Product Specification\n\n\`\`\`json\n${JSON.stringify(spec, null, 2)}\n\`\`\`\n\n`;

    if (designAudit) {
      prompt += `## ⚠ DESIGN-SYSTEM AUDIT — ${designAudit.totalViolations} violations to fix\n\n`;
      if (designAudit.missingDesignTokens)   prompt += `- ❌ MISSING: design-tokens file (apps/web/lib/design-tokens.ts). CREATE IT.\n`;
      if (designAudit.missingTailwindConfig) prompt += `- ❌ MISSING: tailwind.config.ts that consumes the tokens. CREATE/UPDATE IT.\n`;
      if (designAudit.missingAppShell)       prompt += `- ❌ MISSING: AppShell + Sidebar + Topbar layout. CREATE THEM.\n`;
      if (designAudit.missingPrimitives.length > 0) prompt += `- ❌ MISSING primitives: ${designAudit.missingPrimitives.join(', ')}. CREATE EACH in apps/web/components/ui/.\n`;
      const block = (label: string, rows: Array<{ file: string; count: number; samples?: string[] }>): void => {
        if (rows.length === 0) return;
        prompt += `\n### ${label} (${rows.reduce((a, r) => a + r.count, 0)} occurrences across ${rows.length} files)\n`;
        for (const r of rows.slice(0, 20)) {
          const ex = r.samples && r.samples.length > 0 ? ` — e.g. ${r.samples.join(', ')}` : '';
          prompt += `  - ${r.file}: ${r.count}${ex}\n`;
        }
      };
      block('Raw <button> usages — replace with <Button> primitive', designAudit.rawHtmlButtons);
      block('Raw <input> usages — replace with <Input> primitive',   designAudit.rawHtmlInputs);
      block('Inline hex colors — move to tokens, use Tailwind brand classes', designAudit.inlineHexColors);
      block('Default Tailwind blue/indigo/sky — replace with brand-* tokens', designAudit.defaultTailwindBlue);
      block('Inline style={{...}} — use Tailwind classes from tokens',        designAudit.inlineStyles);
      block('Magic spacing values (off the 4px grid) — fix to scale',         designAudit.magicSpacing);
      block('useEffect+fetch patterns — migrate to SWR/react-query',          designAudit.useEffectFetches);
      prompt += `\nEvery row above MUST be addressed in patches[] / newFiles[]. Verdict's selfCheck.* fields\nMUST report true only after fixes are emitted.\n\n`;
    }

    prompt += `## QA-approved Codebase (${files.length} files)\n\n`;
    for (const f of files) {
      prompt += `### ${f.path}\n\`\`\`${f.language ?? ''}\n${f.content}\n\`\`\`\n\n`;
    }

    prompt += this.formatMemoriesForPrompt(memories);

    prompt += `Apply the polish pass per your system prompt — design system, layout shell, perf, a11y, production readiness.`;
    return prompt;
  }

  protected async parseOutput(raw: string, _task: Task): Promise<Record<string, unknown>> {
    return extractJSON(raw);
  }

  protected async validateOutput(output: Record<string, unknown>, _task: Task): Promise<void> {
    if (!Array.isArray(output.patches))  throw new Error('Validation: patches must be an array');
  }

  protected async extractLearnings(_task: Task, output: Record<string, unknown>): Promise<MemoryEntry[]> {
    const patchCount = Array.isArray(output.patches)  ? output.patches.length  : 0;
    const newCount   = Array.isArray(output.newFiles) ? output.newFiles.length : 0;
    return [{
      agentRole: 'polish',
      type: 'pattern',
      content: `Polish pass: ${patchCount} patches, ${newCount} new artifact(s).`,
      relevanceScore: 0.6,
      tags: ['polish'],
      metadata: { patchCount, newCount },
    } as unknown as MemoryEntry];
  }
}
