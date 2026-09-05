import './env.js';
import express from 'express';
import cors from 'cors';
import multer from 'multer';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { seed } from './seed.js';
import authRoutes from './routes/auth.js';
import userRoutes from './routes/users.js';
import teamRoutes from './routes/teams.js';
import deptRoutes from './routes/departments.js';
import taskRoutes from './routes/tasks.js';
import notifRoutes from './routes/notifications.js';
import auditRoutes from './routes/audit.js';
import settingsRoutes from './routes/settings.js';
import kpiRoutes from './routes/kpi.js';
import dashboardRoutes from './routes/dashboard.js';
import reportRoutes from './routes/reports.js';
import uploadRoutes from './routes/uploads.js';
import backupRoutes from './routes/backup.js';
import priorityTaskRoutes from './routes/priorityTasks.js';
import leaveRoutes from './routes/leaves.js';
import liveStatusRoutes from './routes/liveStatus.js';
import chatRoutes from './routes/chat.js';
import projectRoutes, { updateProjectProgressForTask } from './routes/projects.js';
import { startChatCleanup } from './chatCleanup.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
await seed();

const app = express();
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

app.get('/api/health', (req, res) => res.json({ status: 'ok' }));
app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/teams', teamRoutes);
app.use('/api/departments', deptRoutes);
app.use('/api/tasks', taskRoutes);
app.use('/api/priority-tasks', priorityTaskRoutes);
app.use('/api/live-status', liveStatusRoutes);
app.use('/api/leaves', leaveRoutes);
app.use('/api/notifications', notifRoutes);
app.use('/api/audit', auditRoutes);
app.use('/api/settings', settingsRoutes);
app.use('/api/kpi', kpiRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/reports', reportRoutes);
app.use('/api/uploads', uploadRoutes);
app.use('/api/settings', backupRoutes);
app.use('/api/chat', chatRoutes); // Added chat routes
app.use('/api/projects', projectRoutes);

const frontendDir = path.join(__dirname, '..', '..', 'frontend');
const distDir = path.join(frontendDir, 'dist');
const hasDist = fs.existsSync(path.join(distDir, 'index.html'));
const isDev = process.env.NODE_ENV !== 'production';

if (hasDist && !isDev) {
  app.use(express.static(distDir));
  app.get(/^(?!\/api).*/, (req, res) => res.sendFile(path.join(distDir, 'index.html')));
} else {
  try {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true, hmr: false },
      root: frontendDir,
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } catch (err) {
    if (hasDist) {
      console.log('Vite middleware unavailable, serving pre-built frontend from dist.');
      app.use(express.static(distDir));
      app.get(/^(?!\/api).*/, (req, res) => res.sendFile(path.join(distDir, 'index.html')));
    } else {
      console.error('Frontend dist not found and Vite middleware unavailable:', err);
    }
  }
}

app.use((req, res) => res.status(404).json({ error: 'Not found' }));

app.use((err, req, res, next) => {
  if (err.type === 'entity.parse.failed' || err instanceof SyntaxError) {
    return res.status(400).json({ error: 'Invalid JSON in request body' });
  }
  if (err instanceof multer.MulterError) {
    return res.status(400).json({ error: err.code === 'LIMIT_FILE_SIZE' ? 'File is too large' : 'Upload failed: ' + err.message });
  }
  console.error(err);
  res.status(500).json({ error: 'Internal server error' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`TaskFlow running on http://0.0.0.0:${PORT}`);
  startChatCleanup();
});