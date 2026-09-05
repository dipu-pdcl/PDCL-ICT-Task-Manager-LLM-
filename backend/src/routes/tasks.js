import { Router } from 'express';
import { db } from '../db.js';
import { requireAuth, requirePermission, requireAdmin, isAdmin, audit, logHistory, notify } from '../middleware.js';
import { dateRangeFromKey, today, now } from '../utils.js';
import { getStatusById, getPriorityById, getDifficultyById } from '../config.js';
import { updateProjectProgressForTask } from './projects.js';

const router = Router();
router.use(requireAuth);

function canViewTask(user, task, assignees) {
  if (isAdmin(user)) return true;
  if (task.created_by === user.id) return true;
  return (assignees || []).some((a) => a.user_id === user.id);
}

function loadTask(req, res, next) {
  const t = db.prepare('SELECT * FROM tasks WHERE id = ?').get(req.params.id);
  if (!t) return res.status(404).json({ error: 'Task not found' });
  const assignees = fetchAssignees(t.id);
  if (!canViewTask(req.user, t, assignees)) return res.status(403).json({ error: 'No access to this task' });
  req.task = t;
  req.taskAssignees = assignees;
  next();
}

function safeParse(s, fallback) {
  try { return JSON.parse(s || '[]'); } catch { return fallback; }
}

function fetchAssignees(taskId) {
  return db.prepare(`
    SELECT ta.*, u.name AS user_name, u.avatar, u.team_id
    FROM task_assignees ta JOIN users u ON u.id = ta.user_id WHERE ta.task_id = ? ORDER BY ta.assigned_at
  `).all(taskId);
}

function taskJson(t, withAssignees = true) {
  const assignees = withAssignees ? fetchAssignees(t.id) : [];
  const commentsCount = db.prepare('SELECT COUNT(*) AS c FROM task_comments WHERE task_id = ?').get(t.id).c;
  const checkCount = db.prepare('SELECT COUNT(*) AS c, COALESCE(SUM(done),0) AS d FROM task_checklist WHERE task_id = ?').get(t.id);
  const attCount = db.prepare('SELECT COUNT(*) AS c FROM task_attachments WHERE task_id = ?').get(t.id).c;
  return {
    ...t,
    flags: safeParse(t.flags, []),
    tags: safeParse(t.tags, []),
    assignees,
    comments_count: commentsCount,
    checklist: { total: checkCount.c, done: checkCount.d || 0 },
    attachments_count: attCount,
    status_meta: getStatusById(t.status),
    priority_meta: getPriorityById(t.priority),
    difficulty_meta: getDifficultyById(t.difficulty),
  };
}

const sortMap = {
  due_date: 't.due_date',
  priority: 't.priority',
  status: 't.status',
  created: 't.created_at',
  updated: 't.updated_at',
  title: 't.title',
};

router.get('/', (req, res) => {
  const q = req.query;
  const role = req.user.role;
  const isAdminUser = isAdmin(req.user);

  const where = [];
  const params = [];
  const and = (sql, ...vals) => { where.push(sql); params.push(...vals); };

  if (q.search) {
    and('(t.title LIKE ? OR t.description LIKE ?)', `%${q.search}%`, `%${q.search}%`);
  }
  if (q.status) {
    const list = Array.isArray(q.status) ? q.status : [q.status];
    if (list.length && !list.includes('all')) {
      and(`t.status IN (${list.map(() => '?').join(',')})`, ...list);
    }
  }
  if (q.priority) {
    const list = Array.isArray(q.priority) ? q.priority : [q.priority];
    if (list.length && !list.includes('all')) and(`t.priority IN (${list.map(() => '?').join(',')})`, ...list);
  }
  if (q.difficulty) {
    const list = Array.isArray(q.difficulty) ? q.difficulty : [q.difficulty];
    if (list.length && !list.includes('all')) and(`t.difficulty IN (${list.map(() => '?').join(',')})`, ...list);
  }
  if (q.team_id) {
    const list = Array.isArray(q.team_id) ? q.team_id : [q.team_id];
    if (list.length && !list.includes('all')) and(`t.team_id IN (${list.map(() => '?').join(',')})`, ...list);
  }
  if (q.department_id) {
    const list = Array.isArray(q.department_id) ? q.department_id : [q.department_id];
    if (list.length && !list.includes('all')) and(`t.department_id IN (${list.map(() => '?').join(',')})`, ...list);
  }
  if (q.assignee) {
    const list = Array.isArray(q.assignee) ? q.assignee : [q.assignee];
    if (list.length && !list.includes('all')) {
      const marks = list.map(() => '?').join(',');
      and(`t.id IN (SELECT ta.task_id FROM task_assignees ta WHERE ta.user_id IN (${marks}))`, ...list);
    }
  }
  if (q.created_by) {
    const list = Array.isArray(q.created_by) ? q.created_by : [q.created_by];
    if (list.length && !list.includes('all')) and(`t.created_by IN (${list.map(() => '?').join(',')})`, ...list);
  }
  if (q.reviewer) {
    const list = Array.isArray(q.reviewer) ? q.reviewer : [q.reviewer];
    if (list.length && !list.includes('all')) and(`t.reviewer_id IN (${list.map(() => '?').join(',')})`, ...list);
  }
  if (q.task_type) {
    const list = Array.isArray(q.task_type) ? q.task_type : [q.task_type];
    if (list.length && !list.includes('all')) and(`t.task_type IN (${list.map(() => '?').join(',')})`, ...list);
  }
  if (q.due_from) and('t.due_date >= ?', q.due_from);
  if (q.due_to) and('t.due_date <= ?', q.due_to);
  if (q.completed_from) and('t.completed_at >= ?', q.completed_from);
  if (q.completed_to) and('t.completed_at <= ?', q.completed_to);

  if (q.dateKey || (q.date_from && q.date_to)) {
    const range = dateRangeFromKey(q.dateKey, q.dateKey === 'custom' ? { from: q.date_from, to: q.date_to } : null);
    and('t.created_at >= ? AND t.created_at <= ?', range.start, range.end);
  }

  const truthy = ['overdueOnly', 'pendingOnly', 'completedOnly', 'highPriority', 'criticalOnly', 'archived', 'active', 'is_blocked', 'recurring', 'myTasks'];
  for (const flag of truthy) {
    if (q[flag] === 'true' || q[flag] === '1' || q[flag] === true) {
      if (flag === 'overdueOnly') and('t.due_date IS NOT NULL AND t.due_date < ? AND t.status NOT IN (\'done\',\'cancelled\')', today());
      if (flag === 'pendingOnly') and('t.status IN (\'todo\',\'discussion\')');
      if (flag === 'completedOnly') and('t.status = \'done\'');
      if (flag === 'highPriority') and('t.priority IN (\'high\',\'critical\')');
      if (flag === 'criticalOnly') and('t.priority = \'critical\'');
      if (flag === 'archived') and('t.archived = 1');
      if (flag === 'active') and('t.archived = 0');
      if (flag === 'is_blocked') and('t.is_blocked = 1');
      if (flag === 'recurring') and('t.is_recurring = 1');
      if (flag === 'myTasks') and('t.id IN (SELECT task_id FROM task_assignees WHERE user_id = ?)', req.user.id);
    }
  }

  if (!isAdminUser) {
    and('(t.created_by = ? OR t.id IN (SELECT task_id FROM task_assignees WHERE user_id = ?))', req.user.id, req.user.id);
  }
  if (q.archived !== 'true' && q.archived !== '1') {
    and('t.archived = 0');
  }

  const sortCol = sortMap[q.sort] || 't.updated_at';
  const sortDir = q.sortDir === 'asc' ? 'ASC' : 'DESC';
  const limit = Math.min(parseInt(q.limit || '500'), 1000);

  let rows;
  try {
    rows = db.prepare(`
      SELECT t.*, c.name AS created_by_name, c.avatar AS creator_avatar,
        r.name AS reviewer_name, te.name AS team_name, d.name AS department_name,
        u2.name AS assigned_names
      FROM tasks t
      LEFT JOIN users c ON c.id = t.created_by
      LEFT JOIN users r ON r.id = t.reviewer_id
      LEFT JOIN teams te ON te.id = t.team_id
      LEFT JOIN departments d ON d.id = t.department_id
      LEFT JOIN (SELECT ta.task_id, GROUP_CONCAT(u.name, ', ') AS name
        FROM task_assignees ta JOIN users u ON u.id = ta.user_id GROUP BY ta.task_id) u2 ON u2.task_id = t.id
      ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
      ORDER BY ${sortCol} ${sortDir}
      LIMIT ${limit}
    `).all(...params);
  } catch (e) {
    return res.status(400).json({ error: 'Invalid filter combination' });
  }

  const flags = Array.isArray(q.flag) ? q.flag : q.flag ? [q.flag] : [];
  const tags = Array.isArray(q.tag) ? q.tag : q.tag ? [q.tag] : [];

  let result = rows.map((t) => taskJson(t));
  if (flags.length) {
    result = result.filter((t) => t.flags.some((f) => flags.includes(f)));
  }
  if (tags.length) {
    result = result.filter((t) => t.tags.some((f) => tags.includes(f)));
  }
  res.json(result);
});

router.get('/overview', (req, res) => {
  const isAdminUser = isAdmin(req.user);
  const uid = req.user.id;
  const scope = isAdminUser ? '1=1' : `(created_by = ${uid} OR id IN (SELECT task_id FROM task_assignees WHERE user_id = ${uid}))`;
  const num = (sql) => db.prepare(`SELECT COUNT(*) c FROM tasks t WHERE ${scope} AND ${sql}`).get().c;
  const data = {
    total: num('1=1'),
    open: num(`status NOT IN ('done','cancelled')`),
    done: num(`status = 'done'`),
    cancelled: num(`status = 'cancelled'`),
    overdue: num(`due_date IS NOT NULL AND due_date < '${today()}' AND status NOT IN ('done','cancelled')`),
    pending: num(`status IN ('todo','discussion')`),
    inProgress: num(`status = 'in_progress'`),
    inReview: num(`status = 'in_review'`),
    dueToday: num(`due_date = '${today()}' AND status NOT IN ('done','cancelled')`),
    blocked: num(`is_blocked = 1`),
    critical: num(`priority = 'critical' AND status NOT IN ('done','cancelled')`),
    completionRate: 0,
    doneToday: num(`status = 'done' AND date(completed_at) = '${today()}'`),
    avgCompletionHours: 0,
  };
  data.completionRate = data.total ? Math.round((data.done / data.total) * 100) : 0;
  const avg = db.prepare(`
    SELECT ROUND(AVG((julianday(completed_at) - julianday(created_at)) * 24), 1) v
    FROM tasks WHERE status = 'done' AND ${scope} AND completed_at IS NOT NULL
  `).get().v;
  data.avgCompletionHours = avg || 0;
  res.json(data);
});

router.get('/:id', (req, res) => {
  const t = db.prepare(`
    SELECT t.*, c.name AS created_by_name, c.avatar AS creator_avatar, r.name AS reviewer_name,
      te.name AS team_name, d.name AS department_name
    FROM tasks t
    LEFT JOIN users c ON c.id = t.created_by
    LEFT JOIN users r ON r.id = t.reviewer_id
    LEFT JOIN teams te ON te.id = t.team_id
    LEFT JOIN departments d ON d.id = t.department_id
    WHERE t.id = ?`).get(req.params.id);
  if (!t) return res.status(404).json({ error: 'Task not found' });
  const assignees = fetchAssignees(t.id);
  if (!canViewTask(req.user, t, assignees)) return res.status(403).json({ error: 'No access to this task' });
  const comments = db.prepare(`
    SELECT tc.*, u.name AS user_name, u.avatar FROM task_comments tc
    JOIN users u ON u.id = tc.user_id WHERE tc.task_id = ? ORDER BY tc.created_at DESC
  `).all(t.id).map((c) => ({ ...c, mentions: safeParse(c.mentions, []) }));
  const checklistItems = db.prepare('SELECT * FROM task_checklist WHERE task_id = ? ORDER BY id').all(t.id);
  const attachments = db.prepare('SELECT * FROM task_attachments WHERE task_id = ? ORDER BY uploaded_at DESC').all(t.id);
  const history = db.prepare(`
    SELECT th.*, u.name AS user_name FROM task_history th
    LEFT JOIN users u ON u.id = th.user_id WHERE th.task_id = ? ORDER BY th.created_at DESC LIMIT 100
  `).all(t.id);
  const deps = db.prepare(`
    SELECT td.depends_on, tt.title AS title, tt.status FROM task_dependencies td
    JOIN tasks tt ON tt.id = td.depends_on WHERE td.task_id = ?`).all(t.id);
  const dependents = db.prepare(`
    SELECT td.task_id, tt.title AS title FROM task_dependencies td
    JOIN tasks tt ON tt.id = td.task_id WHERE td.depends_on = ?`).all(t.id);
  const approvals = db.prepare(`
    SELECT a.*, u.name AS requester_name, u2.name AS approver_name FROM approvals a
    LEFT JOIN users u ON u.id = a.requester_id LEFT JOIN users u2 ON u2.id = a.approver_id
    WHERE a.task_id = ? ORDER BY a.created_at DESC`).all(t.id);
  const time = db.prepare(`
    SELECT te.*, u.name AS user_name FROM time_entries te
    JOIN users u ON u.id = te.user_id WHERE te.task_id = ? ORDER BY te.date DESC`).all(t.id);

  res.json({ ...taskJson(t), comments, checklist_items: checklistItems, attachments, history, dependencies: deps, dependents, approvals, time_entries: time });
});

router.post('/', (req, res) => {
  const b = req.body || {};
  const required = ['title', 'status', 'priority'];
  for (const f of required) if (!b[f]) return res.status(400).json({ error: `${f} is required` });

  const flags = JSON.stringify(Array.isArray(b.flags) ? b.flags : []);
  const tags = JSON.stringify(Array.isArray(b.tags) ? b.tags : []);
  const isSelfTask = b.is_self_task ? 1 : 0;
  if (isSelfTask && isAdmin(req.user)) {
    return res.status(403).json({ error: 'Self tasks are only available in user mode' });
  }
  const assigneeIds = Array.isArray(b.assignees) ? [...new Set(b.assignees.map(Number).filter((n) => Number.isFinite(n)))] : [];
  const checklist = Array.isArray(b.checklist) ? b.checklist : [];
  if (isSelfTask) {
    assigneeIds.length = 0;
    assigneeIds.push(req.user.id);
  }

  const r = db.prepare(`
    INSERT INTO tasks (
      title, description, status, priority, difficulty, task_type, flags, tags,
      budget, estimated_hours, due_date, start_date, created_by, reviewer_id, team_id, department_id,
      parent_task_id, progress, is_blocked, is_recurring, recurring_rule, is_self_task, project_id
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    b.title, b.description || '', b.status, b.priority, b.difficulty || 'medium', b.task_type || 'task',
    flags, tags, b.budget || 0, b.estimated_hours || 0, b.due_date || null, b.start_date || null,
    req.user.id, b.reviewer_id || null, b.team_id || null, b.department_id || null,
    b.parent_task_id || null, b.progress || 0, b.is_blocked ? 1 : 0, b.is_recurring ? 1 : 0, b.recurring_rule || '',
    isSelfTask,
    b.project_id || null,
  );
  const taskId = Number(r.lastInsertRowid);

  const addAssignee = db.prepare(`
    INSERT INTO task_assignees (task_id, user_id, progress, status) VALUES (?, ?, ?, ?)
  `);
  for (const uid of assigneeIds) {
    addAssignee.run(taskId, uid, b.progress || 0, b.status);
    const u = db.prepare('SELECT name FROM users WHERE id = ?').get(uid);
    notify(uid, 'task', 'Task assigned to you', b.title, `/tasks/${taskId}`);
    logHistory(taskId, req.user.id, 'assignee.add', 'assignee', '', u?.name || '');
  }
  const addCheck = db.prepare('INSERT INTO task_checklist (task_id, title, created_by) VALUES (?, ?, ?)');
  for (const c of checklist) addCheck.run(taskId, c, req.user.id);

  audit(req, 'task.create', 'task', taskId, `Created task "${b.title}"`);
  logHistory(taskId, req.user.id, 'task.create', 'title', '', b.title);
  res.json(taskJson(db.prepare('SELECT * FROM tasks WHERE id = ?').get(taskId)));
});

router.put('/:id', loadTask, (req, res) => {
  const id = Number(req.params.id);
  const t = req.task;
  const b = req.body || {};
  const oldStatus = t.status;
  const oldDue = t.due_date;

  const updatable = ['title', 'description', 'status', 'priority', 'difficulty', 'task_type', 'flags', 'tags',
    'budget', 'estimated_hours', 'due_date', 'start_date', 'reviewer_id', 'team_id', 'department_id',
    'parent_task_id', 'is_blocked', 'is_recurring', 'recurring_rule', 'archived', 'project_id'];
  const sets = [];
  const params = [];
  for (const f of updatable) {
    if (b[f] !== undefined) {
      sets.push(`${f} = ?`);
      const raw = b[f];
      params.push(
        f === 'flags' || f === 'tags'
          ? JSON.stringify(Array.isArray(raw) ? raw : [])
          : typeof raw === 'object' && raw !== null
            ? JSON.stringify(raw)
            : typeof raw === 'boolean'
              ? (raw ? 1 : 0)
              : raw
      );
      if (f === 'status' && b[f] !== oldStatus) {
        logHistory(id, req.user.id, 'status.change', 'status', oldStatus, b[f]);
        if (b[f] === 'done') {
          db.prepare('UPDATE tasks SET completed_at = datetime(\'now\',\'+6 hours\') WHERE id = ?').run(id);
        } else if (oldStatus === 'done') {
          db.prepare('UPDATE tasks SET completed_at = NULL WHERE id = ?').run(id);
        }
      }
      if (f === 'due_date' && b[f] !== oldDue) logHistory(id, req.user.id, 'due.change', 'due_date', oldDue, b[f]);
    }
  }
  if (b.assignees !== undefined) {
    const current = db.prepare('SELECT user_id FROM task_assignees WHERE task_id = ?').all(id).map((x) => x.user_id);
    const next = [...new Set((Array.isArray(b.assignees) ? b.assignees : []).map(Number).filter((n) => Number.isFinite(n)))];
    const toAdd = next.filter((x) => !current.includes(x));
    const toRemove = current.filter((x) => !next.includes(x));
    const del = db.prepare('DELETE FROM task_assignees WHERE task_id = ? AND user_id = ?');
    for (const uid of toRemove) {
      del.run(id, uid);
      logHistory(id, req.user.id, 'assignee.remove', 'assignee', String(uid), '');
    }
    const add = db.prepare('INSERT INTO task_assignees (task_id, user_id, status) VALUES (?, ?, ?)');
    for (const uid of toAdd) {
      add.run(id, uid, t.status);
      const u = db.prepare('SELECT name FROM users WHERE id = ?').get(uid);
      notify(uid, 'task', 'Task assigned to you', t.title, `/tasks/${id}`);
      logHistory(id, req.user.id, 'assignee.add', 'assignee', '', u?.name || '');
    }
  }

  sets.push('updated_at = datetime(\'now\',\'+6 hours\')');
  if (sets.length) db.prepare(`UPDATE tasks SET ${sets.join(', ')} WHERE id = ?`).run(...params, id);
  if (b.status !== undefined && b.status !== oldStatus) {
    try { updateProjectProgressForTask(id); } catch {}
  }
  audit(req, 'task.update', 'task', id, `Updated task "${b.title || t.title}"`);
  res.json(taskJson(db.prepare('SELECT * FROM tasks WHERE id = ?').get(id)));
});

router.delete('/:id', requirePermission('tasks.delete'), (req, res) => {
  const id = Number(req.params.id);
  const t = db.prepare('SELECT * FROM tasks WHERE id = ?').get(id);
  if (!t) return res.status(404).json({ error: 'Task not found' });
  db.prepare('DELETE FROM tasks WHERE id = ?').run(id);
  audit(req, 'task.delete', 'task', id, `Deleted task "${t.title}"`);
  res.json({ ok: true });
});

router.post('/:id/assignees', loadTask, (req, res) => {
  const id = Number(req.params.id);
  const { user_id } = req.body || {};
  if (!user_id) return res.status(400).json({ error: 'user_id required' });
  db.prepare('INSERT OR IGNORE INTO task_assignees (task_id, user_id) VALUES (?, ?)').run(id, user_id);
  const u = db.prepare('SELECT name FROM users WHERE id = ?').get(user_id);
  notify(user_id, 'task', 'Task assigned to you', db.prepare('SELECT title FROM tasks WHERE id=?').get(id).title, `/tasks/${id}`);
  audit(req, 'task.assignee_add', 'task', id, `Assigned ${u?.name} to task`);
  res.json({ ok: true });
});

router.delete('/:id/assignees/:userId', loadTask, (req, res) => {
  db.prepare('DELETE FROM task_assignees WHERE task_id = ? AND user_id = ?').run(req.params.id, req.params.userId);
  res.json({ ok: true });
});

router.put('/:id/assignees/:userId/progress', loadTask, (req, res) => {
  const id = Number(req.params.id);
  const userId = Number(req.params.userId);
  const { progress } = req.body || {};
  const a = db.prepare('SELECT * FROM task_assignees WHERE task_id = ? AND user_id = ?').get(id, userId);
  if (!a) return res.status(404).json({ error: 'Assignee not found' });
  const p = Math.max(0, Math.min(100, Number(progress) || 0));
  const newStatus = p >= 100 ? 'done' : a.status;
  db.prepare(`UPDATE task_assignees SET progress = ?, status = ?, completed_at = ? WHERE id = ?`)
    .run(p, newStatus, p >= 100 ? now() : null, a.id);
  db.prepare('UPDATE tasks SET updated_at = datetime(\'now\',\'+6 hours\') WHERE id = ?').run(id);
  if (p >= 100 && a.status !== 'done') {
    logHistory(id, req.user.id, 'assignee.complete', 'progress', a.progress, 100);
    notify(db.prepare('SELECT created_by FROM tasks WHERE id=?').get(id).created_by, 'task', 'Assignee completed task', `Progress for task updated`, `/tasks/${id}`);
  } else {
    logHistory(id, req.user.id, 'progress.change', 'progress', a.progress, p);
  }
  res.json({ ok: true, progress: p, status: newStatus });
});

router.post('/:id/status', loadTask, (req, res) => {
  const id = Number(req.params.id);
  const { status } = req.body || {};
  const t = req.task;
  if (!status) return res.status(400).json({ error: 'status required' });
  db.prepare('UPDATE tasks SET status = ?, updated_at = datetime(\'now\',\'+6 hours\') WHERE id = ?').run(status, id);
  db.prepare('UPDATE task_assignees SET status = ? WHERE task_id = ? AND status != \'done\'').run(status, id);
  if (status === 'done') {
    db.prepare('UPDATE tasks SET completed_at = datetime(\'now\',\'+6 hours\'), progress = 100 WHERE id = ?').run(id);
    db.prepare('UPDATE task_assignees SET progress = 100, completed_at = datetime(\'now\',\'+6 hours\') WHERE task_id = ?').run(id);
  } else {
    db.prepare('UPDATE tasks SET completed_at = NULL WHERE id = ?').run(id);
  }
  logHistory(id, req.user.id, 'status.change', 'status', t.status, status);
  audit(req, 'task.status_change', 'task', id, `Moved task "${t.title}" to ${status}`);
  try { updateProjectProgressForTask(id); } catch {}
  res.json({ ok: true });
});

router.post('/:id/comments', loadTask, (req, res) => {
  const id = Number(req.params.id);
  const { content, mentions } = req.body || {};
  if (!content) return res.status(400).json({ error: 'Comment content required' });
  const r = db.prepare('INSERT INTO task_comments (task_id, user_id, content, mentions) VALUES (?, ?, ?, ?)')
    .run(id, req.user.id, content, JSON.stringify(Array.isArray(mentions) ? mentions : []));
  const t = db.prepare('SELECT * FROM tasks WHERE id = ?').get(id);
  logHistory(id, req.user.id, 'comment.add', 'comment', '', content.slice(0, 100));
  const assignees = db.prepare('SELECT user_id FROM task_assignees WHERE task_id = ?').all(id);
  const seen = new Set();
  for (const a of [...assignees, ...(Array.isArray(mentions) ? mentions.map((m) => ({ user_id: m })) : [])]) {
    if (a.user_id === req.user.id || seen.has(a.user_id)) continue;
    seen.add(a.user_id);
    notify(a.user_id, 'comment', 'New comment on task', `${req.user.name}: ${content.slice(0, 80)}`, `/tasks/${id}`);
  }
  audit(req, 'task.comment', 'task', id, `Commented on "${t.title}"`);
  const row = db.prepare('SELECT tc.*, u.name AS user_name, u.avatar FROM task_comments tc JOIN users u ON u.id = tc.user_id WHERE tc.id = ?').get(Number(r.lastInsertRowid));
  res.json({ ...row, mentions: mentions || [] });
});

router.post('/:id/checklist', loadTask, (req, res) => {
  const { title } = req.body || {};
  if (!title) return res.status(400).json({ error: 'title required' });
  const r = db.prepare('INSERT INTO task_checklist (task_id, title, created_by) VALUES (?, ?, ?)')
    .run(req.params.id, title, req.user.id);
  res.json(db.prepare('SELECT * FROM task_checklist WHERE id = ?').get(Number(r.lastInsertRowid)));
});

router.put('/:id/checklist/:cid', loadTask, (req, res) => {
  const c = db.prepare('SELECT * FROM task_checklist WHERE id = ?').get(req.params.cid);
  if (!c) return res.status(404).json({ error: 'Checklist item not found' });
  const { done, title } = req.body || {};
  db.prepare('UPDATE task_checklist SET done = ?, title = COALESCE(?, title) WHERE id = ?')
    .run(done !== undefined ? (done ? 1 : 0) : c.done, title ?? null, c.id);
  const total = db.prepare('SELECT COUNT(*) c FROM task_checklist WHERE task_id = ?').get(c.task_id).c;
  const d = db.prepare('SELECT COALESCE(SUM(done),0) c FROM task_checklist WHERE task_id = ?').get(c.task_id).c;
  const pct = total ? Math.round((d / total) * 100) : 0;
  db.prepare('UPDATE tasks SET progress = ?, updated_at = datetime(\'now\',\'+6 hours\') WHERE id = ? AND status NOT IN (\'done\',\'cancelled\')').run(pct, c.task_id);
  res.json(db.prepare('SELECT * FROM task_checklist WHERE id = ?').get(c.id));
});

router.delete('/:id/checklist/:cid', loadTask, (req, res) => {
  db.prepare('DELETE FROM task_checklist WHERE id = ?').run(req.params.cid);
  res.json({ ok: true });
});

router.post('/:id/dependencies', loadTask, (req, res) => {
  const { depends_on } = req.body || {};
  if (!depends_on) return res.status(400).json({ error: 'depends_on required' });
  db.prepare('INSERT OR IGNORE INTO task_dependencies (task_id, depends_on) VALUES (?, ?)').run(req.params.id, depends_on);
  res.json({ ok: true });
});

router.delete('/:id/dependencies/:dep', loadTask, (req, res) => {
  db.prepare('DELETE FROM task_dependencies WHERE task_id = ? AND depends_on = ?').run(req.params.id, req.params.dep);
  res.json({ ok: true });
});

router.post('/:id/approvals', loadTask, (req, res) => {
  const { approver_id, comment } = req.body || {};
  if (!approver_id) return res.status(400).json({ error: 'approver_id required' });
  const r = db.prepare('INSERT INTO approvals (task_id, requester_id, approver_id, comment) VALUES (?, ?, ?, ?)')
    .run(req.params.id, req.user.id, approver_id, comment || '');
  db.prepare('UPDATE tasks SET approval_status = \'pending\' WHERE id = ?').run(req.params.id);
  notify(approver_id, 'approval', 'Approval requested', `Your approval is requested for a task`, `/tasks/${req.params.id}`);
  res.json({ ok: true, id: Number(r.lastInsertRowid) });
});

router.post('/:id/approvals/:aid', loadTask, (req, res) => {
  const a = db.prepare('SELECT * FROM approvals WHERE id = ?').get(req.params.aid);
  if (!a) return res.status(404).json({ error: 'Approval not found' });
  if (a.task_id !== Number(req.params.id)) return res.status(400).json({ error: 'Approval does not belong to this task' });
  const { status, comment } = req.body || {};
  db.prepare('UPDATE approvals SET status = ?, comment = COALESCE(?, comment), updated_at = datetime(\'now\',\'+6 hours\') WHERE id = ?')
    .run(status || 'approved', comment ?? null, a.id);
  const pending = db.prepare('SELECT COUNT(*) c FROM approvals WHERE task_id = ? AND status = \'pending\'').get(a.task_id).c;
  db.prepare('UPDATE tasks SET approval_status = ?, updated_at = datetime(\'now\',\'+6 hours\') WHERE id = ?')
    .run(pending ? 'pending' : (status || 'approved'), a.task_id);
  notify(a.requester_id, 'approval', 'Approval updated', `Your approval request was ${status}`, `/tasks/${a.task_id}`);
  res.json({ ok: true });
});

router.post('/:id/time', loadTask, (req, res) => {
  const { hours, note, date } = req.body || {};
  if (hours === undefined || hours === null || isNaN(Number(hours))) return res.status(400).json({ error: 'hours required' });
  const r = db.prepare('INSERT INTO time_entries (task_id, user_id, hours, note, date) VALUES (?, ?, ?, ?, ?)')
    .run(req.params.id, req.user.id, Number(hours), note || '', date || today());
  res.json(db.prepare('SELECT * FROM time_entries WHERE id = ?').get(Number(r.lastInsertRowid)));
});

export default router;
