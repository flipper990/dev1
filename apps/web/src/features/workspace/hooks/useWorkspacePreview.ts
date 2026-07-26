'use client';

import { useEffect, useMemo, useState } from 'react';
import { normalizeWorkspaceTab, type WorkspaceTabId } from '../components';
import type { GeneratedProject } from '../../../../types/dashboard';
import type { PreviewTruthModel } from '../../preview/model';

export type PreviewDevice = 'desktop' | 'tablet' | 'mobile';

function getPreviewTelemetryState(previewTruth: PreviewTruthModel): 'idle' | 'starting' | 'ready' | 'failed' | 'stale' {
  if (previewTruth.contradictions.length > 0) return 'stale';
  if (previewTruth.isHealthy) return 'ready';
  if (previewTruth.isFailure || previewTruth.isBroken) return 'failed';
  if (previewTruth.isLoading) return 'starting';
  return 'idle';
}

export function useWorkspacePreview(params: {
  rawTab: string | null;
  routeProjectId: string | null;
  selectedProjectId: string | null;
  selectedProject: GeneratedProject | null;
  previewTruth: PreviewTruthModel;
}) {
  const { rawTab, routeProjectId, selectedProjectId, selectedProject, previewTruth } = params;

  const [activeTab, setActiveTab] = useState<WorkspaceTabId>(() => normalizeWorkspaceTab(rawTab));
  const [previewDevice, setPreviewDevice] = useState<PreviewDevice>('desktop');
  const [previewResetKey, setPreviewResetKey] = useState(0);
  const [evidenceOpen, setEvidenceOpen] = useState(() => rawTab !== null && normalizeWorkspaceTab(rawTab) !== 'overview');

  useEffect(() => {
    setActiveTab(normalizeWorkspaceTab(rawTab));
  }, [rawTab]);

  useEffect(() => {
    if (activeTab !== 'code') setEvidenceOpen(true);
  }, [activeTab]);

  useEffect(() => {
    setPreviewDevice('desktop');
    setPreviewResetKey((value) => value + 1);
  }, [routeProjectId]);

  const previewState = getPreviewTelemetryState(previewTruth);
  const previewKey = useMemo(
    () => `${selectedProjectId ?? 'none'}:${previewResetKey}:${selectedProject?.preview?.previewId ?? selectedProject?.preview?.previewReadyAt ?? selectedProject?.preview?.previewStatus ?? 'empty'}`,
    [previewResetKey, selectedProject?.preview?.previewId, selectedProject?.preview?.previewReadyAt, selectedProject?.preview?.previewStatus, selectedProjectId],
  );

  return {
    activeTab,
    setActiveTab,
    previewDevice,
    setPreviewDevice,
    previewResetKey,
    setPreviewResetKey,
    evidenceOpen,
    setEvidenceOpen,
    previewState,
    previewKey,
  };
}
