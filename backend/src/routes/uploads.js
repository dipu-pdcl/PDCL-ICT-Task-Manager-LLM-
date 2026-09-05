import { Router } from 'express';
import multer from 'multer';
import path from 'node:path';
import fs from 'node:fs';
import { db, UPLOAD_DIR } from '../db.js';
import { requireAuth, isAdmin, audit } from '../middleware.js';

const router = Router();

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => cb(null, `${Date.now()}-${Math.round(Math.random() * 1e9)}${path.extname(file.originalname)}`),
});
const ALLOWED_EXT = /\.(png|jpe?g|gif|webp|pdf|txt|csv|json|md|zip|xlsx?|docx?)$/i;
const ALLOWED_MIME = /^(image\/(png|jpe?g|gif|webp)|application\/pdf|text\/plain|text\/csv|text\/markdown|application\/json|application\/zip|application\/vnd\.openxmlformats-officedocument\.(wordprocessingml|spreadsheetml)\.document|application\/msword|application\/vnd\.ms-excel)$/i;
const upload = multer({
  storage,
  limits: { fileSize: 25 * 1024 * 1024 },
  fileFilter: (req, file, cb) => cb(null, ALLOWED_EXT.test(path.extname(file.originalname) || '') && ALLOWED_MIME.test(file.mimetype || '')),
});
const avatarUpload = multer({
  storage,
  limits: { fileSize: 50 * 1024 },
  fileFilter: (req, file, cb) => cb(null, /^image\/(png|jpe?g|gif|webp)$/i.test(file.mimetype || '')),
});

function removeFiles(files) {
  for (const f of files || []) {
    try { fs.unlinkSync(path.join(UPLOAD_DIR, f.filename)); } catch { /* noop */ }
  }
}

router.post('/task/:taskId', requireAuth, upload.array('files', 10), (req, res) => {
  const taskId = Number(req.params.taskId);
  const files = req.files || [];
  const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(taskId);
  if (!task) {
    removeFiles(files);
    return res.status(404).json({ error: 'Task not found' });
  }
  const assignees = db.prepare('SELECT user_id FROM task_assignees WHERE task_id = ?').all(taskId);
  if (!(isAdmin(req.user) || task.created_by === req.user.id || assignees.some((a) => a.user_id === req.user.id))) {
    removeFiles(files);
    return res.status(403).json({ error: 'No access to this task' });
  }
  const saved = [];
  const stmt = db.prepare(`
    INSERT INTO task_attachments (task_id, user_id, filename, stored_name, size, mime)
    VALUES (?, ?, ?, ?, ?, ?)`);
  try {
    for (const f of files) {
      const r = stmt.run(taskId, req.user.id, f.originalname, f.filename, f.size, f.mimetype || '');
      saved.push(db.prepare('SELECT * FROM task_attachments WHERE id = ?').get(Number(r.lastInsertRowid)));
    }
  } catch (e) {
    removeFiles(files);
    return res.status(400).json({ error: 'Failed to save attachment: ' + (e.message || e) });
  }
  audit(req, 'task.upload', 'task', taskId, `Uploaded ${files.length} attachment(s)`);
  res.json(saved);
});

router.post('/avatar', requireAuth, avatarUpload.single('avatar'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Only PNG, JPEG, GIF or WebP images up to 50KB are allowed' });
  const url = `/api/uploads/avatar/${req.file.filename}`;
  db.prepare('UPDATE users SET avatar = ? WHERE id = ?').run(url, req.user.id);
  audit(req, 'user.avatar', 'user', req.user.id, 'Updated profile picture');
  res.json({ url });
});

router.get('/file/:storedName', (req, res) => {
  const name = req.params.storedName;
  if (name.includes('..') || name.includes('/') || name.includes('\\')) return res.status(400).json({ error: 'Invalid name' });
  const filePath = path.join(UPLOAD_DIR, name);
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'File not found' });
  const row = db.prepare('SELECT * FROM task_attachments WHERE stored_name = ?').get(name);
  res.setHeader('Content-Type', row?.mime || 'application/octet-stream');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(row?.filename || name)}"`);
  fs.createReadStream(filePath).pipe(res);
});

router.get('/avatar/:name', (req, res) => {
  const name = req.params.name;
  if (name.includes('..') || name.includes('/') || name.includes('\\')) return res.status(400).json({ error: 'Invalid name' });
  const filePath = path.join(UPLOAD_DIR, name);
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'File not found' });
  res.setHeader('Content-Type', 'image/*');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  fs.createReadStream(filePath).pipe(res);
});

router.delete('/:attachmentId', requireAuth, (req, res) => {
  const a = db.prepare('SELECT * FROM task_attachments WHERE id = ?').get(req.params.attachmentId);
  if (!a) return res.status(404).json({ error: 'Attachment not found' });
  if (a.user_id !== req.user.id && !isAdmin(req.user)) return res.status(403).json({ error: 'No access to this attachment' });
  try { fs.unlinkSync(path.join(UPLOAD_DIR, a.stored_name)); } catch { /* noop */ }
  db.prepare('DELETE FROM task_attachments WHERE id = ?').run(a.id);
  audit(req, 'task.attachment_delete', 'task', a.task_id, `Deleted attachment ${a.filename}`);
  res.json({ ok: true });
});

export default router;
