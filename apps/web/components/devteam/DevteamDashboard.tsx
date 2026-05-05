'use client';

import { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { cn } from '../../lib/cn';
import { Navbar } from './Navbar';
import { PromptComposer } from './PromptComposer';
import { AgentFeed } from './AgentFeed';
import { ChatHistory } from './ChatHistory';
import { PreviewStage } from './PreviewStage';
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
    </div>
  );
}
