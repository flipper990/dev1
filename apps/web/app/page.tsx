'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { AppHeader }    from '../components/AppHeader';
import { Sidebar }      from '../components/Sidebar';
import { CenterPanel }  from '../components/CenterPanel';
import { LivePreview }  from '../components/LivePreview';
import { LogsPanel }    from '../components/LogsPanel';
import { ToastStack }   from '../components/ToastStack';
import { ShowcasePanel } from '../components/ShowcasePanel';
import { TemplateGallery } from '../components/TemplateGallery';
import { KeyboardShortcuts } from '../components/KeyboardShortcuts';
import { useStore }     from '../lib/store';
import { humanizeError } from '../lib/error-messages';
import {
  generateProject, updateProject, listProjects, openSessionSocket, exportProject,
} from '../lib/api';

/**
 * Dashboard page — 3-panel desktop-style layout.
 *
 *   ┌──────────┬────────────────────────┬────────────────────────┐
 *   │  LEFT    │         CENTER         │         RIGHT          │
 *   │ Projects │ AI control:            │ Live preview (iframe)  │
 *   │ + New    │  • PromptPanel         │ always visible         │
 *   │          │  • PhaseProgress       │                        │
 *   │          │  • Agents / Files tabs │                        │
 *   └──────────┴────────────────────────┴────────────────────────┘
 *
 * State survives across navigation (no full page reloads). The selected
 * project is never reset on update — follow-up prompts stream into the
 * same WebSocket session and the same `artifacts.files[]` set.
 */

const FIX_ISSUES_PROMPT = [
  'Review the current codebase and fix any issues you find:',
  '- security vulnerabilities',
  '- type errors, unused imports and dead code',
  '- broken API wiring between frontend and backend',
  '- missing error handling or input validation',
  '- anything flagged by the previous reviewer pass',
  'Do NOT change product behaviour, only correctness and quality.',
].join('\n');

export default function DashboardPage() {
  const store = useStore();
  const socketRef = useRef<WebSocket | null>(null);
  // Tracks the sessionId currently bound to socketRef so we don't reopen
  // the WS on every project-list poll, and so we know when a different
  // session (e.g. one started via curl/Invoke-RestMethod from a terminal,
  // not from this dashboard) has appeared and needs to be attached.
  const attachedSessionIdRef = useRef<string | null>(null);

  // Download state lives at the page level so the button in the center
  // panel and any other surface can share it.
  const [isDownloading, setIsDownloading] = useState(false);
  const [downloadDone,  setDownloadDone]  = useState(false);

  // ── Load + poll projects (initial load auto-selects latest) ───────────────
  const initialLoadDone = useRef(false);
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

  // ── Cleanup socket on unmount ─────────────────────────────────────────────
  useEffect(() => {
    return () => { socketRef.current?.close(); };
  }, []);

  // ── Auto-attach to externally-started runs ────────────────────────────────
  // If a project shows up in the polled list with status='generating' and a
  // sessionId we are NOT currently connected to, open a WS for it. This
  // makes pipeline progress / agent activity / phase bars / live logs show
  // up on the dashboard for projects created via curl, Invoke-RestMethod,
  // or any other client that didn't open the WS itself.
  //
  // Preference order:
  //   1. The currently-selected project, if it is generating.
  //   2. Otherwise the most recent generating project (list is already
  //      sorted desc by createdAt server-side).
  // We only ever bind one socket, so a manual create/update flow (which
  // calls openSocket directly) is never overridden by this effect.
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

    // Adopt this run for the dashboard. Mirrors what handleCreate does
    // for a dashboard-initiated project.
    store.setSelectedProjectId(target.id);
    store.setProjectMode('create');
    store.setRightPanelTab('agents');
    store.setIsGenerating(true);
    store.pushLog('pipeline', `Attaching to external run: ${target.name}`);
    openSocket(sessionId, target.name);
  }, [store.projects, store.selectedProjectId]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Keyboard shortcuts ────────────────────────────────────────────────────
  // Dedicated component mounted at the bottom of this tree handles all
  // shortcuts + exposes the "?" help overlay.

  // ── Shared socket-open helper ─────────────────────────────────────────────
  const openSocket = useCallback((sessionId: string, projectName: string) => {
    if (socketRef.current && socketRef.current.readyState < 2) {
      socketRef.current.close();
    }
    attachedSessionIdRef.current = sessionId;

    const socket = openSessionSocket(
      sessionId,
      (nextProgress) => {
        store.setProgress(nextProgress);
        store.setWsConnected(true);
        if (nextProgress.currentStep) {
          store.pushLog(
            nextProgress.currentStep.agent,
            `${nextProgress.currentStep.name} — ${nextProgress.currentStep.description ?? 'running'}`,
          );
        }
      },
      (status) => {
        store.pushLog('pipeline', `Session ended: ${status}`);
        store.setIsGenerating(false);
        store.setWsConnected(false);
        if (attachedSessionIdRef.current === sessionId) {
          attachedSessionIdRef.current = null;
        }
        if (status === 'completed') {
          store.addToast({ type: 'success', title: 'Build complete', message: projectName });
          // After a successful run we are implicitly in edit mode for follow-ups.
          store.setProjectMode('edit');
        } else if (status === 'failed') {
          store.addToast({ type: 'error',   title: 'Build failed',    message: `Check the logs panel for details.` });
        } else {
          store.addToast({ type: 'warning', title: 'Session ended',   message: `Status: ${status}` });
        }
        listProjects().then((items) => store.setProjects(items)).catch(() => {});
      },
      (message) => {
        store.pushLog('ws', message, 'warn');
        store.setWsConnected(false);
      },
    );

    socketRef.current = socket;
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Create a new project ──────────────────────────────────────────────────
  const handleCreate = useCallback(async (prompt: string) => {
    store.setIsGenerating(true);
    store.setProgress(null);
    store.pushLog('pipeline', 'Submitting new project…');

    try {
      const result = await generateProject(prompt);
      store.setSelectedProjectId(result.projectId);
      store.setProjectMode('create'); // stays in create mode until pipeline ends
      store.setRightPanelTab('agents');
      store.pushLog('pipeline', `Project queued: ${result.project.name}`);
      store.addToast({ type: 'info', title: 'Building project', message: result.project.name });
      openSocket(result.sessionId, result.project.name);
    } catch (e) {
      const human = humanizeError(e, 'Create failed');
      store.pushLog('pipeline', human.message, 'error');
      store.setIsGenerating(false);
      store.addToast({ type: human.severity, title: human.title, message: human.message });
    }
  }, [openSocket]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Update existing project (iteration; state is NOT reset) ───────────────
  const handleUpdate = useCallback(async (prompt: string) => {
    const projectId = store.selectedProjectId;
    if (!projectId) return;

    store.setIsGenerating(true);
    // Do NOT clear the project, files, or preview — keep everything visible
    // while the update pipeline runs. Only reset the live progress metric.
    store.setProgress(null);
    store.pushLog('pipeline', 'Submitting update…');

    try {
      const result = await updateProject(projectId, prompt);
      store.setRightPanelTab('agents');
      store.pushLog('pipeline', `Update queued for: ${result.project.name}`);
      store.addToast({ type: 'info', title: 'Updating project', message: result.project.name });
      openSocket(result.sessionId, result.project.name);
    } catch (e) {
      const human = humanizeError(e, 'Update failed');
      store.pushLog('pipeline', human.message, 'error');
      store.setIsGenerating(false);
      store.addToast({ type: human.severity, title: human.title, message: human.message });
    }
  }, [store.selectedProjectId, openSocket]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Fix Issues (canned update) ────────────────────────────────────────────
  const handleFixIssues = useCallback(() => {
    if (!store.selectedProjectId || store.isGenerating) return;
    void handleUpdate(FIX_ISSUES_PROMPT);
  }, [store.selectedProjectId, store.isGenerating, handleUpdate]);

  // ── Download ──────────────────────────────────────────────────────────────
  const handleDownload = useCallback(async () => {
    const id = store.selectedProjectId;
    const project = store.projects.find((p) => p.id === id);
    if (!id || !project) return;
    setIsDownloading(true);
    try {
      await exportProject(id, project.name);
      setDownloadDone(true);
      store.addToast({ type: 'success', title: 'Download started', message: `${project.name}-export.zip` });
      setTimeout(() => setDownloadDone(false), 2500);
    } catch (err) {
      const human = humanizeError(err, 'Download failed');
      store.addToast({ type: human.severity, title: human.title, message: human.message });
    } finally {
      setIsDownloading(false);
    }
  }, [store.selectedProjectId, store.projects]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── New project (clear selection, keep window alive) ──────────────────────
  const handleNewProject = useCallback(() => {
    store.setSelectedProjectId(null);
    store.setProjectMode('create');
    store.setFiles([]);
    store.setFileContent(null);
    store.setProgress(null);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const selected = store.projects.find((p) => p.id === store.selectedProjectId) ?? null;
  const isEditMode = store.projectMode === 'edit' && !!store.selectedProjectId;
  const canDownload = !!selected && selected.status === 'completed';

  return (
    <div className="app-root">
      <AppHeader onNewProject={handleNewProject} />

      <div className="app-body">
        {/* LEFT — projects */}
        <Sidebar />

        {/* CENTER — AI control */}
        <CenterPanel
          onSubmit={isEditMode ? handleUpdate : handleCreate}
          onFixIssues={handleFixIssues}
          onDownload={handleDownload}
          mode={isEditMode ? 'edit' : 'create'}
          canDownload={canDownload}
          isDownloading={isDownloading}
          downloadDone={downloadDone}
        />

        {/* RIGHT — always-visible live preview (iframe, sandboxed, error-bounded) */}
        <aside
          className="flex flex-col border-l border-white/[0.06] bg-[#0B0F19]/60 overflow-hidden flex-shrink-0"
          style={{ width: 'var(--preview-w)' }}
        >
          <LivePreview />
        </aside>
      </div>

      <LogsPanel />
      <ToastStack />
      <ShowcasePanel />
      <TemplateGallery />
      <KeyboardShortcuts
        onNewProject={handleNewProject}
        onDownload={handleDownload}
        canDownload={canDownload}
      />
    </div>
  );
}
