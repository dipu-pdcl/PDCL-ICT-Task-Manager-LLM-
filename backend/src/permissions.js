export const PERMISSION_MODULES = [
  {
    id: 'dashboard',
    name: 'Dashboard Overview',
    description: 'Main overview dashboard, productivity metrics, and activity charts',
    permissions: [
      { id: 'dashboard.view', name: 'View Dashboard', description: 'Access dashboard overview, KPIs, and workload metrics' },
    ],
  },
  {
    id: 'tasks',
    name: 'Task Management',
    description: 'Core task workflows, Kanban board, assignments, and tracking',
    permissions: [
      { id: 'tasks.view', name: 'View Tasks', description: 'View task lists, Kanban boards, and task details' },
      { id: 'tasks.create', name: 'Create Tasks', description: 'Create and initiate new tasks' },
      { id: 'tasks.edit', name: 'Edit Tasks', description: 'Update task progress, status, checklists, and time logs' },
      { id: 'tasks.delete', name: 'Delete Tasks', description: 'Delete tasks and attachments' },
      { id: 'tasks.assign', name: 'Assign Tasks', description: 'Assign tasks to other staff members' },
    ],
  },
  {
    id: 'priority_tasks',
    name: 'Priority Tasks',
    description: 'High-priority task board and urgency action items',
    permissions: [
      { id: 'priority_tasks.view', name: 'View Priority Tasks', description: 'View priority task board and urgency list' },
      { id: 'priority_tasks.manage', name: 'Manage Priority Tasks', description: 'Create, update remarks, transfer, or delete priority tasks' },
    ],
  },
  {
    id: 'live_status',
    name: 'Live Status Tracker',
    description: 'Real-time staff online presence, active tasks, and team tracker',
    permissions: [
      { id: 'live_status.view', name: 'View Live Status', description: 'View team presence and active staff tracker' },
      { id: 'live_status.manage', name: 'Manage Live Status', description: 'Update status messages and presence settings' },
    ],
  },
  {
    id: 'leaves',
    name: 'Leave Management',
    description: 'Annual (EL), casual (CL), and sick (SL) leave workflows and balances',
    permissions: [
      { id: 'leaves.view', name: 'View Leaves & Calendar', description: 'View leave calendar, my leave history, and quota balances' },
      { id: 'leaves.apply', name: 'Apply For Leave', description: 'Submit leave applications for self' },
      { id: 'leaves.approve', name: 'Approve / Reject Leaves', description: 'Review and approve/reject staff leave applications' },
      { id: 'leaves.manage_quotas', name: 'Manage Staff Ledger & Quotas', description: 'Adjust annual leave quotas, staff ledger, and export CSV' },
    ],
  },
  {
    id: 'users',
    name: 'Staff & User Directory',
    description: 'Employee profiles, authentication, and credentials',
    permissions: [
      { id: 'users.view', name: 'View Staff Directory', description: 'View staff directory, employee profiles, and contacts' },
      { id: 'users.manage', name: 'Manage Users & Roles', description: 'Create/edit users, assign role groups, and reset passwords' },
    ],
  },
  {
    id: 'teams',
    name: 'Team Management',
    description: 'Functional teams and team leads',
    permissions: [
      { id: 'teams.view', name: 'View Teams', description: 'View team structures and assigned members' },
      { id: 'teams.manage', name: 'Manage Teams', description: 'Create, edit, restructure teams, and assign team leads' },
    ],
  },
  {
    id: 'departments',
    name: 'Branches',
    description: 'Branch offices, branch heads, and locations',
    permissions: [
      { id: 'departments.view', name: 'View Branches', description: 'View branch directory' },
      { id: 'departments.manage', name: 'Manage Branches', description: 'Create, edit branches and assign branch heads' },
    ],
  },
  {
    id: 'kpi',
    name: 'KPI & Performance',
    description: 'Employee KPI scoring, leaderboards, and metrics',
    permissions: [
      { id: 'kpi.view', name: 'View KPI Leaderboard', description: 'View staff performance rankings and metrics' },
      { id: 'kpi.manage', name: 'Manage KPI Rules', description: 'Configure KPI formulas, targets, and scoring weights' },
    ],
  },
  {
    id: 'reports',
    name: 'Reports & Analytics',
    description: 'Operational analytics, charts, and report exports',
    permissions: [
      { id: 'reports.view', name: 'View Reports', description: 'Access operational reports and analytical charts' },
      { id: 'reports.export', name: 'Export Reports', description: 'Export Excel, CSV, and PDF reports' },
    ],
  },
  {
    id: 'audit',
    name: 'Audit Logs & Security',
    description: 'Comprehensive system audit trails and action history',
    permissions: [
      { id: 'audit.view', name: 'View Audit Logs', description: 'Inspect system security logs, user actions, and audit trail' },
    ],
  },
  {
    id: 'settings',
    name: 'Settings & Administration',
    description: 'System configurations, roles, backups, and security',
    permissions: [
      { id: 'settings.view', name: 'View Settings', description: 'View general system settings, statuses, and holidays' },
      { id: 'settings.manage', name: 'Manage System Settings', description: 'Update system configuration, business hours, and backups', super_admin_only: true },
      { id: 'roles.manage', name: 'Manage Role & Permission Groups', description: 'Create, edit, delete custom role groups and configure permissions', super_admin_only: true },
    ],
  },
];

export const SUPER_ADMIN_ONLY_PERMISSIONS = ['settings.manage'];

export const ALL_PERMISSION_IDS = PERMISSION_MODULES.flatMap((m) => m.permissions.map((p) => p.id));

export const NON_SUPER_PERMISSION_IDS = ALL_PERMISSION_IDS.filter((id) => !SUPER_ADMIN_ONLY_PERMISSIONS.includes(id));

/**
 * Hierarchical module filtering:
 * - Super Admin receives all modules and all permissions (including any future ones).
 * - Non-Super users receive ONLY modules and permissions that are explicitly in their assigned scope.
 * - Any permission not granted to the user is completely omitted from the output.
 */
export function getFilteredPermissionModules(userPermissions = [], isSuper = false) {
  if (isSuper) {
    return PERMISSION_MODULES;
  }
  const userPermSet = new Set(Array.isArray(userPermissions) ? userPermissions : []);
  return PERMISSION_MODULES
    .map((m) => ({
      ...m,
      permissions: m.permissions.filter((p) => !p.super_admin_only && userPermSet.has(p.id)),
    }))
    .filter((m) => m.permissions.length > 0);
}

/**
 * Hierarchical permission ID list filtering:
 * - Super Admin receives ALL permission IDs.
 * - Non-Super users receive only the IDs they have been explicitly granted.
 */
export function getFilteredPermissionIds(userPermissions = [], isSuper = false) {
  if (isSuper) {
    return ALL_PERMISSION_IDS;
  }
  const userPermSet = new Set(Array.isArray(userPermissions) ? userPermissions : []);
  return ALL_PERMISSION_IDS.filter((id) => !SUPER_ADMIN_ONLY_PERMISSIONS.includes(id) && userPermSet.has(id));
}

export const DEFAULT_ROLE_GROUPS = [
  {
    slug: 'super_admin',
    name: 'Super Admin',
    description: 'Unrestricted master access to all system modules, configuration, role groups, and disaster recovery.',
    color: '#8b5cf6',
    is_system: 1,
    permissions: ALL_PERMISSION_IDS,
  },
  {
    slug: 'admin',
    name: 'Admin',
    description: 'Full administrative access to manage tasks, staff, leaves, teams, branches, and view audit reports.',
    color: '#3b82f6',
    is_system: 1,
    permissions: [
      'dashboard.view',
      'tasks.view', 'tasks.create', 'tasks.edit', 'tasks.delete', 'tasks.assign',
      'priority_tasks.view', 'priority_tasks.manage',
      'live_status.view', 'live_status.manage',
      'leaves.view', 'leaves.apply', 'leaves.approve', 'leaves.manage_quotas',
      'users.view', 'users.manage',
      'teams.view', 'teams.manage',
      'departments.view', 'departments.manage',
      'kpi.view', 'kpi.manage',
      'reports.view', 'reports.export',
      'audit.view',
      'settings.view',
    ],
  },
  {
    slug: 'sub_admin',
    name: 'Sub-Admin',
    description: 'Mid-level operational access for team leads and supervisors to manage tasks, approve leaves, and view reports.',
    color: '#06b6d4',
    is_system: 1,
    permissions: [
      'dashboard.view',
      'tasks.view', 'tasks.create', 'tasks.edit', 'tasks.assign',
      'priority_tasks.view', 'priority_tasks.manage',
      'live_status.view', 'live_status.manage',
      'leaves.view', 'leaves.apply', 'leaves.approve',
      'users.view',
      'teams.view',
      'departments.view',
      'kpi.view',
      'reports.view', 'reports.export',
    ],
  },
  {
    slug: 'user',
    name: 'User',
    description: 'Standard staff access for everyday work, task execution, time logging, and personal leave applications.',
    color: '#10b981',
    is_system: 1,
    permissions: [
      'dashboard.view',
      'tasks.view', 'tasks.create', 'tasks.edit',
      'priority_tasks.view',
      'live_status.view',
      'leaves.view', 'leaves.apply',
    ],
  },
];
