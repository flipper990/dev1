'use client';

import { useCallback, useEffect, useRef } from 'react';
import { AppHeader }   from '../components/AppHeader';
import { Sidebar }     from '../components/Sidebar';
import { PromptPanel } from '../components/PromptPanel';
import { RightPanel }  from '../components/RightPanel';
import { LogsPanel }   from '../components/LogsPanel';
import { LivePreview } from '../components/LivePreview';
import { ToastStack }  from '../components/ToastStack';
import { useStore }    from '../lib/store';
import { generateProject, updateProject, listProjects, openSessionSocket } from '../lib/api';

export default function DashboardPage() {
  const store = useStore();
  const socketRef = useRef<WebSocket | null>(null);

  // ── Load projects ──────────────────────────────────────────────────────────
  const initialLoadDone = useRef(false);
  useEffect(() => {
    const load = (isInitial = false) =>
      listProjects()
        .then((data) => {
          store.setProjects(data);
          // Only auto-select on the very first load — never override a user's
          // explicit "New Project" (selectedProjectId === null) on subsequent polls.
          if (isInitial && !store.selectedProjectId && data.length > 0) {
            store.setSelectedProjectId(data[0].id);
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

  // ── Cleanup socket on unmount ──────────────────────────────────────────────
  useEffect(() => {
    return () => {
      socketRef.current?.close();
    };
  }, []);

  // ── Keyboard shortcuts ─────────────────────────────────────────────────────
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.shiftKey && e.key.toLowerCase() === 'l') {
        e.preventDefault();
        store.setLogsOpen(!store.logsOpen);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [store.logsOpen]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Shared socket-open helper ──────────────────────────────────────────────
  const openSocket = useCallback((sessionId: string, projectName: string) => {
    if (socketRef.current && socketRef.current.readyState < 2) {
      socketRef.current.close();
    }

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

        if (status === 'completed') {
          store.addToast({ type: 'success', title: 'Done!', message: projectName });
        } else {
          store.addToast({ type: 'error', title: 'Pipeline failed', message: `Status: ${status}` });
        }

        listProjects()
          .then((items) => store.setProjects(items))
          .catch(() => {});
      },
      (message) => {
        store.pushLog('ws', message, 'warn');
        store.setWsConnected(false);
      },
    );

    socketRef.current = socket;
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Create new project ─────────────────────────────────────────────────────
  const handleCreate = useCallback(async (prompt: string) => {
    store.setIsGenerating(true);
    store.setProgress(null);
    store.pushLog('pipeline', 'Submitting new project…');

    try {
      const result = await generateProject(prompt);
      store.setSelectedProjectId(result.projectId);
      store.setProjectMode('create'); // keep create mode while generating
      store.setRightPanelTab('agents');
      store.pushLog('pipeline', `Project queued: ${result.project.name}`);
      store.addToast({ type: 'info', title: 'Building project', message: result.project.name });
      openSocket(result.sessionId, result.project.name);
    } catch (e) {
      store.pushLog('pipeline', (e as Error).message, 'error');
      store.setIsGenerating(false);
      store.addToast({ type: 'error', title: 'Create failed', message: (e as Error).message });
    }
  }, [openSocket]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Update existing project ────────────────────────────────────────────────
  const handleUpdate = useCallback(async (prompt: string) => {
    const projectId = store.selectedProjectId;
    if (!projectId) return;

    store.setIsGenerating(true);
    store.setProgress(null);
    store.pushLog('pipeline', 'Submitting update…');

    try {
      const result = await updateProject(projectId, prompt);
      store.setRightPanelTab('agents');
      store.pushLog('pipeline', `Update queued for: ${result.project.name}`);
      store.addToast({ type: 'info', title: 'Updating project', message: result.project.name });
      openSocket(result.sessionId, result.project.name);
    } catch (e) {
      store.pushLog('pipeline', (e as Error).message, 'error');
      store.setIsGenerating(false);
      store.addToast({ type: 'error', title: 'Update failed', message: (e as Error).message });
    }
  }, [store.selectedProjectId, openSocket]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── New project: clear selection ───────────────────────────────────────────
  const handleNewProject = useCallback(() => {
    store.setSelectedProjectId(null);
    store.setProjectMode('create');
    store.setFiles([]);
    store.setFileContent(null);
    store.setProgress(null);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const isEditMode = store.projectMode === 'edit' && !!store.selectedProjectId;

  return (
    <div className="app-root">
      <AppHeader onNewProject={handleNewProject} />

      <div className="app-body">
        <Sidebar />

        <main className="main-workspace">
          <PromptPanel
            onSubmit={isEditMode ? handleUpdate : handleCreate}
            mode={isEditMode ? 'edit' : 'create'}
          />
          <LivePreview />
        </main>

        <RightPanel />
      </div>

      <LogsPanel />
      <ToastStack />
    </div>
  );
}
