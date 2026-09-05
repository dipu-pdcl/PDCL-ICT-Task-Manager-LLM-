import { Router } from 'express';
import { db } from '../db.js';
import { requireAuth, requirePermission } from '../middleware.js';
import { dateRangeFromKey } from '../utils.js';

const router = Router();
router.use(requireAuth, requirePermission('audit.view'));

router.get('/', (req, res) => {
  const q = req.query;
  const where = [];
  const params = [];
  if (q.search) { where.push('(a.action LIKE ? OR a.details LIKE ? OR a.user_name LIKE ?)'); const l = `%${q.search}%`; params.push(l, l, l); }
  if (q.user_id) { where.push('a.user_id = ?'); params.push(q.user_id); }
  if (q.action) { where.push('a.action LIKE ?'); params.push(`%${q.action}%`); }
  if (q.dateKey) {
    const range = dateRangeFromKey(q.dateKey);
    where.push('a.created_at >= ? AND a.created_at <= ?');
    params.push(range.start, range.end);
  }
  const rows = db.prepare(`
    SELECT a.*, u.name AS user_name FROM audit_logs a
    LEFT JOIN users u ON u.id = a.user_id
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY a.created_at DESC LIMIT 1000`).all(...params);
  res.json(rows);
});

router.get('/actions', (req, res) => {
  const rows = db.prepare('SELECT DISTINCT action FROM audit_logs ORDER BY action').all();
  res.json(rows.map((r) => r.action));
});

export default router;
