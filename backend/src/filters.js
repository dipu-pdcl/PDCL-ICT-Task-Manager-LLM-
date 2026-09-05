import { dateRangeFromKey, today } from './utils.js';
import { isAdmin } from './middleware.js';

export function buildTaskFilter(q, user) {
  const where = [];
  const params = [];
  const and = (sql, ...vals) => { where.push(sql); params.push(...vals); };

  if (q.search) and('(t.title LIKE ? OR t.description LIKE ?)', `%${q.search}%`, `%${q.search}%`);

  const multi = (key, col) => {
    const list = Array.isArray(q[key]) ? q[key] : q[key] ? [q[key]] : [];
    if (list.length && !list.includes('all')) and(`${col} IN (${list.map(() => '?').join(',')})`, ...list);
  };
  multi('status', 't.status');
  multi('priority', 't.priority');
  multi('difficulty', 't.difficulty');
  multi('team_id', 't.team_id');
  multi('department_id', 't.department_id');
  multi('created_by', 't.created_by');
  multi('reviewer', 't.reviewer_id');
  multi('task_type', 't.task_type');

  const assignee = Array.isArray(q.assignee) ? q.assignee : q.assignee ? [q.assignee] : [];
  if (assignee.length && !assignee.includes('all')) {
    const marks = assignee.map(() => '?').join(',');
    and(`t.id IN (SELECT ta.task_id FROM task_assignees ta WHERE ta.user_id IN (${marks}))`, ...assignee);
  }

  const jsonContains = (key, col) => {
    const list = Array.isArray(q[key]) ? q[key] : q[key] ? [q[key]] : [];
    for (const v of list) and(`${col} LIKE ?`, `%"${v}"%`);
  };
  jsonContains('flag', 't.flags');
  jsonContains('tag', 't.tags');

  if (q.due_from) and('t.due_date >= ?', q.due_from);
  if (q.due_to) and('t.due_date <= ?', q.due_to);
  if (q.completed_from) and('t.completed_at >= ?', q.completed_from);
  if (q.completed_to) and('t.completed_at <= ?', q.completed_to);

  if (q.dateKey || (q.date_from && q.date_to) || (q.from && q.to)) {
    const custom = q.dateKey === 'custom' ? { from: q.date_from || q.from, to: q.date_to || q.to } : null;
    const range = dateRangeFromKey(q.dateKey, custom);
    and('t.created_at >= ? AND t.created_at <= ?', range.start, range.end);
  }

  const toggles = {
    overdueOnly: [`t.due_date IS NOT NULL AND t.due_date < ? AND t.status NOT IN ('done','cancelled')`, today()],
    pendingOnly: [`t.status IN ('todo','discussion')`],
    completedOnly: [`t.status = 'done'`],
    highPriority: [`t.priority IN ('high','critical')`],
    criticalOnly: [`t.priority = 'critical'`],
    archived: [`t.archived = 1`],
    active: [`t.archived = 0`],
    is_blocked: [`t.is_blocked = 1`],
    recurring: [`t.is_recurring = 1`],
    myTasks: [`t.id IN (SELECT task_id FROM task_assignees WHERE user_id = ?)`, user.id],
  };
  for (const [flag, sql] of Object.entries(toggles)) {
    if (q[flag] === 'true' || q[flag] === '1' || q[flag] === true) and(...sql);
  }

  if (!isAdmin(user)) {
    and('(t.created_by = ? OR t.id IN (SELECT task_id FROM task_assignees WHERE user_id = ?))', user.id, user.id);
  }
  if (q.archived !== 'true' && q.archived !== '1') and('t.archived = 0');

  return { where, params };
}

export function scopeSql(f, alias = 't') {
  return f.where.length ? f.where.join(' AND ') : '1=1';
}
