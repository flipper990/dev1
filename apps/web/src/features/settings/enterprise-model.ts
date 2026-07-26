export type EnterpriseSection = 'organization' | 'teams' | 'access' | 'approvals' | 'protection' | 'environments' | 'audit';
export type WorkspaceRole = 'Owner' | 'Admin' | 'Developer' | 'Reviewer' | 'Viewer';
export type PermissionKey = 'projects.read' | 'projects.write' | 'projects.protect' | 'exports.create' | 'deployments.create' | 'approvals.review' | 'members.manage' | 'policies.manage' | 'audit.read';

export interface EnterpriseState {
  organization: { id: string; name: string; slug: string; plan: string };
  teams: Array<{ id: string; name: string; description: string; memberIds: string[]; defaultRole: WorkspaceRole }>;
  members: Array<{ id: string; name: string; email: string; role: WorkspaceRole; teamIds: string[]; status: 'active' | 'invited' }>;
  roles: Array<{ name: WorkspaceRole; description: string; system: boolean; permissions: PermissionKey[] }>;
  approvals: Array<{ id: string; action: string; resource: string; requestedBy: string; requestedAt: string; status: 'pending' | 'approved' | 'rejected' }>;
  workflows: Array<{ id: string; name: string; action: 'Export' | 'Deployment' | 'Project change'; environment: string; approverRole: WorkspaceRole; approvalsRequired: number; enabled: boolean }>;
  protections: Array<{ id: string; name: string; type: 'Project' | 'Export' | 'Deployment'; protected: boolean; workflowId: string }>;
  environments: Array<{ id: string; name: string; production: boolean; requireApproval: boolean; restrictDeployments: boolean; allowedRole: WorkspaceRole; retentionDays: number }>;
  audit: Array<{ id: string; actor: string; action: string; resource: string; outcome: 'success' | 'denied' | 'pending'; at: string; detail: string }>;
}

export const PERMISSIONS: Array<{ key: PermissionKey; label: string; group: string }> = [
  { key: 'projects.read', label: 'View projects', group: 'Projects' }, { key: 'projects.write', label: 'Change projects', group: 'Projects' }, { key: 'projects.protect', label: 'Manage protection', group: 'Projects' },
  { key: 'exports.create', label: 'Export source', group: 'Delivery' }, { key: 'deployments.create', label: 'Create deployments', group: 'Delivery' }, { key: 'approvals.review', label: 'Review approvals', group: 'Governance' },
  { key: 'members.manage', label: 'Manage members', group: 'Administration' }, { key: 'policies.manage', label: 'Manage policies', group: 'Administration' }, { key: 'audit.read', label: 'View audit log', group: 'Compliance' },
];

const all = PERMISSIONS.map((permission) => permission.key);
export const DEFAULT_ENTERPRISE_STATE: EnterpriseState = {
  organization: { id: 'org_devteam', name: 'DEVteam Studio', slug: 'devteam-studio', plan: 'Enterprise architecture' },
  teams: [
    { id: 'team_platform', name: 'Platform Engineering', description: 'Core application and runtime owners', memberIds: ['m1', 'm2'], defaultRole: 'Developer' },
    { id: 'team_release', name: 'Release Council', description: 'Production reviewers and approvers', memberIds: ['m1', 'm3'], defaultRole: 'Reviewer' },
  ],
  members: [
    { id: 'm1', name: 'Workspace Owner', email: 'owner@devteam.local', role: 'Owner', teamIds: ['team_platform', 'team_release'], status: 'active' },
    { id: 'm2', name: 'Platform Engineer', email: 'engineer@devteam.local', role: 'Developer', teamIds: ['team_platform'], status: 'active' },
    { id: 'm3', name: 'Release Reviewer', email: 'reviewer@devteam.local', role: 'Reviewer', teamIds: ['team_release'], status: 'active' },
  ],
  roles: [
    { name: 'Owner', description: 'Full organization control', system: true, permissions: all },
    { name: 'Admin', description: 'Administration without ownership transfer', system: true, permissions: all.filter((key) => key !== 'projects.protect') },
    { name: 'Developer', description: 'Build, change, export, and deploy', system: true, permissions: ['projects.read', 'projects.write', 'exports.create', 'deployments.create'] },
    { name: 'Reviewer', description: 'Review changes and protected actions', system: true, permissions: ['projects.read', 'approvals.review', 'audit.read'] },
    { name: 'Viewer', description: 'Read-only workspace access', system: true, permissions: ['projects.read'] },
  ],
  approvals: [
    { id: 'approval_1', action: 'Production deployment', resource: 'Customer portal · production', requestedBy: 'Platform Engineer', requestedAt: new Date(Date.now() - 18 * 60000).toISOString(), status: 'pending' },
    { id: 'approval_2', action: 'Source export', resource: 'Payments service', requestedBy: 'Platform Engineer', requestedAt: new Date(Date.now() - 2 * 3600000).toISOString(), status: 'approved' },
  ],
  workflows: [
    { id: 'wf_prod', name: 'Production release', action: 'Deployment', environment: 'Production', approverRole: 'Reviewer', approvalsRequired: 2, enabled: true },
    { id: 'wf_export', name: 'Protected source export', action: 'Export', environment: 'Any', approverRole: 'Admin', approvalsRequired: 1, enabled: true },
    { id: 'wf_project', name: 'Protected project changes', action: 'Project change', environment: 'Any', approverRole: 'Reviewer', approvalsRequired: 1, enabled: true },
  ],
  protections: [
    { id: 'protect_project', name: 'Customer portal', type: 'Project', protected: true, workflowId: 'wf_project' },
    { id: 'protect_export', name: 'All source exports', type: 'Export', protected: true, workflowId: 'wf_export' },
    { id: 'protect_deploy', name: 'Production deployments', type: 'Deployment', protected: true, workflowId: 'wf_prod' },
  ],
  environments: [
    { id: 'env_prod', name: 'Production', production: true, requireApproval: true, restrictDeployments: true, allowedRole: 'Developer', retentionDays: 365 },
    { id: 'env_stage', name: 'Staging', production: false, requireApproval: false, restrictDeployments: true, allowedRole: 'Developer', retentionDays: 90 },
    { id: 'env_dev', name: 'Development', production: false, requireApproval: false, restrictDeployments: false, allowedRole: 'Developer', retentionDays: 30 },
  ],
  audit: [
    { id: 'audit_seed_1', actor: 'Workspace Owner', action: 'Policy configured', resource: 'Production release', outcome: 'success', at: new Date(Date.now() - 3600000).toISOString(), detail: 'Required two Reviewer approvals.' },
    { id: 'audit_seed_2', actor: 'Platform Engineer', action: 'Approval requested', resource: 'Customer portal · production', outcome: 'pending', at: new Date(Date.now() - 18 * 60000).toISOString(), detail: 'Production deployment is protected.' },
  ],
};
