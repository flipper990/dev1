'use client';

import { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { cn } from '../../lib/cn';
import { Navbar } from './Navbar';
import { PromptComposer } from './PromptComposer';
import { AgentFeed } from './AgentFeed';
import { ChatHistory } from './ChatHistory';
import { PreviewStage } from './PreviewStage';
import { StatusDebugOverlay } from './StatusDebugOverlay';
import {
  AgentProgression,
  RecentProjects,
  TokenDashboard,
} from './RightStats';
import { useDevteamData } from './useDevteamData';

export function DevteamDashboard() {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const data = useDevteamData();

  useEffect(() => {
    const mq = window.matchMedia('(min-width: 1024px)');
    const handler = () => setDrawerOpen(false);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);

  const recentPrompts = data.rawProjects.flatMap((p) => p.prompts ?? []).slice(0, 3);
  const composerMode: 'build' | 'update' =
    data.selectedProject &&
    (data.selectedProject.status === 'completed' || data.selectedProject.status === 'failed')
      ? 'update'
      : 'build';
  const composerTarget =
    composerMode === 'update' ? data.selectedProject?.name ?? null : null;

  return (
    <div className="devteam-root">
      <Navbar
        onMenuClick={() => setDrawerOpen(true)}
        active="Home"
        selectedProjectId={data.selectedProjectId}
      />

      {data.error && (
        <div
          className="fixed left-1/2 -translate-x-1/2 z-[55] rounded-md border px-3 py-1.5 text-[12px] font-medium"
          style={{
            top: 'calc(56px + 8px)',
            background: 'rgba(239,68,68,0.12)',
            borderColor: 'rgba(239,68,68,0.4)',
            color: '#FCA5A5',
          }}
        >
          {data.error}
        </div>
      )}

      {data.metadataError && (
        <div
          className="fixed left-1/2 -translate-x-1/2 z-[55] rounded-md border px-3 py-1.5 text-[12px] font-medium flex items-center gap-3"
          style={{
            // Stack below the hard-error banner if both are present.
            top: data.error ? 'calc(56px + 40px)' : 'calc(56px + 8px)',
            background: 'rgba(245,158,11,0.12)',
            borderColor: 'rgba(245,158,11,0.4)',
            color: '#FCD34D',
          }}
          role="status"
          aria-live="polite"
        >
          <span>
            Project metadata temporarily unavailable
            {data.metadataError.kind === 'corrupt' ? ' (record corrupt)' : ''}
            {data.metadataError.attempts > 1 ? ` · attempt ${data.metadataError.attempts}` : ''}
            . Preview remains usable.
          </span>
          <button
            type="button"
            onClick={() => { void data.retryMetadata(); }}
            className="rounded px-2 py-0.5 text-[11px] font-semibold"
            style={{
              background: 'rgba(245,158,11,0.25)',
              color: '#FDE68A',
            }}
          >
            Retry now
          </button>
        </div>
      )}

      {/* Status-inconsistency banner. Shown when the cached record
       *  for the selected project carries a contradictory backend
       *  pair (project.status=failed + preview.previewStatus=ready).
       *  The pills above keep rendering the RAW values verbatim —
       *  this banner ONLY surfaces the contradiction and tells the
       *  user the dashboard is reconciling. The data hook fires
       *  hydrateActiveProject() in parallel; one of the two raw
       *  fields will land on a coherent value within ~1s and the
       *  banner self-clears. We never rewrite either pill. */}
      {data.statusReconciliation.consistency === 'conflicting' && (
        <div
          className="fixed left-1/2 -translate-x-1/2 z-[55] rounded-md border px-3 py-1.5 text-[12px] font-medium flex items-center gap-3"
          style={{
            // Stack below the metadata banner if it's present, which
            // itself stacks below the hard-error banner.
            top: data.error
              ? data.metadataError
                ? 'calc(56px + 72px)'
                : 'calc(56px + 40px)'
              : data.metadataError
                ? 'calc(56px + 40px)'
                : 'calc(56px + 8px)',
            background: 'rgba(245,158,11,0.12)',
            borderColor: 'rgba(245,158,11,0.4)',
            color: '#FCD34D',
          }}
          role="status"
          aria-live="polite"
          data-testid="status-inconsistency-banner"
        >
          <span>
            Status out of sync, refreshing from backend… (build=
            <strong>{data.statusReconciliation.projectStatus}</strong>, preview=
            <strong>{data.statusReconciliation.previewStatus ?? 'idle'}</strong>)
          </span>
          <button
            type="button"
            onClick={() => { void data.refreshActiveProject(); }}
            className="rounded px-2 py-0.5 text-[11px] font-semibold"
            style={{
              background: 'rgba(245,158,11,0.25)',
              color: '#FDE68A',
            }}
          >
            Refresh now
          </button>
        </div>
      )}

      <div
        className="flex gap-4 px-4 lg:px-6 pb-6"
        style={{ paddingTop: 'calc(56px + 16px)' }}
      >
        {/* ── LEFT: prompt + agents + chat ── */}
        <aside
          className={cn(
            'hidden lg:flex flex-col shrink-0 gap-4 pr-1',
            'sticky',
          )}
          style={{
            width: 320,
            top: 'calc(56px + 16px)',
            height: 'calc(100vh - 56px - 32px)',
          }}
        >
          <div className="shrink-0">
            <AgentFeed agents={data.agents} pipeline={data.pipeline} />
          </div>
          <div className="flex-1 min-h-0">
            <ChatHistory messages={data.chat} />
          </div>
          <div className="shrink-0">
            <PromptComposer
              onSubmit={data.submitPrompt}
              isGenerating={data.isGenerating}
              recentPrompts={recentPrompts}
              mode={composerMode}
              targetName={composerTarget}
            />
          </div>
        </aside>

        {/* ── CENTER: preview ── */}
        <main className="flex-1 min-w-0 flex flex-col gap-4" style={{ minHeight: 'calc(100vh - 56px - 32px)' }}>
          <PreviewStage
            project={data.selectedProject}
            selectedProjectId={data.selectedProjectId}
          />
        </main>

        {/* ── RIGHT: stats ── */}
        <aside
          className="hidden xl:flex flex-col shrink-0 gap-3 overflow-y-auto devteam-scroll sticky"
          style={{
            width: 280,
            top: 'calc(56px + 16px)',
            maxHeight: 'calc(100vh - 56px - 32px)',
          }}
        >
          <AgentProgression skills={data.skills} totals={data.totals} rawProjects={data.rawProjects} />
          <TokenDashboard sparkline={data.sparkline} totals={data.totals} />
          <RecentProjects
            projects={data.projects}
            selectedId={data.selectedProject?.id ?? null}
            onSelect={data.selectProject}
            onNew={data.newProject}
            onOpenLatest={data.openLatestProject}
          />
        </aside>
      </div>

      {drawerOpen && (
        <div className="lg:hidden fixed inset-0 z-[60]">
          <button
            aria-label="Close drawer"
            type="button"
            className="absolute inset-0 bg-black/60"
            onClick={() => setDrawerOpen(false)}
          />
          <div
            className="absolute inset-y-0 left-0 w-[320px] max-w-[88vw] flex flex-col bg-[var(--bg-void)] border-r p-4 gap-4"
            style={{ borderColor: 'var(--border-subtle)' }}
          >
            <div className="flex items-center justify-between shrink-0">
              <span className="text-[12px] font-semibold uppercase tracking-wider text-[var(--text-secondary)]">
                DEVteam
              </span>
              <button
                type="button"
                onClick={() => setDrawerOpen(false)}
                aria-label="Close"
                className="h-8 w-8 grid place-items-center rounded-md hover:bg-[var(--bg-elevated)]"
              >
                <X size={16} />
              </button>
            </div>
            <div className="shrink-0">
              <AgentFeed agents={data.agents} pipeline={data.pipeline} />
            </div>
            <div className="flex-1 min-h-0">
              <ChatHistory messages={data.chat} />
            </div>
            <div className="shrink-0">
              <PromptComposer
                onSubmit={data.submitPrompt}
                isGenerating={data.isGenerating}
                recentPrompts={recentPrompts}
                mode={composerMode}
                targetName={composerTarget}
              />
            </div>
          </div>
        </div>
      )}
      {/* Dev-only diagnostic overlay. No-ops in production builds and
       *  hidden by default in dev — toggle on with
       *  localStorage.setItem('devteam:status-debug', '1'). */}
      <StatusDebugOverlay />
    </div>
  );
}
