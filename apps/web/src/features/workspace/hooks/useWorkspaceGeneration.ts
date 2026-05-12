'use client';

import { useEffect, useState } from 'react';
import type { GeneratedProject } from '../../../../types/dashboard';

export function useWorkspaceGeneration(params: {
  routeProjectId: string | null;
  selectedProjectId: string | null;
  selectedProject: GeneratedProject | null;
  projectLoading: boolean;
  onRouteChanged: () => void;
}) {
  const {
    routeProjectId,
    selectedProjectId,
    selectedProject,
    projectLoading,
    onRouteChanged,
  } = params;

  const [commandBusy, setCommandBusy] = useState(false);
  const [retryingPreview, setRetryingPreview] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [liveMessage, setLiveMessage] = useState('Workspace ready.');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    onRouteChanged();
    setErrorMessage(null);

    if (!routeProjectId) {
      setLiveMessage('No project selected. Choose another project or create a new one.');
      return;
    }

    setLiveMessage(`Loading project ${routeProjectId}.`);
  }, [onRouteChanged, routeProjectId]);

  useEffect(() => {
    if (!selectedProjectId || projectLoading) return;
    if (selectedProject) {
      setLiveMessage(`Project loaded: ${selectedProject.name}.`);
      return;
    }
    setLiveMessage(`Project ${selectedProjectId} was not found.`);
  }, [projectLoading, selectedProject, selectedProjectId]);

  return {
    commandBusy,
    setCommandBusy,
    retryingPreview,
    setRetryingPreview,
    exporting,
    setExporting,
    liveMessage,
    setLiveMessage,
    errorMessage,
    setErrorMessage,
  };
}
