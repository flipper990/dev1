import type { ReactNode } from 'react';
import {
  Activity,
  BadgeDollarSign,
  Boxes,
  CircleHelp,
  Database,
  Eye,
  FileCode2,
  GitBranch,
  Layers3,
  LockKeyhole,
  Rocket,
  ShieldCheck,
} from 'lucide-react';

export interface DocsSection {
  id: string;
  title: string;
  body: string;
  bullets?: string[];
}

export interface DocsArticle {
  slug: string;
  title: string;
  description: string;
  category: string;
  readingTime: string;
  icon: ReactNode;
  sections: DocsSection[];
  related: string[];
}

export const docsArticles: DocsArticle[] = [
  {
    slug: 'getting-started',
    title: 'Getting started',
    description: 'Understand the DEVteam workflow and where to begin.',
    category: 'Start here',
    readingTime: '5 min',
    icon: <Rocket className="h-4 w-4" aria-hidden="true" />,
    sections: [
      {
        id: 'what-devteam-builds',
        title: 'What DEVteam builds',
        body: 'DEVteam is organized around generated full-stack application foundations: user-facing UI, backend services, database structure, preview evidence, diagnostics, and exportable source.',
        bullets: ['Start from a concrete product brief.', 'Select a stack before generation.', 'Review preview and diagnostics before exporting.'],
      },
      {
        id: 'first-workflow',
        title: 'Your first workflow',
        body: 'Use the workspace to select or create a project, submit a change request, inspect the generated preview, review logs, then export source when the project has enough evidence.',
        bullets: ['Open the workspace.', 'Choose the active projectId.', 'Use the command dock for scoped changes.', 'Review preview health and diagnostics.'],
      },
      {
        id: 'what-is-available',
        title: 'What is available now',
        body: 'Project listing, workspace preview, diagnostics, command submission, and source export surfaces are wired to project data. Auth, billing, deployment, and marketing intake actions are intentionally marked as requiring backend endpoints.',
      },
    ],
    related: ['core-concepts', 'project-lifecycle', 'preview-health'],
  },
  {
    slug: 'core-concepts',
    title: 'Core concepts',
    description: 'The objects and surfaces used throughout DEVteam.',
    category: 'Foundations',
    readingTime: '6 min',
    icon: <Layers3 className="h-4 w-4" aria-hidden="true" />,
    sections: [
      {
        id: 'project',
        title: 'Project',
        body: 'A project is the durable unit of generated work. It carries the projectId, prompt history, preview state, stack information, diagnostics, generated files, and export readiness.',
      },
      {
        id: 'workspace',
        title: 'Workspace',
        body: 'The workspace is the primary production surface. It combines project selection, command input, preview output, agent activity, diagnostics, and export controls.',
      },
      {
        id: 'evidence',
        title: 'Evidence',
        body: 'Evidence is the review material a team uses to decide whether generated output is ready: preview status, logs, diagnostics, generated files, and lifecycle status.',
      },
    ],
    related: ['project-lifecycle', 'agents-pipeline', 'diagnostics'],
  },
  {
    slug: 'project-lifecycle',
    title: 'Project lifecycle',
    description: 'How generated work moves from brief to export.',
    category: 'Workflow',
    readingTime: '7 min',
    icon: <GitBranch className="h-4 w-4" aria-hidden="true" />,
    sections: [
      {
        id: 'stages',
        title: 'Lifecycle stages',
        body: 'DEVteam presents software generation as staged production work instead of an open-ended prompt loop.',
        bullets: ['Define the application goal.', 'Build the application foundation.', 'Verify generated output.', 'Preview runtime behavior.', 'Export owned source.', 'Launch through your delivery system.'],
      },
      {
        id: 'primary-status',
        title: 'Primary status',
        body: 'The primary status is the project lifecycle state. Preview transport, preview health, diagnostics, logs, tokens, and runtime details are secondary or tertiary evidence.',
      },
      {
        id: 'handoff',
        title: 'Handoff readiness',
        body: 'A project is ready for handoff when the generated source, preview behavior, diagnostics, and team review expectations are aligned.',
      },
    ],
    related: ['stack-selection', 'preview-health', 'export-ownership'],
  },
  {
    slug: 'stack-selection',
    title: 'Stack selection',
    description: 'Choose implementation foundations before generation.',
    category: 'Build setup',
    readingTime: '4 min',
    icon: <Boxes className="h-4 w-4" aria-hidden="true" />,
    sections: [
      {
        id: 'why-stack-matters',
        title: 'Why stack selection matters',
        body: 'Stack selection shapes generated routes, APIs, persistence patterns, package structure, and the handoff expectations for engineering teams.',
      },
      {
        id: 'supported-decisions',
        title: 'Supported decisions',
        body: 'The current UI frames stack choice around frontend, backend, database, auth, and styling decisions. The goal is to keep generated output aligned with team standards.',
      },
      {
        id: 'review',
        title: 'Review before generation',
        body: 'Teams should treat stack selection as a production constraint, not a cosmetic preference. Confirm the target before using the workspace command flow.',
      },
    ],
    related: ['getting-started', 'project-lifecycle', 'export-ownership'],
  },
  {
    slug: 'agents-pipeline',
    title: 'Agents and pipeline',
    description: 'How agent activity is represented in the product.',
    category: 'Workflow',
    readingTime: '6 min',
    icon: <Activity className="h-4 w-4" aria-hidden="true" />,
    sections: [
      {
        id: 'pipeline-role',
        title: 'Pipeline role',
        body: 'Agent and pipeline views explain how work moves through definition, build, validation, preview, and export preparation.',
      },
      {
        id: 'activity',
        title: 'Activity evidence',
        body: 'Activity panels show recent project evidence and progress context. They should help users understand what changed and what needs review.',
      },
      {
        id: 'limits',
        title: 'Current limits',
        body: 'Historical agent-event APIs are not fully represented in this repository. When an event source is missing, the UI should say so instead of inventing activity.',
      },
    ],
    related: ['project-lifecycle', 'diagnostics', 'troubleshooting'],
  },
  {
    slug: 'preview-health',
    title: 'Preview health',
    description: 'Understand preview transport, runtime health, and ready states.',
    category: 'Review',
    readingTime: '6 min',
    icon: <Eye className="h-4 w-4" aria-hidden="true" />,
    sections: [
      {
        id: 'preview-purpose',
        title: 'Preview purpose',
        body: 'The preview is the main generated artifact review surface. It shows the running application output and should receive more visual priority than diagnostics or metadata.',
      },
      {
        id: 'status-types',
        title: 'Preview statuses',
        body: 'Preview transport describes whether the preview URL or frame can load. Preview health describes whether the generated app appears healthy once reachable.',
        bullets: ['Transport: loading, ready, blocked, or unavailable.', 'Health: healthy, degraded, failed, or unknown.', 'Project lifecycle remains the primary status.'],
      },
      {
        id: 'review-actions',
        title: 'Review actions',
        body: 'Use preview health together with diagnostics and logs before deciding whether to continue iterating or export source.',
      },
    ],
    related: ['diagnostics', 'project-lifecycle', 'troubleshooting'],
  },
  {
    slug: 'diagnostics',
    title: 'Diagnostics',
    description: 'Use logs, health, and runtime evidence without overwhelming the preview.',
    category: 'Review',
    readingTime: '5 min',
    icon: <Database className="h-4 w-4" aria-hidden="true" />,
    sections: [
      {
        id: 'diagnostic-role',
        title: 'Diagnostic role',
        body: 'Diagnostics are tertiary evidence. They support review when something needs attention, but they should not compete with the main preview artifact.',
      },
      {
        id: 'what-to-check',
        title: 'What to check',
        body: 'Review build errors, runtime warnings, preview readiness, logs, token/cost summaries, and any missing backend contracts.',
      },
      {
        id: 'collapsible-details',
        title: 'Detailed evidence',
        body: 'Detailed diagnostics belong in collapsible panels or secondary drawers so users can investigate without losing the main workspace context.',
      },
    ],
    related: ['preview-health', 'agents-pipeline', 'troubleshooting'],
  },
  {
    slug: 'export-ownership',
    title: 'Export and ownership',
    description: 'How generated source is handed off to your engineering process.',
    category: 'Handoff',
    readingTime: '5 min',
    icon: <FileCode2 className="h-4 w-4" aria-hidden="true" />,
    sections: [
      {
        id: 'ownership-model',
        title: 'Ownership model',
        body: 'DEVteam is positioned around source ownership. The generated application should be reviewable and exportable so your team can continue development in its own repository.',
      },
      {
        id: 'export-readiness',
        title: 'Export readiness',
        body: 'Export should follow review of generated files, preview behavior, diagnostics, and project lifecycle status.',
      },
      {
        id: 'deployment',
        title: 'Deployment handoff',
        body: 'Deployment orchestration is not faked. If a deployment backend is missing, export source and deploy through your own delivery system.',
      },
    ],
    related: ['project-lifecycle', 'security', 'billing'],
  },
  {
    slug: 'billing',
    title: 'Billing',
    description: 'Current billing availability and planned backend requirements.',
    category: 'Administration',
    readingTime: '3 min',
    icon: <BadgeDollarSign className="h-4 w-4" aria-hidden="true" />,
    sections: [
      {
        id: 'current-state',
        title: 'Current state',
        body: 'Billing portal, invoices, subscription changes, and checkout are intentionally unavailable until a real billing provider endpoint is connected.',
      },
      {
        id: 'available-data',
        title: 'Available usage data',
        body: 'Project usage and cost summaries can be shown from project records when available. Billing management remains separate from project usage evidence.',
      },
      {
        id: 'needed-endpoints',
        title: 'Needed endpoints',
        body: 'A production billing implementation needs customer, subscription, invoice, checkout, and portal-session contracts.',
      },
    ],
    related: ['getting-started', 'security', 'troubleshooting'],
  },
  {
    slug: 'security',
    title: 'Security',
    description: 'Security posture, access assumptions, and review workflow.',
    category: 'Administration',
    readingTime: '5 min',
    icon: <ShieldCheck className="h-4 w-4" aria-hidden="true" />,
    sections: [
      {
        id: 'posture',
        title: 'Security posture',
        body: 'DEVteam emphasizes inspectable source, reviewable runtime evidence, and export into your own engineering process.',
      },
      {
        id: 'auth',
        title: 'Authentication availability',
        body: 'Auth, SSO, email verification, invite acceptance, and password reset flows require backend contracts before they can be enabled.',
      },
      {
        id: 'enterprise-review',
        title: 'Enterprise review',
        body: 'Security and compliance requirements vary. Enterprise review should cover data handling, roadmap, deployment assumptions, and operational controls.',
      },
    ],
    related: ['export-ownership', 'billing', 'troubleshooting'],
  },
  {
    slug: 'troubleshooting',
    title: 'Troubleshooting',
    description: 'Common blocked states and what to inspect next.',
    category: 'Support',
    readingTime: '6 min',
    icon: <CircleHelp className="h-4 w-4" aria-hidden="true" />,
    sections: [
      {
        id: 'preview-not-loading',
        title: 'Preview is not loading',
        body: 'Check whether the selected project has a preview URL, whether transport is reachable, and whether diagnostics report runtime errors.',
      },
      {
        id: 'actions-disabled',
        title: 'Actions are disabled',
        body: 'Some actions are intentionally disabled because their backend contracts are not present. Look for labels such as Requires auth endpoint, Requires billing endpoint, or Requires deployment endpoint.',
      },
      {
        id: 'wrong-project',
        title: 'Wrong project shown',
        body: 'Confirm the projectId in the URL and the project selector. Workspace state depends on the selected backend project record.',
      },
    ],
    related: ['preview-health', 'diagnostics', 'getting-started'],
  },
];

export const docsNavigation = [
  { title: 'Start here', slugs: ['getting-started', 'core-concepts'] },
  { title: 'Workflow', slugs: ['project-lifecycle', 'stack-selection', 'agents-pipeline'] },
  { title: 'Review', slugs: ['preview-health', 'diagnostics'] },
  { title: 'Handoff', slugs: ['export-ownership'] },
  { title: 'Administration', slugs: ['billing', 'security', 'troubleshooting'] },
];

export function getDocsArticle(slug: string) {
  return docsArticles.find((article) => article.slug === slug);
}

export function getRelatedArticles(article: DocsArticle) {
  return article.related.map(getDocsArticle).filter((item): item is DocsArticle => Boolean(item));
}
