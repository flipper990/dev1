'use client';

import { useCallback, useEffect, useMemo, useRef } from 'react';
import { TopNav } from '../components/dashboard/TopNav';
import { IdeaPrompt } from '../components/dashboard/IdeaPrompt';
import { PipelineStrip } from '../components/dashboard/PipelineStrip';
import { AgentProgressionCard } from '../components/dashboard/AgentProgressionCard';
import { TokensCard } from '../components/dashboard/TokensCard';
import { EnvironmentCard } from '../components/dashboard/EnvironmentCard';
import { RecentProjects, RecentIdeas } from '../components/dashboard/RecentLists';
import { FilesPanel } from '../components/dashboard/FilesPanel';
import { ToastStack } from '../components/ToastStack';
import { useStore } from '../lib/store';
import { humanizeError } from '../lib/error-messages';
import {
  generateProject,
  updateProject,
  listProjects,
  openSessionSocket,
} from '../lib/api';

/**
 * Editorial cosmic Home dashboard.
 *
 *  ┌──────────────── TopNav (Home / Agents / Projects / Settings) ────────────┐
 *  │                                                                          │
 *  │   ┌──── LEFT ─────┐ ┌──────── CENTER ──────────┐ ┌────── RIGHT ────────┐ │
 *  │   │ Progression   │ │ Got an idea? prompt      │ │ Files / Code panel  │ │
 *  │   │ Tokens        │ │ Recent Projects          │ │ (tree + preview)    │ │
 *  │   │ Environment   │ │ Recent Ideas             │ │                     │ │
 *  │   └───────────────┘ └──────────────────────────┘ └─────────────────────┘ │
 *  └──────────────────────────────────────────────────────────────────────────┘
 *
 * All real functionality (project creation, WebSocket streaming, file
 * loading) is preserved from the legacy `/workspace` shell — only the visual
 * language and information architecture changed.
 */
export default function HomeDashboard() {
  const store = useStore();
  const socketRef = useRef<WebSocket | null>(null);
  const attachedSessionIdRef = useRef<string | null>(null);
  const initialLoadDone = useRef(false);

  // ── Load + poll projects every 8s ────────────────────────────────────────
  useEffect(() => {
    const load = (isInitial = false) =>
      listProjects()
        .then((data) => {
          store.setProjects(data);
          if (isInitial && !store.selectedProjectId && data.length > 0) {
            store.setSelectedProjectId(data[0].id);
            store.setProjectMode('edit');
          }
        })
        .catch((e) => store.pushLog('projects', (e as Error).message, 'error'));

    if (!initialLoadDone.current) {
      initialLoadDone.current = true;
      load(true);
    }
    const id = setInterval(() => load(false), 8000);
    return () => clearInterval(id);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => () => { socketRef.current?.close(); }, []);

  // Auto-attach to externally-started runs.
  useEffect(() => {
    const generating = store.projects.filter(
      (p) => p.status === 'generating' && typeof p.sessionId === 'string' && p.sessionId.length > 0,
    );
    if (generating.length === 0) return;
    const selected = generating.find((p) => p.id === store.selectedProjectId);
    const target = selected ?? generating[0];
    const sessionId = target.sessionId as string;
    if (attachedSessionIdRef.current === sessionId) return;
    if (socketRef.current && socketRef.current.readyState < 2) return;

    store.setSelectedProjectId(target.id);
    store.setProjectMode('create');
    store.setIsGenerating(true);
    store.pushLog('pipeline', `Attaching to external run: ${target.name}`);
    openSocket(sessionId, target.name);
  }, [store.projects, store.selectedProjectId]); // eslint-disable-line react-hooks/exhaustive-deps

  const openSocket = useCallback((sessionId: string, projectName: string) => {
    if (socketRef.current && socketRef.current.readyState < 2) {
      socketRef.current.close();
    }
    attachedSessionIdRef.current = sessionId;
    socketRef.current = openSessionSocket(
      sessionId,
      (next) => {
        store.setProgress(next);
        store.setWsConnected(true);
        if (next.currentStep) {
          store.pushLog(
            next.currentStep.agent,
            `${next.currentStep.name} — ${next.currentStep.description ?? 'running'}`,
          );
        }
      },
      (status) => {
        store.pushLog('pipeline', `Session ended: ${status}`);
        store.setIsGenerating(false);
        store.setWsConnected(false);
        if (attachedSessionIdRef.current === sessionId) attachedSessionIdRef.current = null;
        if (status === 'completed') {
          store.addToast({ type: 'success', title: 'Build complete', message: projectName });
          store.setProjectMode('edit');
        } else if (status === 'failed') {
          store.addToast({ type: 'error', title: 'Build failed', message: 'See logs for details.' });
        } else {
          store.addToast({ type: 'warning', title: 'Session ended', message: `Status: ${status}` });
        }
        listProjects().then(store.setProjects).catch(() => {});
      },
      (msg) => {
        store.pushLog('ws', msg, 'warn');
        store.setWsConnected(false);
      },
    );
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleSubmit = useCallback(async (prompt: string, picker?: import('../lib/stacks').StackPickerValue) => {
    const isEdit = store.projectMode === 'edit' && !!store.selectedProjectId && !store.isGenerating;
    store.setIsGenerating(true);
    store.setProgress(null);

    // Build preferences payload — agents read userPreferences.stackSelectionMode
    // and (in manual mode only) userPreferences.techStackOverride.
    let preferences: Record<string, unknown> | undefined;
    if (!isEdit && picker) {
      const { selectionToTechStack } = await import('../lib/stacks');
      const prefs: Record<string, unknown> = { stackSelectionMode: picker.mode };
      if (picker.mode === 'manual') {
        const override = selectionToTechStack(picker.selection);
        if (Object.keys(override).length > 0) prefs.techStackOverride = override;
      }
      preferences = prefs;
    }

    try {
      if (isEdit) {
        store.pushLog('pipeline', 'Submitting update…');
        const result = await updateProject(store.selectedProjectId!, prompt);
        store.pushLog('pipeline', `Update queued for: ${result.project.name}`);
        store.addToast({ type: 'info', title: 'Updating project', message: result.project.name });
        openSocket(result.sessionId, result.project.name);
      } else {
        store.pushLog('pipeline', 'Submitting new project…');
        const result = await generateProject(prompt, preferences);
        store.setSelectedProjectId(result.projectId);
        store.setProjectMode('create');
        store.pushLog('pipeline', `Project queued: ${result.project.name}`);
        store.addToast({ type: 'info', title: 'Building project', message: result.project.name });
        openSocket(result.sessionId, result.project.name);
      }
    } catch (e) {
      const human = humanizeError(e, isEdit ? 'Update failed' : 'Create failed');
      store.pushLog('pipeline', human.message, 'error');
      store.setIsGenerating(false);
      store.addToast({ type: human.severity, title: human.title, message: human.message });
    }
  }, [store.projectMode, store.selectedProjectId, store.isGenerating, openSocket]); // eslint-disable-line react-hooks/exhaustive-deps

  const onSelectProject = useCallback((id: string) => {
    store.setSelectedProjectId(id);
    store.setProjectMode('edit');
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const onPickIdea = useCallback((text: string) => {
    store.setPendingPrompt(text);
    void handleSubmit(text);
  }, [handleSubmit]); // eslint-disable-line react-hooks/exhaustive-deps

  const selected = useMemo(
    () => store.projects.find((p) => p.id === store.selectedProjectId) ?? null,
    [store.projects, store.selectedProjectId],
  );

  return (
    <div className="cosmic-root">
      <TopNav />

      <main className="px-7 pb-16">
        {/* Editorial hero */}
        <section className="max-w-[1480px] mx-auto pt-10 pb-8">
          <div className="cn-eyebrow mb-4">DEVteam · Studio</div>
          <h1 className="font-display text-5xl md:text-6xl text-primary leading-[1.04] tracking-[-0.025em]">
            Got an{' '}
            <span className="serif-italic text-gold-300">idea</span>?
          </h1>
          <p className="text-secondary mt-3 max-w-xl text-md leading-relaxed">
            Describe it once. The agents will spec, build, validate, and polish a
            full-stack project for you — live, in front of you.
          </p>
        </section>

        {/* 12-col responsive grid: 3 / 9 (stacks below xl) */}
        <section className="max-w-[1480px] mx-auto grid grid-cols-1 xl:grid-cols-12 gap-5">
          {/* LEFT rail */}
          <aside className="xl:col-span-3 flex flex-col gap-5">
            <AgentProgressionCard projects={store.projects} />
            <TokensCard projects={store.projects} />
            <EnvironmentCard />
          </aside>

          {/* CENTER — preview on top, prompt + recents below */}
          <section className="xl:col-span-9 flex flex-col gap-5">
            {/* Preview / Files / Code panel — primary canvas */}
            <div className="h-[560px] flex flex-col">
              <FilesPanel
                projectId={store.selectedProjectId}
                projectName={selected?.name}
              />
            </div>

            {store.isGenerating && <PipelineStrip progress={store.progress} />}

            <IdeaPrompt
              onSubmit={handleSubmit}
              busy={store.isGenerating}
              placeholder={
                selected && store.projectMode === 'edit'
                  ? `Iterate on "${selected.name}" — what should change?`
                  : undefined
              }
            />

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
              <RecentProjects
                projects={store.projects}
                selectedId={store.selectedProjectId}
                onSelect={onSelectProject}
              />
              <RecentIdeas projects={store.projects} onPick={onPickIdea} />
            </div>
          </section>
        </section>
      </main>

      <ToastStack />
    </div>
  );
}
