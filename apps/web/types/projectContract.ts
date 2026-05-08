export type RequirementStatus = 'missing' | 'partial' | 'verified' | 'failed';

export interface ProjectContractFeature {
  id: string;
  title: string;
  priority: 'critical' | 'high' | 'medium' | 'low';
  required: boolean;
  acceptanceTests: string[];
}

export interface ProjectContractFlowStep {
  id: string;
  description: string;
  requirementIds: string[];
}

export interface ProjectContractFlow {
  id: string;
  name: string;
  critical: boolean;
  steps: ProjectContractFlowStep[];
}

export interface ProjectContractEndpoint {
  id: string;
  requirementIds: string[];
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  path: string;
  requestShape?: string;
  responseShape?: string;
}

export interface ProjectContractPage {
  id: string;
  route: string;
  requirementIds: string[];
  requiredElements: string[];
}

export interface ProjectContractNonFunctional {
  id: string;
  requirementIds: string[];
  category: 'auth' | 'error-handling' | 'accessibility' | 'performance' | 'security';
  description: string;
  required: boolean;
}

export interface ProjectContract {
  version: 1;
  generatedAt: string;
  features: ProjectContractFeature[];
  flows: ProjectContractFlow[];
  apiEndpoints: ProjectContractEndpoint[];
  pages: ProjectContractPage[];
  nonFunctional: ProjectContractNonFunctional[];
}

export interface RequirementCoverageItem {
  requirementId: string;
  implementedBy: string[];
  verifiedBy: string[];
  status: RequirementStatus;
  notes?: string;
}

export interface GateResult {
  id: 'spec' | 'build' | 'api' | 'flow' | 'quality' | 'preview';
  label: string;
  passed: boolean;
  critical: boolean;
  details: string[];
  failedRequirementIds: string[];
}

export interface CompletionMetrics {
  requiredSatisfiedPct: number;
  criticalFailuresCount: number;
  flowPassRate: number;
  runtimeHealth: 'healthy' | 'degraded' | 'failed';
}

export interface CompletionReport {
  metrics: CompletionMetrics;
  gates: GateResult[];
  unresolvedRequiredIds: string[];
  canComplete: boolean;
}
