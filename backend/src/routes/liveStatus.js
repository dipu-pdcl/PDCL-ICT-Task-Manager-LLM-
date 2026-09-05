import { Router } from 'express';
import { db } from '../db.js';
import { requireAuth, requireAdmin, getPublicUser, audit } from '../middleware.js';
import { initials } from '../utils.js';

const router = Router();
router.use(requireAuth);

// Auto-expire stale statuses (if no heartbeat/active ping for > 30s)
function autoExpireStaleSessions() {
  try {
    db.prepare(`
      UPDATE users
      SET live_status = 'inactive',
          status_updated_at = datetime('now','+6 hours')
      WHERE is_active = 1
        AND live_status IN ('active', 'away')
        AND (
          last_active_at IS NULL
          OR (strftime('%s', datetime('now', '+6 hours')) - strftime('%s', last_active_at)) > 30
        )
    `).run();
  } catch (err) {
    console.error('Error expiring stale live statuses:', err);
  }
}

// Run periodic cleanup every 5s
setInterval(autoExpireStaleSessions, 5000).unref();

function formatLiveUserRow(u) {
  return {
    id: u.id,
    name: u.name,
    email: u.email,
    role: u.role,
    title: u.title || '',
    avatar: u.avatar || '',
    initials: initials(u.name),
    employee_id: u.employee_id || ('EMP' + String(u.id).padStart(3, '0')),
    department_id: u.department_id,
    department_name: u.department_name || 'General / Unassigned',
    team_id: u.team_id,
    team_name: u.team_name || '',
    live_status: u.live_status || 'inactive',
    last_active_at: u.last_active_at || null,
    last_login: u.last_login || null,
    status_message: u.status_message || '',
    status_updated_at: u.status_updated_at || null,
    is_active: !!u.is_active,
  };
}

// GET /api/live-status/overview - Live status dashboard & user list
router.get('/overview', (req, res) => {
  // 1. First run auto-expiration
  autoExpireStaleSessions();

  const { department_id, status, q } = req.query;

  // 2. Fetch overall metrics summary
  const summaryRow = db.prepare(`
    SELECT
      COUNT(*) AS total,
      SUM(CASE WHEN live_status = 'active' THEN 1 ELSE 0 END) AS active,
      SUM(CASE WHEN live_status = 'away' THEN 1 ELSE 0 END) AS away,
      SUM(CASE WHEN live_status = 'inactive' OR live_status IS NULL THEN 1 ELSE 0 END) AS inactive
    FROM users
    WHERE is_active = 1
  `).get();

  const summary = {
    total: Number(summaryRow?.total || 0),
    active: Number(summaryRow?.active || 0),
    away: Number(summaryRow?.away || 0),
    inactive: Number(summaryRow?.inactive || 0),
  };

  // 3. Build query for users list
  let sql = `
    SELECT u.*, d.name AS department_name, t.name AS team_name
    FROM users u
    LEFT JOIN departments d ON d.id = u.department_id
    LEFT JOIN teams t ON t.id = u.team_id
    WHERE u.is_active = 1
  `;
  const params = [];

  if (department_id && department_id !== 'all') {
    sql += ` AND u.department_id = ?`;
    params.push(department_id);
  }

  if (status && status !== 'all') {
    if (status === 'inactive') {
      sql += ` AND (u.live_status = 'inactive' OR u.live_status IS NULL)`;
    } else {
      sql += ` AND u.live_status = ?`;
      params.push(status);
    }
  }

  if (q && String(q).trim()) {
    const term = `%${String(q).trim()}%`;
    sql += ` AND (u.name LIKE ? OR u.email LIKE ? OR u.employee_id LIKE ? OR u.title LIKE ? OR d.name LIKE ?)`;
    params.push(term, term, term, term, term);
  }

  // Priority sorting: active (1), away (2), inactive (3), then last_active_at desc
  sql += `
    ORDER BY
      CASE
        WHEN u.live_status = 'active' THEN 1
        WHEN u.live_status = 'away' THEN 2
        ELSE 3
      END ASC,
      u.last_active_at DESC,
      u.name ASC
  `;

  const rows = db.prepare(sql).all(...params);
  const users = rows.map(formatLiveUserRow);

  // Current user's fresh record
  const currentFresh = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);

  res.json({
    summary,
    users,
    my_status: currentFresh ? formatLiveUserRow(currentFresh) : null,
    server_time: new Date().toISOString(),
  });
});

// POST /api/live-status/status - Update current user's live status (active / away / inactive)
router.post('/status', (req, res) => {
  const { status, status_message } = req.body || {};
  const valid = ['active', 'away', 'inactive'];
  if (!valid.includes(status)) {
    return res.status(400).json({ error: 'Status must be active, away, or inactive' });
  }

  const msg = typeof status_message === 'string' ? status_message.trim().slice(0, 200) : '';

  db.prepare(`
    UPDATE users
    SET live_status = ?,
        status_message = ?,
        last_active_at = datetime('now','+6 hours'),
        status_updated_at = datetime('now','+6 hours')
    WHERE id = ?
  `).run(status, msg, req.user.id);

  const updated = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  audit(req, 'live_status.update', 'user', req.user.id, `Changed live status to ${status}${msg ? `: "${msg}"` : ''}`);

  res.json({
    ok: true,
    user: getPublicUser(updated),
    status,
    last_active_at: updated.last_active_at,
  });
});

// POST /api/live-status/heartbeat - Periodic ping from frontend
router.post('/heartbeat', (req, res) => {
  const current = db.prepare('SELECT live_status FROM users WHERE id = ?').get(req.user.id);
  let nextStatus = current?.live_status || 'active';

  // If user was marked inactive due to timeout, restore to active upon new heartbeat
  if (nextStatus === 'inactive') {
    nextStatus = 'active';
  }

  db.prepare(`
    UPDATE users
    SET last_active_at = datetime('now','+6 hours'),
        live_status = ?
    WHERE id = ?
  `).run(nextStatus, req.user.id);

  res.json({
    ok: true,
    live_status: nextStatus,
    server_time: new Date().toISOString(),
  });
});

// PUT /api/live-status/admin/set-user-status/:id - Admin sets a user's status
router.put('/admin/set-user-status/:id', requireAdmin, (req, res) => {
  const { status, status_message } = req.body || {};
  const valid = ['active', 'away', 'inactive'];
  if (!valid.includes(status)) {
    return res.status(400).json({ error: 'Status must be active, away, or inactive' });
  }

  const targetId = Number(req.params.id);
  const targetUser = db.prepare('SELECT * FROM users WHERE id = ?').get(targetId);
  if (!targetUser) return res.status(404).json({ error: 'User not found' });

  const msg = typeof status_message === 'string' ? status_message.trim().slice(0, 200) : (targetUser.status_message || '');

  db.prepare(`
    UPDATE users
    SET live_status = ?,
        status_message = ?,
        last_active_at = datetime('now','+6 hours'),
        status_updated_at = datetime('now','+6 hours')
    WHERE id = ?
  `).run(status, msg, targetId);

  audit(req, 'live_status.admin_override', 'user', targetId, `Admin set live status of ${targetUser.name} to ${status}`);

  const updated = db.prepare('SELECT * FROM users WHERE id = ?').get(targetId);
  res.json({ ok: true, user: formatLiveUserRow(updated) });
});

export default router;
