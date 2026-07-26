'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowRight, ChevronDown, ChevronRight, Copy, GitBranch, Pin, PinOff, RotateCcw, Search, Sparkles } from 'lucide-react';
import type { GeneratedProject, PromptHistoryEntry } from '../../../../types/dashboard';
import {
  branchProjectRevision,
  getProjectPromptHistory,
  getProjectRevisionState,
  restoreProjectCheckpoint,
  type ProjectRevisionState,
} from '../../../../lib/api';
import { Button } from '../../../../components/ui';
import { cn } from '../../../../lib/cn';

interface PipelineEvent { owner: string; title: string; detail: string; state?: string; evidence?: string[]; }
interface ConversationWorkspaceProps {
  project: GeneratedProject | null;
  pipelineEvents: PipelineEvent[];
  busy: boolean;
  onSubmit: (prompt: string) => Promise<void>;
  onRefresh: () => Promise<unknown>;
}

function ledgerRecords(project: GeneratedProject | null) {
  const ledger = project?.diagnostics?.pipelineLedger as { records?: Array<{ model?: string; provider?: string; agentRole?: string; phase?: string }> } | undefined;
  return ledger?.records ?? [];
}

export function ConversationWorkspace({ project, pipelineEvents, busy, onSubmit, onRefresh }: ConversationWorkspaceProps) {
  const router = useRouter();
  const [prompts, setPrompts] = useState<PromptHistoryEntry[]>([]);
  const [revisions, setRevisions] = useState<ProjectRevisionState | null>(null);
  const [query, setQuery] = useState('');
  const [draft, setDraft] = useState('');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [pins, setPins] = useState<Set<string>>(new Set());
  const [message, setMessage] = useState('');
  const projectId = project?.id ?? null;

  const refresh = async () => {
    if (!projectId) return;
    const [history, versionState] = await Promise.all([getProjectPromptHistory(projectId), getProjectRevisionState(projectId)]);
    setPrompts(history); setRevisions(versionState);
  };

  useEffect(() => { setPrompts([]); setRevisions(null); setQuery(''); setDraft(''); void refresh(); }, [projectId]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (!projectId) return; try { setPins(new Set(JSON.parse(window.localStorage.getItem(`devteam:thread:pins:${projectId}`) ?? '[]') as string[])); } catch { setPins(new Set()); } }, [projectId]);

  const versionMap = useMemo(() => new Map((revisions?.history ?? []).map((version) => [version.version, version])), [revisions]);
  const currentVersion = revisions?.currentVersion ?? 1;
  const records = ledgerRecords(project);
  const latestModel = records.map((record) => [record.provider, record.model].filter(Boolean).join(' / ')).find(Boolean) ?? 'Not retained';
  const turns = prompts.map((prompt, index) => {
    const version = Number(prompt.snapshotVersionId ?? index + 1);
    const metadata = versionMap.get(version);
    const key = `${prompt.snapshotVersionId ?? 'prompt'}:${prompt.createdAt}:${index}`;
    return { prompt, version, metadata, key, latest: index === prompts.length - 1 };
  }).filter((turn) => `${turn.prompt.text} ${(turn.prompt.changedFiles ?? []).join(' ')}`.toLowerCase().includes(query.toLowerCase())).sort((a, b) => Number(pins.has(b.key)) - Number(pins.has(a.key)) || new Date(a.prompt.createdAt).getTime() - new Date(b.prompt.createdAt).getTime());

  const togglePin = (key: string) => { const next = new Set(pins); next.has(key) ? next.delete(key) : next.add(key); setPins(next); if (projectId) window.localStorage.setItem(`devteam:thread:pins:${projectId}`, JSON.stringify([...next])); };
  const submit = async (text: string) => { if (!text.trim()) return; setMessage(''); await onSubmit(text.trim()); setDraft(''); await refresh(); };
  const restore = async (version: number) => { if (!projectId || !window.confirm(`Restore the files from request v${version} as a new revision?`)) return; await restoreProjectCheckpoint(projectId, version, currentVersion); await onRefresh(); await refresh(); setMessage(`Restored v${version} as a new revision.`); };
  const branch = async (version: number) => { if (!projectId) return; const result = await branchProjectRevision(projectId, version); router.push(`/workspace?projectId=${encodeURIComponent(result.projectId)}&tab=code`); };

  if (!project) return <div className="p-4 text-body-s text-text-secondary">Select a project to open its work thread.</div>;

  return <section aria-labelledby="work-thread-title" className="flex min-h-0 flex-col">
    <div className="sticky top-0 z-10 bg-surface-raised pb-3">
      <div className="flex items-center justify-between"><div><h3 id="work-thread-title" className="text-label-m text-text-primary">Work thread</h3><p className="text-label-s text-text-muted">{prompts.length} requests · v{currentVersion}</p></div><Sparkles className="h-4 w-4 text-brand-primary" /></div>
      <label className="mt-3 flex items-center gap-2 rounded-[var(--radius-control)] border border-border-muted bg-surface-base px-2.5 py-2"><Search className="h-3.5 w-3.5 text-text-muted" /><span className="sr-only">Search conversation</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search requests or files" className="min-w-0 flex-1 bg-transparent text-label-s text-text-primary outline-none" /></label>
    </div>

    <ol className="studio-scroll min-h-0 space-y-3 overflow-y-auto pb-3">
      {turns.map(({ prompt, version, metadata, key, latest }) => {
        const isOpen = expanded.has(key); const changedFiles = prompt.changedFiles ?? []; const model = latest ? latestModel : 'Not retained for this revision';
        return <li key={key} className={cn('overflow-hidden rounded-[var(--radius-panel)] border bg-surface-base', pins.has(key) ? 'border-brand-primary/45' : 'border-border-muted')}>
          <article>
            <header className="border-b border-border-muted px-3 py-2.5"><div className="flex items-start justify-between gap-2"><div className="min-w-0"><p className="text-label-s text-text-muted">Request · <time dateTime={prompt.createdAt}>{new Date(prompt.createdAt).toLocaleString()}</time></p><p className="mt-1 whitespace-pre-wrap text-body-s text-text-primary">{prompt.text}</p></div><button type="button" onClick={() => togglePin(key)} className="rounded-md p-1.5 text-text-muted hover:bg-surface-tint hover:text-text-primary" aria-label={pins.has(key) ? 'Unpin prompt' : 'Pin prompt'}>{pins.has(key) ? <PinOff className="h-3.5 w-3.5" /> : <Pin className="h-3.5 w-3.5" />}</button></div></header>
            <div className="px-3 py-2.5"><button type="button" onClick={() => setExpanded((current) => { const next = new Set(current); next.has(key) ? next.delete(key) : next.add(key); return next; })} className="flex w-full items-center justify-between text-left text-label-s text-text-secondary"><span>Agent activity and results</span>{isOpen ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}</button>
              {isOpen ? <div className="mt-3 space-y-3 text-label-s">
                <div><p className="text-text-muted">Reasoning summary</p><p className="mt-1 text-text-secondary">The request produced revision v{version} with {changedFiles.length} changed files. Detailed private chain-of-thought is not stored.</p></div>
                <div><p className="text-text-muted">Agent actions</p>{latest && pipelineEvents.length ? <ul className="mt-1 space-y-1">{pipelineEvents.slice(-6).map((event, eventIndex) => <li key={`${event.title}-${eventIndex}`} className="rounded-md bg-surface-tint p-2"><span className="text-text-primary">{event.owner}: {event.title}</span><span className="block text-text-secondary">{event.detail}</span></li>)}</ul> : <p className="mt-1 text-text-secondary">Historical step-level actions were not retained for this revision.</p>}</div>
                <div><p className="text-text-muted">Changed files</p>{changedFiles.length ? <div className="mt-1 flex flex-wrap gap-1">{changedFiles.map((file) => <span key={file} className="max-w-full truncate rounded-md bg-surface-tint px-2 py-1 font-mono text-[11px] text-text-secondary" title={file}>{file}</span>)}</div> : <p className="mt-1 text-text-secondary">No file changes recorded.</p>}</div>
                <dl className="grid grid-cols-2 gap-2"><div className="rounded-md bg-surface-tint p-2"><dt className="text-text-muted">Generated artifacts</dt><dd className="mt-1 text-text-primary">Revision v{version} · {changedFiles.length} files</dd></div><div className="rounded-md bg-surface-tint p-2"><dt className="text-text-muted">Verification</dt><dd className="mt-1 text-text-primary">{latest ? project.verificationStatus ?? 'Pending' : 'Not retained'}</dd></div><div className="rounded-md bg-surface-tint p-2"><dt className="text-text-muted">Preview snapshot</dt><dd className="mt-1 text-text-primary">{latest ? project.previewHealthStatus ?? project.preview?.previewHealth ?? 'Unknown' : 'Not retained'}</dd></div><div className="rounded-md bg-surface-tint p-2"><dt className="text-text-muted">Runtime</dt><dd className="mt-1 text-text-primary">{metadata ? `${Math.round(metadata.durationMs / 1000)}s` : latest ? `${Math.round(project.durationMs / 1000)}s` : 'Not retained'}</dd></div><div className="rounded-md bg-surface-tint p-2"><dt className="text-text-muted">Cost</dt><dd className="mt-1 text-text-primary">${(metadata?.totalCostUsd ?? (latest ? project.totalCostUsd : 0)).toFixed(4)}</dd></div><div className="rounded-md bg-surface-tint p-2"><dt className="text-text-muted">Model used</dt><dd className="mt-1 break-words text-text-primary">{model}</dd></div></dl>
              </div> : null}
            </div>
            <footer className="flex flex-wrap gap-1 border-t border-border-muted px-2 py-2"><button type="button" onClick={() => { void navigator.clipboard.writeText(prompt.text); setMessage('Prompt copied.'); }} className="rounded-md px-2 py-1.5 text-label-s text-text-secondary hover:bg-surface-tint"><Copy className="mr-1 inline h-3.5 w-3.5" />Copy</button><button type="button" disabled={busy} onClick={() => { void submit(prompt.text); }} className="rounded-md px-2 py-1.5 text-label-s text-text-secondary hover:bg-surface-tint disabled:opacity-50"><RotateCcw className="mr-1 inline h-3.5 w-3.5" />Retry</button><button type="button" disabled={busy} onClick={() => { void branch(version); }} className="rounded-md px-2 py-1.5 text-label-s text-text-secondary hover:bg-surface-tint disabled:opacity-50"><GitBranch className="mr-1 inline h-3.5 w-3.5" />Branch</button><button type="button" disabled={busy || version === currentVersion} onClick={() => { void restore(version); }} className="rounded-md px-2 py-1.5 text-label-s text-text-secondary hover:bg-surface-tint disabled:opacity-40">Restore files</button></footer>
          </article>
        </li>;
      })}
      {!turns.length ? <li className="rounded-[var(--radius-panel)] border border-dashed border-border p-4 text-center text-body-s text-text-secondary">{query ? 'No requests match your search.' : 'Describe the next change below.'}</li> : null}
    </ol>

    <form className="sticky bottom-0 border-t border-border-muted bg-surface-raised pt-3" onSubmit={(event) => { event.preventDefault(); void submit(draft); }}><label htmlFor="thread-draft" className="text-label-s text-text-muted">Continue conversation</label><textarea id="thread-draft" value={draft} onChange={(event) => setDraft(event.target.value)} rows={3} placeholder="Describe the next change…" className="mt-1 w-full resize-none rounded-[var(--radius-control)] border border-border bg-surface-base p-2.5 text-body-s text-text-primary outline-none focus:shadow-[var(--focus-ring)]" /><div className="mt-2 flex items-center justify-between gap-2"><span role="status" className="min-w-0 truncate text-label-s text-text-muted">{message}</span><Button type="submit" disabled={busy || !draft.trim()}>Continue <ArrowRight className="h-3.5 w-3.5" /></Button></div></form>
  </section>;
}
