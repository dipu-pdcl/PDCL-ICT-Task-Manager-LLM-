import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuth } from './lib/auth';
import { Layout } from './components/Layout';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import Tasks from './pages/Tasks';
import PriorityTasks from './pages/PriorityTasks';
import LiveStatus from './pages/LiveStatus';
import Leaves from './pages/Leaves';
import TaskDetail from './pages/TaskDetail';
import Users from './pages/Users';
import Teams from './pages/Teams';
import Departments from './pages/Departments';
import Kpi from './pages/Kpi';
import Reports from './pages/Reports';
import SettingsPage from './pages/Settings';
import Audit from './pages/Audit';
import Profile from './pages/Profile';
import Chat from './pages/Chat';
import Projects from './pages/Projects';
import ProjectDetail from './pages/ProjectDetail';

function Protected({
  children,
  permission,
  permissions,
  adminOnly,
}: {
  children: React.ReactNode;
  permission?: string;
  permissions?: string[];
  adminOnly?: boolean;
}) {
  const { user, loading, isAdmin, hasPermission } = useAuth();
  if (loading) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="animate-spin w-8 h-8 rounded-full border-2 border-brand border-t-transparent" />
      </div>
    );
  }
  if (!user) return <Navigate to="/login" replace />;
  if (permission && !hasPermission(permission)) return <Navigate to="/dashboard" replace />;
  if (permissions && !permissions.some((p) => hasPermission(p))) return <Navigate to="/dashboard" replace />;
  if (adminOnly && !isAdmin) return <Navigate to="/dashboard" replace />;
  return <>{children}</>;
}

export default function App() {
  const { user } = useAuth();
  return (
    <Routes>
      <Route path="/login" element={user ? <Navigate to="/dashboard" replace /> : <Login />} />
      <Route element={<Protected><Layout /></Protected>}>
        <Route path="/" element={<Navigate to="/dashboard" replace />} />
        <Route path="/dashboard" element={<Dashboard />} />
        <Route path="/tasks" element={<Protected permissions={['tasks.view', 'tasks.create', 'tasks.edit']}><Tasks /></Protected>} />
        <Route path="/tasks/new" element={<Protected permissions={['tasks.create']}><Tasks /></Protected>} />
        <Route path="/tasks/:id" element={<Protected permissions={['tasks.view', 'tasks.edit']}><TaskDetail /></Protected>} />
        <Route path="/priority-tasks" element={<Protected permissions={['priority_tasks.view', 'priority_tasks.manage']}><PriorityTasks /></Protected>} />
        <Route path="/live-status" element={<Protected permissions={['live_status.view', 'live_status.manage']}><LiveStatus /></Protected>} />
        <Route path="/leaves" element={<Protected permissions={['leaves.view', 'leaves.apply', 'leaves.approve', 'leaves.manage_quotas']}><Leaves /></Protected>} />
        <Route path="/users" element={<Protected permissions={['users.view', 'users.manage']}><Users /></Protected>} />
        <Route path="/teams" element={<Protected permissions={['teams.view', 'teams.manage']}><Teams /></Protected>} />
        <Route path="/departments" element={<Protected permissions={['departments.view', 'departments.manage']}><Departments /></Protected>} />
        <Route path="/kpi" element={<Protected permissions={['kpi.view', 'kpi.manage']}><Kpi /></Protected>} />
        <Route path="/reports" element={<Protected permissions={['reports.view', 'reports.export']}><Reports /></Protected>} />
        <Route path="/audit" element={<Protected permission="audit.view"><Audit /></Protected>} />
        <Route path="/settings" element={<Protected permissions={['settings.view', 'settings.manage', 'roles.manage']}><SettingsPage /></Protected>} />
        <Route path="/profile" element={<Profile />} />
        <Route path="/chat" element={<Chat />} />
        <Route path="/projects" element={<Protected permissions={['tasks.view', 'tasks.create', 'tasks.edit']}><Projects /></Protected>} />
        <Route path="/projects/:id" element={<Protected permissions={['tasks.view', 'tasks.create', 'tasks.edit']}><ProjectDetail /></Protected>} />
        <Route path="*" element={<Navigate to="/dashboard" replace />} />
      </Route>
    </Routes>
  );
}
