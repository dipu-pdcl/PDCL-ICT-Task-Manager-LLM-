import { Router } from 'express';
import ExcelJS from 'exceljs';
import PDFDocument from 'pdfkit';
import { db } from '../db.js';
import { requireAuth, requireAdmin, isAdmin } from '../middleware.js';
import { dateRangeFromKey, bdNow, parseWeekendDays, WEEKDAY_SHORT } from '../utils.js';
import { getSettings } from '../config.js';
import { computeUserKpi } from './kpi.js';

const router = Router();
router.use(requireAuth);

function taskRowsForReport(user, q) {
  const admin = isAdmin(user);
  const where = [];
  const params = [];
  if (!admin) where.push('(t.created_by = ? OR t.id IN (SELECT task_id FROM task_assignees WHERE user_id = ?))'), params.push(user.id, user.id);
  if (q.status) { const l = Array.isArray(q.status) ? q.status : [q.status]; if (l.length && !l.includes('all')) where.push(`t.status IN (${l.map(() => '?').join(',')})`), params.push(...l); }
  if (q.priority) { const l = Array.isArray(q.priority) ? q.priority : [q.priority]; if (l.length && !l.includes('all')) where.push(`t.priority IN (${l.map(() => '?').join(',')})`), params.push(...l); }
  if (q.team_id) { const l = Array.isArray(q.team_id) ? q.team_id : [q.team_id]; if (l.length && !l.includes('all')) where.push(`t.team_id IN (${l.map(() => '?').join(',')})`), params.push(...l); }
  if (q.department_id) { const l = Array.isArray(q.department_id) ? q.department_id : [q.department_id]; if (l.length && !l.includes('all')) where.push(`t.department_id IN (${l.map(() => '?').join(',')})`), params.push(...l); }
  if (q.dateKey) { const r = dateRangeFromKey(q.dateKey, q.dateKey === 'custom' ? { from: q.date_from, to: q.date_to } : null); where.push('t.created_at >= ? AND t.created_at <= ?'); params.push(r.start, r.end); }
  const rows = db.prepare(`
    SELECT t.id, t.title, t.status, t.priority, t.difficulty, t.task_type, t.budget, t.estimated_hours,
      t.due_date, t.progress, t.created_at, t.updated_at, t.completed_at,
      c.name AS created_by_name, r.name AS reviewer_name, te.name AS team_name, d.name AS department_name
    FROM tasks t
    LEFT JOIN users c ON c.id = t.created_by
    LEFT JOIN users r ON r.id = t.reviewer_id
    LEFT JOIN teams te ON te.id = t.team_id
    LEFT JOIN departments d ON d.id = t.department_id
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY t.created_at DESC
  `).all(...params);
  return rows;
}

router.get('/tasks', (req, res) => {
  res.json(taskRowsForReport(req.user, req.query));
});

function computeAnalytics(user, dateKey) {
  const admin = isAdmin(user);
  const uid = user.id;
  const scope = admin ? '1=1' : `(created_by = ${uid} OR id IN (SELECT task_id FROM task_assignees WHERE user_id = ${uid}))`;
  const r = dateRangeFromKey(dateKey || '30d');

  const status = db.prepare(`
    SELECT status, COUNT(*) c, AVG(progress) avg_progress FROM tasks WHERE ${scope}
    GROUP BY status`).all();
  const priority = db.prepare(`SELECT priority, COUNT(*) c FROM tasks WHERE ${scope} GROUP BY priority`).all();
  const type = db.prepare(`SELECT task_type, COUNT(*) c FROM tasks WHERE ${scope} GROUP BY task_type`).all();

  const monthly = [];
  const nowBd = bdNow();
  const curY = nowBd.getUTCFullYear();
  const curM = nowBd.getUTCMonth();
  for (let i = 11; i >= 0; i--) {
    let y = curY, m = curM - i;
    while (m < 0) { m += 12; y -= 1; }
    const key = `${y}-${String(m + 1).padStart(2, '0')}`;
    monthly.push({
      month: new Date(Date.UTC(y, m, 1)).toLocaleString('en', { month: 'short', timeZone: 'UTC' }),
      added: db.prepare(`SELECT COUNT(*) c FROM tasks WHERE ${scope} AND strftime('%Y-%m', created_at) = ?`).get(key).c,
      done: db.prepare(`SELECT COUNT(*) c FROM tasks WHERE ${scope} AND strftime('%Y-%m', completed_at) = ?`).get(key).c,
    });
  }

  const workload = db.prepare(`
    SELECT u.id, u.name, COUNT(ta.task_id) AS open_count
    FROM users u LEFT JOIN task_assignees ta ON ta.user_id = u.id
    LEFT JOIN tasks t ON t.id = ta.task_id AND t.status NOT IN ('done','cancelled')
    GROUP BY u.id ORDER BY open_count DESC LIMIT 15
  `).all();

  return { status, priority, type, monthly, workload };
}

router.get('/analytics', (req, res) => {
  res.json(computeAnalytics(req.user, req.query.dateKey));
});

router.get('/activity', (req, res) => {
  const admin = isAdmin(req.user);
  const r = dateRangeFromKey(req.query.dateKey || '30d');
  let sql = `
    SELECT a.*, u.name AS user_name FROM audit_logs a
    LEFT JOIN users u ON u.id = a.user_id
    WHERE a.created_at >= ? AND a.created_at <= ?
  `;
  const params = [r.start, r.end];
  if (!admin) {
    sql += ' AND a.user_id = ?';
    params.push(req.user.id);
  }
  sql += ' ORDER BY a.created_at DESC LIMIT 1000';
  res.json(db.prepare(sql).all(...params));
});

router.get('/kpi', (req, res) => {
  const admin = isAdmin(req.user);
  const cfg = getSettings();
  const r = dateRangeFromKey(req.query.dateKey || 'month');
  const where = admin ? '1=1' : 'u.id = ?';
  const params = admin ? [] : [req.user.id];
  const list = db.prepare(`
    SELECT u.id, u.name, u.role, u.avatar, t.name AS team_name, d.name AS department_name
    FROM users u LEFT JOIN teams t ON t.id = u.team_id LEFT JOIN departments d ON d.id = u.department_id
    WHERE ${where} AND u.is_active=1 ORDER BY u.name`).all(...params)
    .map((u) => ({ ...computeUserKpi(u.id, r.start, r.end, cfg), ...u }));
  res.json(list);
});

function toLocal(dt, offsetMin) {
  if (dt === null || dt === undefined || dt === '') return '';
  const s = String(dt);
  if (s.length <= 10) return s;
  const hasTz = /[zZ]|[+-]\d{2}:?\d{2}$/.test(s);
  if (!hasTz) return s.replace('T', ' ').slice(0, 19);
  const d = new Date(s);
  if (isNaN(d.getTime())) return s;
  const bd = new Date(d.getTime() + 6 * 60 * 60 * 1000);
  const p = (n) => String(n).padStart(2, '0');
  const hasSec = /:\d{2}:\d{2}/.test(s);
  return `${bd.getUTCFullYear()}-${p(bd.getUTCMonth() + 1)}-${p(bd.getUTCDate())} ${p(bd.getUTCHours())}:${p(bd.getUTCMinutes())}${hasSec ? ':' + p(bd.getUTCSeconds()) : ''}`;
}

const CHART_COLORS = ['#6366f1', '#22c55e', '#f97316', '#3b82f6', '#a855f7', '#eab308', '#ef4444', '#14b8a6', '#ec4899', '#64748b'];

function ensureSpace(doc, h) {
  if (doc.y + h > doc.page.height - 60) doc.addPage();
}

function pdfCenterText(doc, text, cx, y, size, color) {
  doc.font('Helvetica-Bold').fontSize(size);
  if (color) doc.fillColor(color);
  const w = doc.widthOfString(text);
  doc.text(text, cx - w / 2, y, { width: Math.max(w + 4, 1) });
}

function pdfTruncate(doc, text, maxW) {
  let s = String(text ?? '');
  if (doc.widthOfString(s) <= maxW) return s;
  let lo = 0, hi = s.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (doc.widthOfString(s.slice(0, mid) + '\u2026') <= maxW) lo = mid;
    else hi = mid - 1;
  }
  return s.slice(0, lo) + '\u2026';
}

function drawDonut(doc, items, cx, cy, r, inner, centerTotal) {
  const total = items.reduce((s, i) => s + (i.value || 0), 0) || 1;
  let angle = -Math.PI / 2;
  for (const it of items) {
    const v = it.value || 0;
    if (v <= 0) continue;
    const sweep = (v / total) * Math.PI * 2;
    doc.fillColor(it.color)
      .moveTo(cx, cy)
      .arc(cx, cy, r, angle, angle + sweep)
      .lineTo(cx, cy)
      .fill();
    angle += sweep;
  }
  doc.fillColor('#ffffff').circle(cx, cy, inner).fill();
  pdfCenterText(doc, String(centerTotal ?? ''), cx, cy - 5, 17, '#1e293b');
  pdfCenterText(doc, 'tasks', cx, cy + 7, 7, '#94a3b8');
}

function drawDonutCard(doc, title, items, x, w, top) {
  doc.font('Helvetica-Bold').fontSize(11).fillColor('#1e293b').text(title, x, top, { width: w });
  const size = 104;
  const cx = x + w / 2;
  const cy = top + 16 + size / 2;
  const total = items.reduce((s, i) => s + (i.value || 0), 0);
  drawDonut(doc, items, cx, cy, size / 2 - 8, size / 2 - 20, total);
  let yy = cy + size / 2 + 8;
  for (const it of items) {
    doc.rect(cx - 34, yy, 8, 8).fill(it.color);
    doc.font('Helvetica').fontSize(8).fillColor('#334155');
    const label = `${it.name}  ${it.value ?? 0}`;
    doc.text(pdfTruncate(doc, label, 76), cx - 22, yy - 1, { lineBreak: false });
    yy += 13;
  }
  return yy + 4;
}

function drawAreaChart(doc, title, monthly, series, x, y, w, h) {
  doc.font('Helvetica-Bold').fontSize(11).fillColor('#1e293b').text(title, x, y);
  const legendNames = series.map((s) => s.name);
  let lx = x + w;
  series.slice().reverse().forEach((s) => {
    const nm = s.name;
    const tw = doc.widthOfString(nm, { font: 'Helvetica', size: 7 });
    doc.rect(lx - tw - 24, y + 3, 8, 8).fill(s.color);
    doc.font('Helvetica').fontSize(7).fillColor('#475569').text(nm, lx - tw - 14, y + 1, { width: tw + 2 });
    lx -= tw + 26;
  });
  const chartY = y + 22;
  const padL = 28, padB = 20, padT = 6, padR = 8;
  const pw = w - padL - padR, ph = h - padT - padB;
  const base = chartY + padT + ph;
  const max = Math.max(1, ...monthly.flatMap((m) => series.map((s) => m[s.key] || 0)));
  doc.font('Helvetica').fontSize(7);
  for (let i = 0; i <= 4; i++) {
    const gy = base - (ph / 4) * i;
    doc.strokeColor('#e2e8f0').lineWidth(0.6).moveTo(x + padL, gy).lineTo(x + padL + pw, gy).stroke();
    const lab = String(Math.round((max / 4) * i));
    doc.fillColor('#94a3b8').text(lab, x + padL - 4 - doc.widthOfString(lab), gy - 3);
  }
  const step = pw / Math.max(monthly.length - 1, 1);
  series.forEach((s) => {
    const pts = monthly.map((m, i) => [x + padL + i * step, base - ((m[s.key] || 0) / max) * ph]);
    const poly = pts.map((p) => `${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(' L ');
    doc.path(`M ${poly} L ${pts[pts.length - 1][0].toFixed(1)} ${base} L ${pts[0][0].toFixed(1)} ${base} Z`);
    doc.fillColor(s.color).fillOpacity(0.15).fill().fillOpacity(1);
    doc.moveTo(pts[0][0], pts[0][1]);
    pts.slice(1).forEach((p) => doc.lineTo(p[0], p[1]));
    doc.strokeColor(s.color).lineWidth(1.6).stroke();
    pts.forEach((p) => { doc.fillColor(s.color).circle(p[0], p[1], 1.5).fill(); });
  });
  doc.font('Helvetica').fontSize(6.5).fillColor('#64748b');
  monthly.forEach((m, i) => {
    const lx = x + padL + i * step;
    const tw = doc.widthOfString(m.month);
    doc.text(m.month, lx - tw / 2, base + 5, { width: tw + 2 });
  });
  doc.y = base + 22;
}

function drawHBarChart(doc, title, items, x, y, w, h) {
  doc.font('Helvetica-Bold').fontSize(11).fillColor('#1e293b').text(title, x, y);
  const chartY = y + 18;
  const labelW = 130, barH = 11, gap = 5;
  const maxV = Math.max(1, ...items.map((i) => i.value || 0));
  const maxRows = Math.floor((h - 18) / (barH + gap));
  const rows = items.slice(0, Math.max(maxRows, 1));
  const maxW = w - labelW - 40;
  rows.forEach((it, i) => {
    const ry = chartY + i * (barH + gap);
    doc.font('Helvetica').fontSize(8).fillColor('#475569');
    doc.text(pdfTruncate(doc, String(it.name || ''), labelW - 10), x, ry, { lineBreak: false });
    const bw = Math.max((it.value / maxV) * maxW, 2);
    doc.rect(x + labelW, ry + 1, bw, barH - 2).fill('#6366f1');
    doc.font('Helvetica-Bold').fontSize(8).fillColor('#1e293b')
      .text(String(it.value ?? ''), x + labelW + maxW + 6, ry, { width: 30 });
  });
  doc.y = chartY + rows.length * (barH + gap);
}

router.get('/export', (req, res) => {
  const { type = 'tasks', format = 'csv' } = req.query;
  if (!isAdmin(req.user) && format !== 'csv') {
    return res.status(403).json({ error: 'Users can only download reports in CSV format' });
  }
  const tzOffset = req.query.tzOffset;
  let base = [];
  if (type === 'tasks') {
    base = taskRowsForReport(req.user, req.query).map((t) => ({
      ID: t.id, Title: t.title, Status: t.status, Priority: t.priority, Difficulty: t.difficulty,
      Type: t.task_type, Budget: t.budget, 'Est. Hours': t.estimated_hours, 'Due Date': toLocal(t.due_date, tzOffset),
      Progress: `${t.progress}%`, 'Created By': t.created_by_name, Reviewer: t.reviewer_name,
      Team: t.team_name, Branch: t.department_name, Created: toLocal(t.created_at, tzOffset), Completed: toLocal(t.completed_at, tzOffset),
    }));
  } else if (type === 'kpi') {
    const cfg = getSettings();
    const r = dateRangeFromKey(req.query.dateKey || 'month', req.query.dateKey === 'custom' ? { from: req.query.from, to: req.query.to } : null);
    const isAdminUser = isAdmin(req.user);
    const where = isAdminUser ? '1=1' : 'u.id = ?';
    const params = isAdminUser ? [] : [req.user.id];
    base = db.prepare(`
      SELECT u.id, u.name, u.role, t.name AS team_name, d.name AS department_name
      FROM users u LEFT JOIN teams t ON t.id = u.team_id LEFT JOIN departments d ON d.id = u.department_id
      WHERE ${where} AND u.is_active=1 ORDER BY u.name`).all(...params)
      .map((u) => ({ ...computeUserKpi(u.id, r.start, r.end, cfg), ...u }))
      .map((k) => ({
        User: k.name, Role: k.role, Team: k.team_name || '', Branch: k.department_name || '',
        Completed: k.completed, 'On-Time': k.onTime, Late: k.late, Overdue: k.overdueCount,
        'Completion Rate': `${k.completionRate}%`, 'Avg Hours': k.avgCompletionHours,
        Points: k.points, Bonus: k.bonus, Penalty: k.penalty, Rating: k.rating, 'Final Score': k.score,
      }));
  } else if (type === 'activity') {
    const r = dateRangeFromKey(req.query.dateKey || '30d', req.query.dateKey === 'custom' ? { from: req.query.from, to: req.query.to } : null);
    const isAdminUser = isAdmin(req.user);
    let sql = `SELECT a.*, u.name AS user_name FROM audit_logs a LEFT JOIN users u ON u.id = a.user_id
      WHERE a.created_at >= ? AND a.created_at <= ?`;
    const params = [r.start, r.end];
    if (!isAdminUser) { sql += ' AND a.user_id = ?'; params.push(req.user.id); }
    sql += ' ORDER BY a.created_at DESC LIMIT 2000';
    base = db.prepare(sql).all(...params).map((a) => ({
      Timestamp: toLocal(a.created_at, tzOffset), User: a.user_name || 'System', Action: a.action,
      Entity: a.entity_type, 'Entity ID': a.entity_id ?? '', Details: a.details || '', IP: a.ip || '',
    }));
  } else if (type === 'leaves') {
    const isAdminUser = isAdmin(req.user);
    let sql = `
      SELECT la.*, u.name AS applicant_name, u.email AS applicant_email, u.weekend_days AS applicant_weekend_days,
             t.name AS team_name, d.name AS department_name, appr.name AS approver_name
      FROM leave_applications la
      JOIN users u ON u.id = la.user_id
      LEFT JOIN teams t ON t.id = u.team_id
      LEFT JOIN departments d ON d.id = u.department_id
      LEFT JOIN users appr ON appr.id = la.approved_by
      WHERE 1=1
    `;
    const params = [];
    if (!isAdminUser) {
      sql += ' AND la.user_id = ?';
      params.push(req.user.id);
    }
    sql += ' ORDER BY la.created_at DESC LIMIT 2000';
    base = db.prepare(sql).all(...params).map((la) => {
      const wk = parseWeekendDays(la.applicant_weekend_days);
      const wkNames = wk.map((d) => WEEKDAY_SHORT[d]).join(', ');
      return {
        ID: la.id,
        Employee: la.applicant_name,
        Email: la.applicant_email,
        Branch: la.department_name || '',
        Team: la.team_name || '',
        'Assigned Weekend': wkNames,
        'Leave Type': la.leave_type,
        'Duration Type': la.duration_type || 'full_day',
        'Start Date': la.start_date,
        'End Date': la.end_date,
        'Deductible Days': la.days_count,
        Year: la.year,
        Status: la.status,
        'Approver / Reviewer': la.approver_name || '',
        Reason: la.reason || '',
        'Created At': toLocal(la.created_at, tzOffset),
      };
    });
  }
  const filename = `${type}-${Date.now()}.${format}`;

  if (format === 'csv') {
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    const headers = Object.keys(base[0] || {});
    res.write('\uFEFF' + headers.join(',') + '\n');
    for (const row of base) {
      res.write(headers.map((h) => `"${String(row[h] ?? '').replace(/"/g, '""')}"`).join(',') + '\n');
    }
    return res.end();
  }

  if (format === 'xlsx') {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet(type);
    const headers = Object.keys(base[0] || {});
    ws.addRow(headers);
    ws.getRow(1).font = { bold: true };
    for (const row of base) ws.addRow(headers.map((h) => row[h] ?? ''));
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    return wb.xlsx.write(res).then(() => res.end()).catch((e) => {
      if (!res.headersSent) return res.status(500).json({ error: 'Export failed: ' + (e.message || e) });
      res.end();
    });
  }

  if (format === 'pdf') {
    const doc = new PDFDocument({ margin: 40, size: 'A4', layout: 'landscape' });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    doc.pipe(res);
    const contentW = doc.page.width - 80;
    doc.fontSize(18).font('Helvetica-Bold').fillColor('#1e293b').text('TaskFlow Export', { align: 'center' });
    doc.moveDown();
    doc.font('Helvetica').fontSize(11).fillColor('#475569').text(`Report: ${type} | Generated: ${toLocal(new Date().toISOString(), tzOffset)}`);
    doc.moveDown();

    if (type === 'tasks') {
      const analytics = computeAnalytics(req.user, req.query.dateKey || '30d');
      const cfg = getSettings();
      const statusItems = analytics.status.map((s) => ({
        name: (cfg.taskStatuses.find((st) => st.id === s.status) || {}).name || s.status,
        value: s.c,
        color: (cfg.taskStatuses.find((st) => st.id === s.status) || {}).color || '#94a3b8',
      }));
      const prioItems = analytics.priority.map((p) => ({
        name: (cfg.priorities.find((pp) => pp.id === p.priority) || {}).name || p.priority,
        value: p.c,
        color: (cfg.priorities.find((pp) => pp.id === p.priority) || {}).color || '#94a3b8',
      }));
      const typeItems = analytics.type.map((t, i) => ({ name: t.task_type, value: t.c, color: CHART_COLORS[i % CHART_COLORS.length] }));

      const cardW = (contentW - 40) / 3;
      const cardsTop = doc.y;
      ensureSpace(doc, 240);
      const y1 = drawDonutCard(doc, 'Status Distribution', statusItems, 40, cardW, cardsTop);
      const y2 = drawDonutCard(doc, 'Priority Distribution', prioItems, 40 + cardW + 20, cardW, cardsTop);
      const y3 = drawDonutCard(doc, 'Task Type Distribution', typeItems, 40 + 2 * (cardW + 20), cardW, cardsTop);
      doc.y = Math.max(y1, y2, y3) + 10;

      ensureSpace(doc, 210);
      drawAreaChart(doc, 'Monthly Productivity (Added vs Completed)', analytics.monthly,
        [{ key: 'added', name: 'Added', color: '#6366f1' }, { key: 'done', name: 'Completed', color: '#22c55e' }],
        40, doc.y, contentW, 190);
      doc.y += 12;

      ensureSpace(doc, 280);
      drawHBarChart(doc, 'Workload Management (Open Tasks per User)',
        analytics.workload.map((w) => ({ name: w.name, value: w.open_count })), 40, doc.y, contentW, 250);
      doc.y += 12;

      doc.addPage();
    } else if (type === 'kpi' && base.length) {
      const scores = base.map((k) => ({ name: k.User, value: k['Final Score'] }));
      ensureSpace(doc, 280);
      drawHBarChart(doc, 'KPI Final Scores', scores, 40, doc.y, contentW, Math.min(40 + scores.length * 16, 580));
      doc.y += 12;
      doc.addPage();
    }

    const headers = Object.keys(base[0] || {});
    const colW = contentW / Math.max(headers.length, 1);
    const rowH = 15;
    const tableRow = (cells, isHeader) => {
      if (doc.y + rowH > doc.page.height - 40) doc.addPage();
      const top = doc.y;
      if (isHeader) doc.rect(40, top, contentW, rowH).fill('#eef2ff');
      cells.forEach((v, i) => {
        doc.font(isHeader ? 'Helvetica-Bold' : 'Helvetica').fontSize(isHeader ? 7.5 : 7);
        doc.fillColor(isHeader ? '#1e293b' : '#334155');
        doc.text(pdfTruncate(doc, v ?? '', colW - 6), 40 + i * colW + 3, top + 4, { lineBreak: false });
      });
      doc.y = top + rowH;
    };
    tableRow(headers, true);
    base.slice(0, 400).forEach((row) => tableRow(headers.map((h) => row[h]), false));
    doc.end();
    return;
  }
  res.status(400).json({ error: 'Unsupported format' });
});

export default router;
