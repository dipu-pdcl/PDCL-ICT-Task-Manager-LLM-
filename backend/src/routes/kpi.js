import { Router } from 'express';
import { db } from '../db.js';
import { requireAuth, requirePermission } from '../middleware.js';
import { dateRangeFromKey, bdNow } from '../utils.js';
import { getSettings, getDifficultyById, getPriorityById } from '../config.js';

const router = Router();
router.use(requireAuth);

export function computeUserKpi(userId, startIso, endIso, cfg) {
  const k = cfg.kpi;
  if (k.enabled === false) {
    return {
      userId,
      completed: 0, selfCompleted: 0, totalAssigned: 0, totalDone: 0, completionRate: 0,
      onTime: 0, late: 0, overdueCount: 0, avgCompletionHours: 0,
      points: 0, bonus: 0, penalty: 0, productivity: 0, rating: 0, score: 0,
      disabled: true,
    };
  }
  const started = `${startIso.slice(0, 10)} 00:00:00`;
  const ended = `${endIso.slice(0, 10)} 23:59:59`;

  const completed = db.prepare(`
    SELECT t.*, ta.progress FROM task_assignees ta
    JOIN tasks t ON t.id = ta.task_id
    WHERE ta.user_id = ? AND t.status = 'done' AND t.completed_at >= ? AND t.completed_at <= ?
  `).all(userId, started, ended);

  const points = completed.reduce((sum, t) => {
    if (t.is_self_task) {
      const start = new Date(t.created_at.replace(' ', 'T') + 'Z');
      const end = new Date((t.completed_at || t.updated_at || '').replace(' ', 'T') + 'Z');
      const hours = Math.max(0, (end - start) / 3600000);
      return sum + (hours <= 1 ? 1 : Math.round(k.completedTaskPoints / 5) || 1);
    }
    const diffPts = getDifficultyById(t.difficulty).points;
    const prioW = getPriorityById(t.priority).weight;
    const basePts = (k.completedTaskPoints || 10);
    return sum + Math.round(diffPts * prioW * (basePts / 10));
  }, 0);

  const onTime = completed.filter((t) => !t.due_date || t.completed_at <= `${t.due_date} 23:59:59`).length;
  const late = completed.filter((t) => t.due_date && t.completed_at > `${t.due_date} 23:59:59`).length;

  const currentOverdue = db.prepare(`
    SELECT COUNT(*) c FROM task_assignees ta JOIN tasks t ON t.id = ta.task_id
    WHERE ta.user_id = ? AND t.due_date IS NOT NULL AND t.due_date < ? AND t.status NOT IN ('done','cancelled')
  `).get(userId, startIso.slice(0, 10)).c;

  const totalAssigned = db.prepare(`
    SELECT COUNT(*) c FROM task_assignees ta JOIN tasks t ON t.id = ta.task_id WHERE ta.user_id = ?
  `).get(userId).c;
  const totalDone = db.prepare(`
    SELECT COUNT(*) c FROM task_assignees ta JOIN tasks t ON t.id = ta.task_id
    WHERE ta.user_id = ? AND t.status = 'done'`).get(userId).c;
  const completionRate = totalAssigned ? Math.round((totalDone / totalAssigned) * 100) : 0;

  const avgHours = db.prepare(`
    SELECT ROUND(MAX(0, AVG(
      (julianday(t.completed_at) - julianday(t.created_at)) * 24
    )), 1) v
    FROM task_assignees ta JOIN tasks t ON t.id = ta.task_id
    WHERE ta.user_id = ? AND t.status = 'done' AND t.completed_at >= ? AND t.completed_at <= ?
  `).get(userId, started, ended).v || 0;

  const overdueCount = late + currentOverdue;
  const bonus = onTime * (k.onTimeBonus || 5);
  const penalty = overdueCount * (k.overduePenalty || 8);
  const productivity = Math.round((completionRate / 100) * 20);
  const reviewScore = 0;
  const rating = Math.round((k.reviewScoreWeight || 0.5) * reviewScore + (k.productivityWeight || 0.5) * productivity);

  const score = Math.round(points + bonus - penalty + rating);

  return {
    userId,
    completed: completed.length,
    selfCompleted: completed.filter((t) => t.is_self_task).length,
    totalAssigned,
    totalDone,
    completionRate,
    onTime,
    late,
    overdueCount,
    avgCompletionHours: avgHours,
    points,
    bonus,
    penalty,
    productivity,
    rating,
    score,
  };
}

function buildKpiForUsers(start, end) {
  const cfg = getSettings();
  const users = db.prepare(`
    SELECT u.id, u.name, u.role, u.avatar, t.name AS team_name, d.name AS department_name
    FROM users u LEFT JOIN teams t ON t.id = u.team_id LEFT JOIN departments d ON d.id = u.department_id
    WHERE u.is_active = 1 ORDER BY u.name`).all();
  return users.map((u) => ({ ...computeUserKpi(u.id, start, end, cfg), ...u }));
}

function rangeFromQuery(q) {
  const r = dateRangeFromKey(q.dateKey || 'month', q.dateKey === 'custom' ? { from: q.from, to: q.to } : null);
  return r;
}

router.get('/me', (req, res) => {
  const cfg = getSettings();
  const r = rangeFromQuery(req.query);
  const profile = db.prepare(`
    SELECT u.id, u.name, u.role, u.avatar, t.name AS team_name, d.name AS department_name
    FROM users u LEFT JOIN teams t ON t.id = u.team_id LEFT JOIN departments d ON d.id = u.department_id
    WHERE u.id = ?`).get(req.user.id);
  res.json({ ...computeUserKpi(req.user.id, r.start, r.end, cfg), ...profile });
});

router.get('/overview', requirePermission('kpi.view', 'kpi.manage'), (req, res) => {
  const r = rangeFromQuery(req.query);
  const list = buildKpiForUsers(r.start, r.end);
  const active = list.filter((u) => u.totalAssigned > 0 || u.completed > 0);
  const sorted = [...active].sort((a, b) => b.score - a.score);
  const top = sorted.slice(0, 10);
  const lowest = [...sorted].reverse().slice(0, 10);

  const teamRank = {};
  for (const u of list) {
    const key = u.team_name || 'Unassigned';
    teamRank[key] = teamRank[key] || { name: key, score: 0, completed: 0, count: 0 };
    teamRank[key].score += u.score;
    teamRank[key].completed += u.completed;
    teamRank[key].count += 1;
  }
  const deptRank = {};
  for (const u of list) {
    const key = u.department_name || 'Unassigned';
    deptRank[key] = deptRank[key] || { name: key, score: 0, completed: 0, count: 0 };
    deptRank[key].score += u.score;
    deptRank[key].completed += u.completed;
    deptRank[key].count += 1;
  }

  const months = [];
  const nowBd = bdNow();
  const curY = nowBd.getUTCFullYear();
  const curM = nowBd.getUTCMonth();
  for (let i = 11; i >= 0; i--) {
    let y = curY, m = curM - i;
    while (m < 0) { m += 12; y -= 1; }
    const label = new Date(Date.UTC(y, m, 1)).toLocaleString('en', { month: 'short', timeZone: 'UTC' });
    const s = `${y}-${String(m + 1).padStart(2, '0')}-01`;
    const e = `${y}-${String(m + 1).padStart(2, '0')}-${String(new Date(Date.UTC(y, m + 1, 0)).getUTCDate()).padStart(2, '0')}`;
    const listMonth = buildKpiForUsers(s, e);
    const avg = listMonth.length ? Math.round(listMonth.reduce((a, b) => a + b.score, 0) / listMonth.length) : 0;
    months.push({ month: label, avgScore: avg, totalCompleted: listMonth.reduce((a, b) => a + b.completed, 0) });
  }

  const years = [];
  for (let i = 3; i >= 0; i--) {
    const y = curY - i;
    const s = `${y}-01-01`;
    const e = `${y}-12-31`;
    const listYear = buildKpiForUsers(s, e);
    years.push({
      year: String(y),
      avgScore: listYear.length ? Math.round(listYear.reduce((a, b) => a + b.score, 0) / listYear.length) : 0,
      totalCompleted: listYear.reduce((a, b) => a + b.completed, 0),
    });
  }

  res.json({ top, lowest, teamRank: Object.values(teamRank).sort((a, b) => b.score - a.score), deptRank: Object.values(deptRank).sort((a, b) => b.score - a.score), monthly: months, yearly: years, period: { start: r.start, end: r.end } });
});

router.get('/users', requirePermission('kpi.view', 'kpi.manage'), (req, res) => {
  const r = rangeFromQuery(req.query);
  res.json(buildKpiForUsers(r.start, r.end));
});

export default router;
