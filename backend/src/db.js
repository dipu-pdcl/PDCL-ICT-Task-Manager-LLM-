import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import bcrypt from 'bcryptjs';
import { DEFAULT_ROLE_GROUPS } from './permissions.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const DATA_DIR = path.join(__dirname, '..', 'data');
export const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
export const DB_PATH = path.join(DATA_DIR, 'taskflow.db');
mkdirSync(UPLOAD_DIR, { recursive: true });

export let db = new DatabaseSync(DB_PATH);

db.exec('PRAGMA busy_timeout = 10000;');
try {
  db.exec('PRAGMA journal_mode = WAL;');
} catch { /* ignore if already WAL or held */ }
db.exec('PRAGMA foreign_keys = ON;');

export function openDatabase(filePath = DB_PATH) {
  const handle = new DatabaseSync(filePath);
  handle.exec('PRAGMA busy_timeout = 10000;');
  try {
    handle.exec('PRAGMA journal_mode = WAL;');
  } catch { /* ignore */ }
  handle.exec('PRAGMA foreign_keys = ON;');
  createBaseTables(handle);
  ensureSchema(handle);
  migrate(handle);
  return handle;
}

export const DEFAULT_TEAMS = [
  { id: 1, name: 'Application', description: 'Application development, software systems, and engineering' },
  { id: 2, name: 'Support', description: 'User technical support, IT helpdesk, and incident assistance' },
  { id: 3, name: 'Network', description: 'Network infrastructure, routing, bandwidth, and connectivity' },
  { id: 4, name: 'Infrastructure', description: 'Servers, cloud services, and IT infrastructure systems' },
  { id: 5, name: 'Operation', description: 'IT systems operations, monitoring, and maintenance' },
  { id: 6, name: 'Design', description: 'UI/UX design, graphics, and digital media' },
  { id: 7, name: 'Surveillance', description: 'CCTV surveillance, security cameras, and physical monitoring' },
  { id: 8, name: 'System Admin', description: 'Operating systems administration, access control, and identity' },
  { id: 9, name: 'Inventory', description: 'Hardware assets, equipment tracking, and inventory control' },
  { id: 10, name: 'Purchase', description: 'IT procurement, vendor management, and purchasing' },
  { id: 11, name: 'Branch IT', description: 'Branch-level IT support, equipment deployment, and field services' },
];

export const DEFAULT_BRANCHES = [
  { id: 11, name: 'Dhanmondi', description: 'Dhanmondi Branch', hotline: '09613-787801' },
  { id: 12, name: 'English Road', description: 'English Road Branch', hotline: '09613-787802' },
  { id: 13, name: 'Shantinagar', description: 'Shantinagar Branch', hotline: '09613-787803' },
  { id: 14, name: 'Narayanganj', description: 'Narayanganj Branch', hotline: '09613-787804' },
  { id: 15, name: 'Uttara', description: 'Uttara Branch', hotline: '09613-787805' },
  { id: 16, name: 'Shamoly', description: 'Shamoly Branch', hotline: '09613-787806' },
  { id: 17, name: 'Mirpur', description: 'Mirpur Branch', hotline: '09613-787807' },
  { id: 18, name: 'Savar', description: 'Savar Branch', hotline: '09613-787808' },
  { id: 19, name: 'Badda', description: 'Badda Branch', hotline: '09613-787809' },
  { id: 20, name: 'Chattagram', description: 'Chattagram Branch', hotline: '09613-787810' },
  { id: 21, name: 'Rajshahi', description: 'Rajshahi Branch', hotline: '09613-787811' },
  { id: 22, name: 'Bogura', description: 'Bogura Branch', hotline: '09613-787812' },
  { id: 23, name: 'Rangpur', description: 'Rangpur Branch', hotline: '09613-787813' },
  { id: 24, name: 'Mymensing', description: 'Mymensing Branch', hotline: '09613-787814' },
  { id: 25, name: 'Dinajpur', description: 'Dinajpur Branch', hotline: '09613-787815' },
  { id: 26, name: 'Gazipur', description: 'Gazipur Branch', hotline: '09613-787816' },
  { id: 27, name: 'Noakhali', description: 'Noakhali Branch', hotline: '09613-787817' },
  { id: 28, name: 'Kustia', description: 'Kustia Branch', hotline: '09613-787818' },
  { id: 29, name: 'Barisal', description: 'Barisal Branch', hotline: '09613-787819' },
  { id: 30, name: 'Bosila', description: 'Bosila Branch', hotline: '09613-787820' },
  { id: 31, name: 'Khulna', description: 'Khulna Branch', hotline: '09613-787821' },
  { id: 32, name: 'Jatrabari', description: 'Jatrabari Branch', hotline: '09613-787822' },
  { id: 33, name: 'Garib-e-Newaj', description: 'Garib-e-Newaj Branch', hotline: '09613-787823' },
  { id: 34, name: 'Tangail', description: 'Tangail Branch', hotline: '09613-787824' },
  { id: 35, name: 'Cumilla', description: 'Cumilla Branch', hotline: '09613-787825' },
];

export function ensureSchema(handle = db) {
  handle.exec(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL DEFAULT '{}',
      updated_at TEXT NOT NULL DEFAULT (datetime('now','+6 hours'))
    );

    CREATE TABLE IF NOT EXISTS role_groups (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      slug TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      description TEXT DEFAULT '',
      color TEXT DEFAULT '#6366f1',
      is_system INTEGER NOT NULL DEFAULT 0,
      permissions TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL DEFAULT (datetime('now','+6 hours')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now','+6 hours'))
    );
  `);

  // Seed default role groups if missing
  try {
    for (const rg of DEFAULT_ROLE_GROUPS) {
      const existing = handle.prepare('SELECT id FROM role_groups WHERE slug = ?').get(rg.slug);
      if (!existing) {
        handle.prepare(`
          INSERT INTO role_groups (slug, name, description, color, is_system, permissions)
          VALUES (?, ?, ?, ?, ?, ?)
        `).run(rg.slug, rg.name, rg.description, rg.color, rg.is_system, JSON.stringify(rg.permissions));
      }
    }
  } catch (err) {
    console.error('Error seeding default role groups:', err);
  }

  // Ensure default_role_group_id setting exists (defaults to 'user' role group)
  try {
    const defaultSetting = handle.prepare("SELECT value FROM settings WHERE key = 'default_role_group_id'").get();
    if (!defaultSetting) {
      const userGroup = handle.prepare("SELECT id FROM role_groups WHERE slug = 'user'").get();
      if (userGroup) {
        handle.prepare("INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES ('default_role_group_id', ?, datetime('now','+6 hours'))")
          .run(JSON.stringify(userGroup.id));
      }
    }
  } catch {}

  const hasUsersTable = handle.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='users'").get();
  if (hasUsersTable) {
    const userCols = handle.prepare('PRAGMA table_info(users)').all().map((c) => c.name);
    if (!userCols.includes('employee_id')) {
      handle.exec("ALTER TABLE users ADD COLUMN employee_id TEXT DEFAULT ''");
    }
    if (!userCols.includes('live_status')) {
      handle.exec("ALTER TABLE users ADD COLUMN live_status TEXT NOT NULL DEFAULT 'inactive'");
    }
    if (!userCols.includes('last_active_at')) {
      handle.exec("ALTER TABLE users ADD COLUMN last_active_at TEXT");
    }
    if (!userCols.includes('status_message')) {
      handle.exec("ALTER TABLE users ADD COLUMN status_message TEXT DEFAULT ''");
    }
    if (!userCols.includes('status_updated_at')) {
      handle.exec("ALTER TABLE users ADD COLUMN status_updated_at TEXT");
    }
    if (!userCols.includes('weekend_days')) {
      handle.exec("ALTER TABLE users ADD COLUMN weekend_days TEXT DEFAULT '[5]'");
    }
    if (!userCols.includes('role_group_id')) {
      handle.exec("ALTER TABLE users ADD COLUMN role_group_id INTEGER REFERENCES role_groups(id) ON DELETE SET NULL");
    }
    if (!userCols.includes('password_must_change')) {
      handle.exec("ALTER TABLE users ADD COLUMN password_must_change INTEGER NOT NULL DEFAULT 0");
    }
    // Populate employee_id and weekend_days for any users where blank
    handle.exec("UPDATE users SET employee_id = 'EMP' || printf('%03d', id) WHERE employee_id IS NULL OR employee_id = ''");
    handle.exec("UPDATE users SET weekend_days = '[5]' WHERE weekend_days IS NULL OR weekend_days = ''");

    // Link users to their appropriate role group
    try {
      handle.exec(`
        UPDATE users
        SET role_group_id = (SELECT id FROM role_groups WHERE slug = users.role)
        WHERE role_group_id IS NULL OR role_group_id = 0
      `);
      // For any fallback
      const defaultUserGroup = handle.prepare("SELECT id FROM role_groups WHERE slug = 'user'").get();
      if (defaultUserGroup) {
        handle.exec(`UPDATE users SET role_group_id = ${defaultUserGroup.id} WHERE role_group_id IS NULL OR role_group_id = 0`);
      }
    } catch {}

    // Ensure default super admin exists if database is fresh
    try {
      const defaultHash = bcrypt.hashSync('admin123', 10);
      const superGroup = handle.prepare("SELECT id FROM role_groups WHERE slug = 'super_admin'").get();
      const existingDipu = handle.prepare("SELECT id, password_hash, is_active FROM users WHERE lower(email) = 'dipu@populardiagnostic.com'").get();
      if (!existingDipu) {
        handle.prepare(`
          INSERT INTO users (name, email, password_hash, role, role_group_id, title, employee_id, is_active, live_status)
          VALUES ('Smd Dipu', 'dipu@populardiagnostic.com', ?, 'super_admin', ?, 'Chief Executive Officer', 'EMP001', 1, 'active')
        `).run(defaultHash, superGroup?.id || null);
      } else {
        if (!existingDipu.is_active) {
          handle.prepare("UPDATE users SET is_active = 1 WHERE id = ?").run(existingDipu.id);
        }
        if (superGroup) {
          handle.prepare("UPDATE users SET role_group_id = ? WHERE id = ?").run(superGroup.id, existingDipu.id);
        }
      }
    } catch {}
  }

  const hasTasksTable = handle.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='tasks'").get();
  if (hasTasksTable) {
    const taskCols = handle.prepare('PRAGMA table_info(tasks)').all().map((c) => c.name);
    if (!taskCols.includes('is_self_task')) {
      handle.exec("ALTER TABLE tasks ADD COLUMN is_self_task INTEGER NOT NULL DEFAULT 0");
    }
    if (!taskCols.includes('project_id')) {
      handle.exec("ALTER TABLE tasks ADD COLUMN project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL");
      handle.exec("CREATE INDEX IF NOT EXISTS idx_tasks_project ON tasks(project_id)");
    }
  }

  const hasPriorityTable = handle.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='priority_tasks'").get();
  if (hasPriorityTable) {
    const priorityCols = handle.prepare('PRAGMA table_info(priority_tasks)').all().map((c) => c.name);
    if (!priorityCols.includes('transferred_to_task_id')) {
      handle.exec("ALTER TABLE priority_tasks ADD COLUMN transferred_to_task_id INTEGER REFERENCES tasks(id) ON DELETE SET NULL");
    }
    if (!priorityCols.includes('transferred_at')) {
      handle.exec("ALTER TABLE priority_tasks ADD COLUMN transferred_at TEXT");
    }
  }

  const hasChatTable = handle.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='chat_messages'").get();
  if (hasChatTable) {
    const chatCols = handle.prepare('PRAGMA table_info(chat_messages)').all().map((c) => c.name);
    if (!chatCols.includes('recipient_id')) {
      handle.exec("ALTER TABLE chat_messages ADD COLUMN recipient_id INTEGER REFERENCES users(id) ON DELETE CASCADE");
    }
    if (!chatCols.includes('conversation_id')) {
      handle.exec("ALTER TABLE chat_messages ADD COLUMN conversation_id TEXT DEFAULT ''");
    }
    if (!chatCols.includes('mentions')) {
      handle.exec("ALTER TABLE chat_messages ADD COLUMN mentions TEXT DEFAULT '[]'");
    }
    if (!chatCols.includes('group_id')) {
      handle.exec("ALTER TABLE chat_messages ADD COLUMN group_id INTEGER REFERENCES chat_groups(id) ON DELETE CASCADE");
    }
    // Index for faster conversation queries
    handle.exec("CREATE INDEX IF NOT EXISTS idx_chat_conversation ON chat_messages(conversation_id, created_at)");
    handle.exec("CREATE INDEX IF NOT EXISTS idx_chat_recipient ON chat_messages(recipient_id, created_at)");
    handle.exec("CREATE INDEX IF NOT EXISTS idx_chat_group ON chat_messages(group_id, created_at)");
  }

  handle.exec(`
    CREATE TABLE IF NOT EXISTS leave_applications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      leave_type TEXT NOT NULL,
      duration_type TEXT NOT NULL DEFAULT 'full_day',
      start_date TEXT NOT NULL,
      end_date TEXT NOT NULL,
      days_count REAL NOT NULL DEFAULT 1,
      year INTEGER NOT NULL,
      reason TEXT NOT NULL,
      reliever_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      emergency_contact TEXT DEFAULT '',
      attachment_url TEXT DEFAULT '',
      status TEXT NOT NULL DEFAULT 'pending',
      admin_remarks TEXT DEFAULT '',
      approved_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      approved_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now','+6 hours')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now','+6 hours'))
    );

    CREATE TABLE IF NOT EXISTS leave_quotas (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      year INTEGER NOT NULL,
      el_quota REAL NOT NULL DEFAULT 14,
      cl_quota REAL NOT NULL DEFAULT 10,
      sl_quota REAL NOT NULL DEFAULT 14,
      notes TEXT DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now','+6 hours')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now','+6 hours')),
      UNIQUE(user_id, year)
    );
  `);

  // Merge duplicate Super Admin accounts (e.g. admin@taskflow.io into dipu@populardiagnostic.com)
  try {
    const primaryUser = handle.prepare("SELECT id FROM users WHERE lower(email) = 'dipu@populardiagnostic.com'").get();
    const duplicateUser = handle.prepare("SELECT id FROM users WHERE lower(email) = 'admin@taskflow.io'").get();

    if (primaryUser && duplicateUser && primaryUser.id !== duplicateUser.id) {
      const pId = primaryUser.id;
      const dId = duplicateUser.id;

      // 1. Tasks
      handle.prepare("UPDATE tasks SET created_by = ? WHERE created_by = ?").run(pId, dId);
      handle.prepare("UPDATE tasks SET reviewer_id = ? WHERE reviewer_id = ?").run(pId, dId);

      // 2. Task Assignees (handle conflicts)
      const dupAssignees = handle.prepare("SELECT task_id, progress, status, assigned_at, completed_at FROM task_assignees WHERE user_id = ?").all(dId);
      for (const a of dupAssignees) {
        const existsOnPrimary = handle.prepare("SELECT id FROM task_assignees WHERE task_id = ? AND user_id = ?").get(a.task_id, pId);
        if (!existsOnPrimary) {
          handle.prepare("UPDATE task_assignees SET user_id = ? WHERE task_id = ? AND user_id = ?").run(pId, a.task_id, dId);
        } else {
          handle.prepare("DELETE FROM task_assignees WHERE task_id = ? AND user_id = ?").run(a.task_id, dId);
        }
      }

      // 3. Task Comments & Checklist & Attachments
      handle.prepare("UPDATE task_comments SET user_id = ? WHERE user_id = ?").run(pId, dId);
      handle.prepare("UPDATE task_checklist SET created_by = ? WHERE created_by = ?").run(pId, dId);
      handle.prepare("UPDATE task_attachments SET user_id = ? WHERE user_id = ?").run(pId, dId);

      // 4. Time Entries
      handle.prepare("UPDATE time_entries SET user_id = ? WHERE user_id = ?").run(pId, dId);

      // 5. Approvals
      handle.prepare("UPDATE approvals SET requester_id = ? WHERE requester_id = ?").run(pId, dId);
      handle.prepare("UPDATE approvals SET approver_id = ? WHERE approver_id = ?").run(pId, dId);

      // 6. Notifications & Audit Logs & Saved Filters & Task History
      handle.prepare("UPDATE notifications SET user_id = ? WHERE user_id = ?").run(pId, dId);
      handle.prepare("UPDATE audit_logs SET user_id = ? WHERE user_id = ?").run(pId, dId);
      handle.prepare("UPDATE saved_filters SET user_id = ? WHERE user_id = ?").run(pId, dId);
      handle.prepare("UPDATE task_history SET user_id = ? WHERE user_id = ?").run(pId, dId);

      // 7. Priority Tasks & Remarks
      handle.prepare("UPDATE priority_tasks SET created_by = ? WHERE created_by = ?").run(pId, dId);
      handle.prepare("UPDATE priority_tasks SET assignee_user_id = ? WHERE assignee_user_id = ?").run(pId, dId);
      handle.prepare("UPDATE priority_task_remarks SET user_id = ? WHERE user_id = ?").run(pId, dId);

      // 8. Leaves & Quotas
      handle.prepare("UPDATE leave_applications SET user_id = ? WHERE user_id = ?").run(pId, dId);
      handle.prepare("UPDATE leave_applications SET reliever_user_id = ? WHERE reliever_user_id = ?").run(pId, dId);
      handle.prepare("UPDATE leave_applications SET approved_by = ? WHERE approved_by = ?").run(pId, dId);
      handle.prepare("DELETE FROM leave_quotas WHERE user_id = ?").run(dId);

      // 9. Teams & Departments
      handle.prepare("UPDATE teams SET lead_id = ? WHERE lead_id = ?").run(pId, dId);
      handle.prepare("UPDATE departments SET head_id = ? WHERE head_id = ?").run(pId, dId);

      // 10. Delete duplicate account
      handle.prepare("DELETE FROM users WHERE id = ?").run(dId);
    }
  } catch (err) {
    console.error('Error merging duplicate Super Admin accounts:', err);
  }

  // Ensure default 11 teams exist without deleting existing or restored teams
  try {
    const hasTeamsTable = handle.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='teams'").get();
    if (hasTeamsTable) {
      const insertStmt = handle.prepare('INSERT OR IGNORE INTO teams (id, name, description) VALUES (?, ?, ?)');
      for (const t of DEFAULT_TEAMS) {
        insertStmt.run(t.id, t.name, t.description);
      }
    }
  } catch (err) {
    console.error('Error ensuring teams:', err);
  }

  // Ensure default 25 branches exist without deleting existing or restored branches
  try {
    const hasDeptTable = handle.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='departments'").get();
    if (hasDeptTable) {
      const deptCols = handle.prepare('PRAGMA table_info(departments)').all().map((c) => c.name);
      if (!deptCols.includes('hotline')) {
        handle.exec("ALTER TABLE departments ADD COLUMN hotline TEXT DEFAULT ''");
      }
      if (!deptCols.includes('ext')) {
        handle.exec("ALTER TABLE departments ADD COLUMN ext TEXT DEFAULT ''");
      }
      if (!deptCols.includes('hotline_ext')) {
        handle.exec("ALTER TABLE departments ADD COLUMN hotline_ext TEXT DEFAULT ''");
      }
      if (!deptCols.includes('manager_name')) {
        handle.exec("ALTER TABLE departments ADD COLUMN manager_name TEXT DEFAULT ''");
      }
      if (!deptCols.includes('manager_ext')) {
        handle.exec("ALTER TABLE departments ADD COLUMN manager_ext TEXT DEFAULT ''");
      }
      const insertStmt = handle.prepare('INSERT OR IGNORE INTO departments (id, name, description, hotline, ext, hotline_ext, manager_name, manager_ext) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
      for (const b of DEFAULT_BRANCHES) {
        insertStmt.run(b.id, b.name, b.description, b.hotline || '', '', b.hotline || '', b.manager_name || '', b.manager_ext || '');
        if (b.hotline) {
          handle.prepare("UPDATE departments SET hotline = ? WHERE id = ? AND (hotline IS NULL OR hotline = '')")
            .run(b.hotline, b.id);
        }
      }
      // Populate any remaining branch without hotline
      const remaining = handle.prepare("SELECT id, hotline_ext, hotline FROM departments WHERE hotline IS NULL OR hotline = ''").all();
      for (const r of remaining) {
        if (r.hotline_ext) {
          const parts = r.hotline_ext.split(/,\s*Ext:\s*/i);
          const h = (parts[0] || '').trim();
          handle.prepare("UPDATE departments SET hotline = ?, ext = '', hotline_ext = ? WHERE id = ?").run(h, h, r.id);
        } else {
          handle.prepare("UPDATE departments SET hotline = '09613-787801', ext = '', hotline_ext = '09613-787801' WHERE id = ?").run(r.id);
        }
      }
      // Remove all ext options from branches: clear ext column and clean hotline_ext
      handle.exec(`
        UPDATE departments
        SET ext = '',
            hotline_ext = hotline
        WHERE hotline IS NOT NULL AND hotline != '';
      `);
    }
  } catch (err) {
    console.error('Error ensuring branches:', err);
  }
}

const SCHEMA_VERSION = 1;

function recreateTableDhaka(handle, name) {
  const row = handle.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name=?").get(name);
  if (!row || !row.sql) return;
  const def = row.sql;
  if (!def.includes("datetime('now')") && !def.includes("date('now')")) return;
  const newDef = def.replace(/datetime\('now'\)/g, "datetime('now','+6 hours')").replace(/date\('now'\)/g, "date('now','+6 hours')");
  const tmp = 'zz__' + name;
  handle.exec(newDef.replace(/^CREATE TABLE\s+[^\s(]+/, `CREATE TABLE ${tmp}`));
  handle.exec(`INSERT INTO ${tmp} SELECT * FROM ${name}`);
  handle.exec(`DROP TABLE ${name}`);
  handle.exec(`ALTER TABLE ${tmp} RENAME TO ${name}`);
}

export function migrate(handle = db) {
  const v = Number(handle.prepare('PRAGMA user_version').get().user_version) || 0;
  if (v >= SCHEMA_VERSION) return;
  handle.exec('PRAGMA foreign_keys = OFF;');
  handle.exec('BEGIN;');
  try {
    for (const t of ['users', 'teams', 'departments', 'projects', 'project_members', 'tasks', 'task_assignees', 'task_comments', 'task_checklist', 'task_attachments', 'time_entries', 'approvals', 'notifications', 'audit_logs', 'settings', 'saved_filters', 'task_history']) {
      recreateTableDhaka(handle, t);
    }
    handle.exec(`
UPDATE users SET created_at = datetime(created_at, '+6 hours') WHERE created_at IS NOT NULL AND created_at != '';
UPDATE users SET updated_at = datetime(updated_at, '+6 hours') WHERE updated_at IS NOT NULL AND updated_at != '';
UPDATE users SET last_login = datetime(last_login, '+6 hours') WHERE last_login IS NOT NULL AND last_login != '';
UPDATE teams SET created_at = datetime(created_at, '+6 hours') WHERE created_at IS NOT NULL AND created_at != '';
UPDATE departments SET created_at = datetime(created_at, '+6 hours') WHERE created_at IS NOT NULL AND created_at != '';
UPDATE tasks SET created_at = datetime(created_at, '+6 hours') WHERE created_at IS NOT NULL AND created_at != '';
UPDATE tasks SET updated_at = datetime(updated_at, '+6 hours') WHERE updated_at IS NOT NULL AND updated_at != '';
UPDATE tasks SET completed_at = datetime(completed_at, '+6 hours') WHERE completed_at IS NOT NULL AND completed_at != '';
UPDATE task_assignees SET assigned_at = datetime(assigned_at, '+6 hours') WHERE assigned_at IS NOT NULL AND assigned_at != '';
UPDATE task_assignees SET completed_at = datetime(completed_at, '+6 hours') WHERE completed_at IS NOT NULL AND completed_at != '';
UPDATE task_comments SET created_at = datetime(created_at, '+6 hours') WHERE created_at IS NOT NULL AND created_at != '';
UPDATE task_checklist SET created_at = datetime(created_at, '+6 hours') WHERE created_at IS NOT NULL AND created_at != '';
UPDATE task_attachments SET uploaded_at = datetime(uploaded_at, '+6 hours') WHERE uploaded_at IS NOT NULL AND uploaded_at != '';
UPDATE time_entries SET created_at = datetime(created_at, '+6 hours') WHERE created_at IS NOT NULL AND created_at != '';
UPDATE time_entries SET date = date(date, '+6 hours') WHERE date IS NOT NULL AND date != '';
UPDATE approvals SET created_at = datetime(created_at, '+6 hours') WHERE created_at IS NOT NULL AND created_at != '';
UPDATE approvals SET updated_at = datetime(updated_at, '+6 hours') WHERE updated_at IS NOT NULL AND updated_at != '';
UPDATE notifications SET created_at = datetime(created_at, '+6 hours') WHERE created_at IS NOT NULL AND created_at != '';
UPDATE audit_logs SET created_at = datetime(created_at, '+6 hours') WHERE created_at IS NOT NULL AND created_at != '';
UPDATE settings SET updated_at = datetime(updated_at, '+6 hours') WHERE updated_at IS NOT NULL AND updated_at != '';
UPDATE saved_filters SET created_at = datetime(created_at, '+6 hours') WHERE created_at IS NOT NULL AND created_at != '';
UPDATE task_history SET created_at = datetime(created_at, '+6 hours') WHERE created_at IS NOT NULL AND created_at != '';
`);
    handle.exec('COMMIT;');
  } catch (e) {
    handle.exec('ROLLBACK;');
    handle.exec('PRAGMA foreign_keys = ON;');
    throw e;
  }
  handle.exec('PRAGMA foreign_keys = ON;');
  handle.exec(`PRAGMA user_version = ${SCHEMA_VERSION};`);
}

export function closeDatabase() {
  try {
    db.exec('PRAGMA wal_checkpoint(TRUNCATE);');
  } catch { /* noop */ }
  try {
    db.close();
  } catch { /* already closed */ }
}

export function replaceDatabase(buffer) {
  closeDatabase();
  for (const suffix of ['-wal', '-shm']) {
    try { rmSync(DB_PATH + suffix, { force: true }); } catch { /* noop */ }
  }
  writeFileSync(DB_PATH, buffer);
  db = openDatabase(DB_PATH);
}

/**
 * Restores the entire database atomically from structured table data.
 * This restores 100% of all records, relationships, foreign keys, settings,
 * and sequences safely in an atomic transaction without closing SQLite handles.
 */
export function restoreTablesFromData(tablesData, handle = db) {
  handle.exec('PRAGMA busy_timeout = 10000;');
  handle.exec('PRAGMA foreign_keys = OFF;');
  handle.exec('BEGIN TRANSACTION;');

  try {
    // 1. Get all current user tables in destination DB
    const existingTableRows = handle.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all();
    const existingTables = existingTableRows.map((r) => r.name);

    // 2. Clear all existing data from tables in safe order
    for (const t of existingTables) {
      handle.exec(`DELETE FROM "${t.replace(/"/g, '""')}";`);
    }

    // 3. Insert all data from backup tables
    const tableNames = Object.keys(tablesData || {});
    for (const tableName of tableNames) {
      if (tableName.startsWith('sqlite_')) continue;
      const rows = tablesData[tableName];
      if (!Array.isArray(rows) || rows.length === 0) continue;

      // Make sure destination table exists
      if (!existingTables.includes(tableName)) continue;

      const columns = Object.keys(rows[0]);
      if (columns.length === 0) continue;

      const colList = columns.map((c) => `"${c.replace(/"/g, '""')}"`).join(', ');
      const placeholders = columns.map(() => '?').join(', ');
      const insertSql = `INSERT INTO "${tableName.replace(/"/g, '""')}" (${colList}) VALUES (${placeholders})`;
      const insertStmt = handle.prepare(insertSql);

      for (const row of rows) {
        const values = columns.map((col) => (row[col] === undefined ? null : row[col]));
        insertStmt.run(...values);
      }
    }

    // 4. Restore sqlite_sequence if provided to preserve auto-increment pointers
    if (tablesData.sqlite_sequence && Array.isArray(tablesData.sqlite_sequence)) {
      try {
        handle.exec('DELETE FROM sqlite_sequence;');
        const seqStmt = handle.prepare('INSERT INTO sqlite_sequence (name, seq) VALUES (?, ?)');
        for (const s of tablesData.sqlite_sequence) {
          if (s && s.name && s.seq !== undefined) {
            seqStmt.run(s.name, s.seq);
          }
        }
      } catch { /* noop if sqlite_sequence not writable */ }
    }

    handle.exec('COMMIT;');
  } catch (err) {
    handle.exec('ROLLBACK;');
    throw err;
  } finally {
    handle.exec('PRAGMA foreign_keys = ON;');
  }
}

export function createBaseTables(handle = db) {
  handle.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  password_must_change INTEGER NOT NULL DEFAULT 0,
  role TEXT NOT NULL DEFAULT 'user',
  title TEXT DEFAULT '',
  phone TEXT DEFAULT '',
  avatar TEXT DEFAULT '',
  employee_id TEXT DEFAULT '',
  live_status TEXT NOT NULL DEFAULT 'inactive',
  last_active_at TEXT,
  status_message TEXT DEFAULT '',
  status_updated_at TEXT,
  weekend_days TEXT DEFAULT '[5]',
  team_id INTEGER REFERENCES teams(id) ON DELETE SET NULL,
  department_id INTEGER REFERENCES departments(id) ON DELETE SET NULL,
  is_active INTEGER NOT NULL DEFAULT 1,
  last_login TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now','+6 hours')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now','+6 hours'))
);

CREATE TABLE IF NOT EXISTS teams (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT UNIQUE NOT NULL,
  description TEXT DEFAULT '',
  lead_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now','+6 hours'))
);

CREATE TABLE IF NOT EXISTS departments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT UNIQUE NOT NULL,
  description TEXT DEFAULT '',
  head_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  hotline TEXT DEFAULT '',
  ext TEXT DEFAULT '',
  hotline_ext TEXT DEFAULT '',
  manager_name TEXT DEFAULT '',
  manager_ext TEXT DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now','+6 hours'))
);

CREATE TABLE IF NOT EXISTS tasks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  description TEXT DEFAULT '',
  status TEXT NOT NULL DEFAULT 'todo',
  priority TEXT NOT NULL DEFAULT 'medium',
  difficulty TEXT NOT NULL DEFAULT 'medium',
  task_type TEXT DEFAULT 'task',
  flags TEXT DEFAULT '[]',
  tags TEXT DEFAULT '[]',
  budget REAL DEFAULT 0,
  estimated_hours REAL DEFAULT 0,
  due_date TEXT,
  start_date TEXT,
  created_by INTEGER REFERENCES users(id),
  reviewer_id INTEGER REFERENCES users(id),
  team_id INTEGER REFERENCES teams(id) ON DELETE SET NULL,
  department_id INTEGER REFERENCES departments(id) ON DELETE SET NULL,
  parent_task_id INTEGER REFERENCES tasks(id) ON DELETE SET NULL,
  progress INTEGER NOT NULL DEFAULT 0,
  approval_status TEXT DEFAULT 'none',
  is_blocked INTEGER NOT NULL DEFAULT 0,
  is_recurring INTEGER NOT NULL DEFAULT 0,
  recurring_rule TEXT DEFAULT '',
  archived INTEGER NOT NULL DEFAULT 0,
  is_self_task INTEGER NOT NULL DEFAULT 0,
  project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now','+6 hours')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now','+6 hours')),
  completed_at TEXT
);

CREATE TABLE IF NOT EXISTS task_assignees (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  progress INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'todo',
  assigned_at TEXT NOT NULL DEFAULT (datetime('now','+6 hours')),
  completed_at TEXT,
  UNIQUE(task_id, user_id)
);

CREATE TABLE IF NOT EXISTS task_comments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id),
  content TEXT NOT NULL,
  mentions TEXT DEFAULT '[]',
  created_at TEXT NOT NULL DEFAULT (datetime('now','+6 hours'))
);

CREATE TABLE IF NOT EXISTS task_checklist (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  done INTEGER NOT NULL DEFAULT 0,
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now','+6 hours'))
);

CREATE TABLE IF NOT EXISTS task_attachments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  user_id INTEGER REFERENCES users(id),
  filename TEXT NOT NULL,
  stored_name TEXT NOT NULL,
  size INTEGER DEFAULT 0,
  mime TEXT DEFAULT '',
  uploaded_at TEXT NOT NULL DEFAULT (datetime('now','+6 hours'))
);

CREATE TABLE IF NOT EXISTS projects (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  description TEXT DEFAULT '',
  status TEXT NOT NULL DEFAULT 'active',
  priority TEXT NOT NULL DEFAULT 'medium',
  start_date TEXT,
  deadline TEXT,
  budget REAL DEFAULT 0,
  spent REAL DEFAULT 0,
  progress INTEGER NOT NULL DEFAULT 0,
  color TEXT DEFAULT '#6366f1',
  created_by INTEGER REFERENCES users(id),
  archived INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now','+6 hours')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now','+6 hours'))
);

CREATE TABLE IF NOT EXISTS project_members (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'member',
  joined_at TEXT NOT NULL DEFAULT (datetime('now','+6 hours')),
  UNIQUE(project_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_project_members_user ON project_members(user_id);
CREATE INDEX IF NOT EXISTS idx_project_members_proj ON project_members(project_id);

CREATE TABLE IF NOT EXISTS task_dependencies (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  depends_on INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  UNIQUE(task_id, depends_on)
);

CREATE TABLE IF NOT EXISTS time_entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id),
  hours REAL NOT NULL DEFAULT 0,
  note TEXT DEFAULT '',
  date TEXT NOT NULL DEFAULT (date('now','+6 hours')),
  created_at TEXT NOT NULL DEFAULT (datetime('now','+6 hours'))
);

CREATE TABLE IF NOT EXISTS approvals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  requester_id INTEGER NOT NULL REFERENCES users(id),
  approver_id INTEGER REFERENCES users(id),
  status TEXT NOT NULL DEFAULT 'pending',
  comment TEXT DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now','+6 hours')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now','+6 hours'))
);

CREATE TABLE IF NOT EXISTS notifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type TEXT NOT NULL DEFAULT 'info',
  title TEXT NOT NULL,
  message TEXT DEFAULT '',
  link TEXT DEFAULT '',
  read INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now','+6 hours'))
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  user_name TEXT DEFAULT '',
  action TEXT NOT NULL,
  entity_type TEXT DEFAULT '',
  entity_id INTEGER,
  details TEXT DEFAULT '',
  ip TEXT DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now','+6 hours'))
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL DEFAULT '{}',
  updated_at TEXT NOT NULL DEFAULT (datetime('now','+6 hours'))
);

CREATE TABLE IF NOT EXISTS holidays (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  date TEXT NOT NULL,
  name TEXT NOT NULL DEFAULT '',
  UNIQUE(date)
);

CREATE TABLE IF NOT EXISTS saved_filters (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
     name TEXT NOT NULL,
     payload TEXT NOT NULL DEFAULT '{}',
     created_at TEXT NOT NULL DEFAULT (datetime('now','+6 hours'))
   );
 
   CREATE TABLE IF NOT EXISTS task_history (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
     user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
     action TEXT NOT NULL,
     field TEXT DEFAULT '',
     old_value TEXT DEFAULT '',
     new_value TEXT DEFAULT '',
     created_at TEXT NOT NULL DEFAULT (datetime('now','+6 hours'))
   );
 
   CREATE TABLE IF NOT EXISTS priority_tasks (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     work_title TEXT NOT NULL,
     description TEXT DEFAULT '',
     priority TEXT NOT NULL DEFAULT 'medium',
     assignee_name TEXT DEFAULT '',
     assignee_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
     status TEXT NOT NULL DEFAULT 'todo',
     due_date TEXT,
     remarks TEXT DEFAULT '',
     created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
     transferred_to_task_id INTEGER REFERENCES tasks(id) ON DELETE SET NULL,
     transferred_at TEXT,
     created_at TEXT NOT NULL DEFAULT (datetime('now','+6 hours')),
     updated_at TEXT NOT NULL DEFAULT (datetime('now','+6 hours'))
   );
 
   CREATE TABLE IF NOT EXISTS priority_task_remarks (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     priority_task_id INTEGER NOT NULL REFERENCES priority_tasks(id) ON DELETE CASCADE,
     user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
     user_name TEXT DEFAULT '',
     user_avatar TEXT DEFAULT '',
     user_role TEXT DEFAULT '',
     remark TEXT NOT NULL,
     created_at TEXT NOT NULL DEFAULT (datetime('now','+6 hours'))
   );
 
   CREATE TABLE IF NOT EXISTS chat_messages (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     task_id INTEGER REFERENCES tasks(id) ON DELETE CASCADE,
     sender_id INTEGER NOT NULL REFERENCES users(id),
     recipient_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
     group_id INTEGER REFERENCES chat_groups(id) ON DELETE CASCADE,
     conversation_id TEXT DEFAULT '',
     content TEXT NOT NULL,
     mentions TEXT DEFAULT '[]',
     created_at TEXT NOT NULL DEFAULT (datetime('now','+6 hours')),
     updated_at TEXT NOT NULL DEFAULT (datetime('now','+6 hours'))
   );

   CREATE TABLE IF NOT EXISTS chat_reads (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     message_id INTEGER NOT NULL REFERENCES chat_messages(id) ON DELETE CASCADE,
     user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
     read_at TEXT NOT NULL DEFAULT (datetime('now','+6 hours')),
     UNIQUE(message_id, user_id)
   );

   CREATE TABLE IF NOT EXISTS chat_groups (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     name TEXT NOT NULL,
     description TEXT DEFAULT '',
     created_by INTEGER NOT NULL REFERENCES users(id),
     avatar TEXT DEFAULT '',
     is_active INTEGER NOT NULL DEFAULT 1,
     created_at TEXT NOT NULL DEFAULT (datetime('now','+6 hours')),
     updated_at TEXT NOT NULL DEFAULT (datetime('now','+6 hours'))
   );

   CREATE TABLE IF NOT EXISTS chat_group_members (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     group_id INTEGER NOT NULL REFERENCES chat_groups(id) ON DELETE CASCADE,
     user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
     role TEXT NOT NULL DEFAULT 'member',
     joined_at TEXT NOT NULL DEFAULT (datetime('now','+6 hours')),
     UNIQUE(group_id, user_id)
   );
  `);
}

createBaseTables();
ensureSchema();
migrate();
