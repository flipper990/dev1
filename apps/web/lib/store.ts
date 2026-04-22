import { create } from 'zustand';
import type {
  GeneratedProject,
  ProjectFileContent,
  ProjectFileEntry,
  SessionProgress,
  DashboardLog,
} from '../types/dashboard';

export interface ToastItem {
  id: string;
  type: 'success' | 'error' | 'info' | 'warning';
  title: string;
  message?: string;
}

interface DashboardState {
  // Data
  projects: GeneratedProject[];
  selectedProjectId: string | null;
  files: ProjectFileEntry[];
  selectedFilePath: string | null;
  fileContent: ProjectFileContent | null;

  // Generation
  isGenerating: boolean;
  progress: SessionProgress | null;

  // Mode
  projectMode: 'create' | 'edit';

  // Logs
  logs: DashboardLog[];
  logFilter: 'all' | 'info' | 'warn' | 'error';
  logSearch: string;

  // UI
  sidebarCollapsed: boolean;
  logsOpen: boolean;
  rightPanelTab: 'agents' | 'files';
  wsConnected: boolean;
  toasts: ToastItem[];

  // Actions
  setProjects: (projects: GeneratedProject[]) => void;
  setSelectedProjectId: (id: string | null) => void;
  setProjectMode: (mode: 'create' | 'edit') => void;
  setFiles: (files: ProjectFileEntry[]) => void;
  setSelectedFilePath: (path: string | null) => void;
  setFileContent: (content: ProjectFileContent | null) => void;
  setIsGenerating: (v: boolean) => void;
  setProgress: (p: SessionProgress | null) => void;
  pushLog: (source: string, message: string, level?: DashboardLog['level']) => void;
  clearLogs: () => void;
  setLogFilter: (f: 'all' | 'info' | 'warn' | 'error') => void;
  setLogSearch: (s: string) => void;
  toggleSidebar: () => void;
  setLogsOpen: (v: boolean) => void;
  setRightPanelTab: (t: 'agents' | 'files') => void;
  setWsConnected: (v: boolean) => void;
  addToast: (toast: Omit<ToastItem, 'id'>) => void;
  removeToast: (id: string) => void;
}

export const useStore = create<DashboardState>((set) => ({
  projects: [],
  selectedProjectId: null,
  files: [],
  selectedFilePath: null,
  fileContent: null,
  isGenerating: false,
  progress: null,
  projectMode: 'create',
  logs: [],
  logFilter: 'all',
  logSearch: '',
  sidebarCollapsed: false,
  logsOpen: true,
  rightPanelTab: 'agents',
  wsConnected: false,
  toasts: [],

  setProjects: (projects) => set({ projects }),
  setSelectedProjectId: (id) => set({ selectedProjectId: id }),
  setProjectMode: (projectMode) => set({ projectMode }),
  setFiles: (files) => set({ files }),
  setSelectedFilePath: (path) => set({ selectedFilePath: path }),
  setFileContent: (content) => set({ fileContent: content }),
  setIsGenerating: (v) => set({ isGenerating: v }),
  setProgress: (p) => set({ progress: p }),

  pushLog: (source, message, level = 'info') =>
    set((s) => ({
      logs: [
        {
          id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          ts: new Date().toLocaleTimeString(),
          source,
          message,
          level,
        },
        ...s.logs,
      ].slice(0, 500),
    })),

  clearLogs: () => set({ logs: [] }),
  setLogFilter: (logFilter) => set({ logFilter }),
  setLogSearch: (logSearch) => set({ logSearch }),
  toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
  setLogsOpen: (logsOpen) => set({ logsOpen }),
  setRightPanelTab: (rightPanelTab) => set({ rightPanelTab }),
  setWsConnected: (wsConnected) => set({ wsConnected }),

  addToast: (toast) =>
    set((s) => ({
      toasts: [
        ...s.toasts,
        { ...toast, id: `t${Date.now()}${Math.random().toString(36).slice(2, 5)}` },
      ].slice(-5),
    })),

  removeToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}));
