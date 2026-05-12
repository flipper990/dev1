'use client';

import { useCallback } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import type { AppRouterInstance } from 'next/dist/shared/lib/app-router-context.shared-runtime';
import { exportProject, generateProject, startPreview, updateProject } from '../../../../lib/api';
import type { GeneratedProject } from '../../../../types/dashboard';
import type { PreviewTruthModel } from '../../preview/model';
import type { WorkspaceTabId } from '../components';

type TrackEventFn = (event: string, props?: Record<string, unknown>) => void;

type PreviewRuntimeSnapshot = NonNullable<GeneratedProject['preview']>;

function clearPreviewForGeneration(project: GeneratedProject): GeneratedProject {
  return {
    ...project,
    status: 'generating',
    preview: undefined,
    runtimeValidation: undefined,
    executionValidation: undefined,
  };
}

function markPreviewStarting(project: GeneratedProject): GeneratedProject {
  const previous = project.preview ?? ({} as Partial<PreviewRuntimeSnapshot>);
  return {
    ...project,
    preview: {
      ...previous,
      previewStatus: 'starting',
      previewReady: false,
      previewUrl: null,
      previewStartedAt: new Date().toISOString(),
    },
  };
}

function makeOptimisticProject(projectId: string, prompt: string, name?: string): GeneratedProject {
  return {
    id: projectId,
    sessionId: '',
    name: name?.trim() || 'Generating project',
    status: 'generating',
    prompts: [prompt],
    promptHistory: [{ text: prompt, createdAt: new Date().toISOString() }],
    versions: [],
    totalTokens: 0,
    totalCostUsd: 0,
    durationMs: 0,
    createdAt: new Date().toISOString(),
    stackSelectionMode: 'auto',
    preview: undefined,
  };
}

export function useWorkspaceActions(params: {
  router: AppRouterInstance;
  trackEvent: TrackEventFn;
  activeTab: WorkspaceTabId;
  setActiveTab: (tab: WorkspaceTabId) => void;
  selectedProjectId: string | null;
  selectedProject: GeneratedProject | null;
  status: {
    key: string;
    stage: string;
  };
  previewTruth: PreviewTruthModel;
  previewState: 'idle' | 'starting' | 'ready' | 'failed' | 'stale';
  refreshProject: (projectId: string) => Promise<GeneratedProject | null>;
  setPreviewResetKey: Dispatch<SetStateAction<number>>;
  setOptimisticProject: Dispatch<SetStateAction<GeneratedProject | null>>;
  setLiveMessage: (message: string) => void;
  setErrorMessage: (message: string | null) => void;
  setRetryingPreview: (value: boolean) => void;
  setCommandBusy: (value: boolean) => void;
  setExporting: (value: boolean) => void;
}) {
  const {
    router,
    trackEvent,
    activeTab,
    setActiveTab,
    selectedProjectId,
    selectedProject,
    status,
    previewTruth,
    previewState,
    refreshProject,
    setPreviewResetKey,
    setOptimisticProject,
    setLiveMessage,
    setErrorMessage,
    setRetryingPreview,
    setCommandBusy,
    setExporting,
  } = params;

  const selectProject = useCallback((projectId: string) => {
    router.push(`/workspace?projectId=${encodeURIComponent(projectId)}${activeTab !== 'overview' ? `&tab=${activeTab}` : ''}`);
  }, [activeTab, router]);

  const startOrRetryPreview = useCallback(async () => {
    if (!selectedProjectId || !selectedProject) return;
    setRetryingPreview(true);
    setErrorMessage(null);
    setPreviewResetKey((value) => value + 1);
    setOptimisticProject(markPreviewStarting(selectedProject));
    setLiveMessage(`Starting preview for ${selectedProjectId}.`);

    trackEvent('preview_retry_clicked', {
      route: '/workspace',
      project_stage: status.stage,
      preview_state: previewState,
      retry_count: 1,
      action_source: 'workspace-preview-action',
    });

    try {
      await startPreview(selectedProjectId);
      await refreshProject(selectedProjectId);
      setLiveMessage('Preview run completed. Review the latest status.');
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Preview start failed.');
      await refreshProject(selectedProjectId).catch(() => null);
    } finally {
      setRetryingPreview(false);
    }
  }, [
    previewState,
    refreshProject,
    selectedProject,
    selectedProjectId,
    setErrorMessage,
    setLiveMessage,
    setOptimisticProject,
    setPreviewResetKey,
    setRetryingPreview,
    status.stage,
    trackEvent,
  ]);

  const handlePrimaryAction = useCallback(() => {
    if (!selectedProject) return;
    if (previewTruth.isFailure) {
      void startOrRetryPreview();
      return;
    }
    if (previewTruth.isBroken) {
      setActiveTab('logs');
      return;
    }
    if (previewTruth.isPlaceholder) {
      setActiveTab('verify');
      return;
    }
    if (status.key === 'preview-failed' || status.key === 'build-complete' || status.key === 'stale') {
      void startOrRetryPreview();
      return;
    }
    if (status.key === 'preview-starting') {
      setActiveTab('logs');
      return;
    }
    if (status.key === 'verification-pending' || status.key === 'preview-ready') {
      setActiveTab('verify');
      return;
    }
    if (status.key === 'launch-ready') {
      setActiveTab('export');
      return;
    }
    setActiveTab('build');
  }, [previewTruth.isBroken, previewTruth.isFailure, previewTruth.isPlaceholder, selectedProject, setActiveTab, startOrRetryPreview, status.key]);

  const handleCommandSubmit = useCallback(async (command: string) => {
    setCommandBusy(true);
    setErrorMessage(null);
    setPreviewResetKey((value) => value + 1);

    try {
      if (selectedProjectId && selectedProject) {
        setOptimisticProject(clearPreviewForGeneration(selectedProject));
        setLiveMessage(`Submitting change request for ${selectedProjectId}.`);
        trackEvent('command_submitted', {
          route: '/workspace',
          project_stage: status.stage,
          action_source: 'command-dock-change-request',
        });
        await updateProject(selectedProjectId, command);
        await refreshProject(selectedProjectId);
        setActiveTab('build');
      } else {
        setLiveMessage('Creating a new project from command dock.');
        trackEvent('command_submitted', {
          route: '/workspace',
          project_stage: 'decide',
          action_source: 'command-dock-create-project',
        });
        const result = await generateProject(command);
        const optimistic = makeOptimisticProject(result.projectId, command, result.project.name);
        setOptimisticProject(optimistic);
        router.replace(`/workspace?projectId=${encodeURIComponent(result.projectId)}&tab=build`);
        await refreshProject(result.projectId);
        setActiveTab('build');
      }
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Command failed.');
    } finally {
      setCommandBusy(false);
    }
  }, [
    refreshProject,
    router,
    selectedProject,
    selectedProjectId,
    setActiveTab,
    setCommandBusy,
    setErrorMessage,
    setLiveMessage,
    setOptimisticProject,
    setPreviewResetKey,
    status.stage,
    trackEvent,
  ]);

  const handleExport = useCallback(async () => {
    if (!selectedProjectId || !selectedProject) return;
    setExporting(true);
    setErrorMessage(null);
    try {
      await exportProject(selectedProjectId, selectedProject.name);
      setLiveMessage('Source export started.');
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Export failed.');
    } finally {
      setExporting(false);
    }
  }, [selectedProject, selectedProjectId, setErrorMessage, setExporting, setLiveMessage]);

  return {
    selectProject,
    startOrRetryPreview,
    handlePrimaryAction,
    handleCommandSubmit,
    handleExport,
  };
}
