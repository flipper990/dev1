'use client';

import { Tabs, type TabItem } from '../../../../components/ui';

export const WORKSPACE_TABS: TabItem[] = [
  { id: 'overview', label: 'Runtime' },
  { id: 'preview', label: 'Preview state' },
  { id: 'build', label: 'Build graph' },
  { id: 'verify', label: 'Verification' },
  { id: 'activity', label: 'Activity feed' },
  { id: 'logs', label: 'Logs + evidence' },
  { id: 'export', label: 'Ship / export' },
];

export type WorkspaceTabId = (typeof WORKSPACE_TABS)[number]['id'];

interface WorkspaceTabsProps {
  value: WorkspaceTabId;
  onChange: (tab: WorkspaceTabId) => void;
}

export function normalizeWorkspaceTab(value: string | null): WorkspaceTabId {
  if (value === 'launch') return 'export';
  return WORKSPACE_TABS.some((tab) => tab.id === value) ? (value as WorkspaceTabId) : 'overview';
}

export function WorkspaceTabs({ value, onChange }: WorkspaceTabsProps) {
  return (
    <Tabs
      items={WORKSPACE_TABS}
      value={value}
      onChange={(tab) => onChange(normalizeWorkspaceTab(tab))}
      ariaLabel="Workspace sections"
    />
  );
}
