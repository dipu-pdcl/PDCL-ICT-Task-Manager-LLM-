import React, { useEffect, useMemo, useState } from 'react';
import { Plus, X, Trash2 } from 'lucide-react';
import { api } from '../lib/api';
import type { User, Team, Department, Task, Assignee } from '../lib/types';
import { useSettings } from '../lib/settings';
import { useAuth } from '../lib/auth';
import { Modal, useToast, Switch } from './ui';
import { cx, FLAGS, TASK_TYPES } from '../lib/utils';

export interface TaskFormValues {
  title: string;
  description: string;
  status: string;
  priority: string;
  difficulty: string;
  task_type: string;
  flags: string[];
  tags: string[];
  budget: number;
  estimated_hours: number;
  due_date: string;
  start_date: string;
  assignees: number[];
  reviewer_id: number | '';
  team_id: number | '';
  department_id: number | '';
  checklist: string[];
  is_blocked: boolean;
  is_recurring: boolean;
  recurring_rule: string;
  parent_task_id: number | '';
}

export function emptyForm(): TaskFormValues {
  return {
    title: '', description: '', status: 'todo', priority: 'medium', difficulty: 'medium',
    task_type: 'task', flags: [], tags: [], budget: 0, estimated_hours: 0,
    due_date: '', start_date: '', assignees: [], reviewer_id: '', team_id: '', department_id: '',
    checklist: [], is_blocked: false, is_recurring: false, recurring_rule: '', parent_task_id: '',
  };
}

export default function TaskForm({ open, onClose, task, onSaved, selfTask }: {
  open: boolean; onClose: () => void; task?: Task | null; onSaved: (t: Task) => void; selfTask?: boolean;
}) {
  const settings = useSettings();
  const toast = useToast();
  const { user: me } = useAuth();
  const [form, setForm] = useState<TaskFormValues>(emptyForm());
  const [users, setUsers] = useState<User[]>([]);
  const [teams, setTeams] = useState<Team[]>([]);
  const [depts, setDepts] = useState<Department[]>([]);
  const [saving, setSaving] = useState(false);
  const [tagInput, setTagInput] = useState('');
  const [newCheck, setNewCheck] = useState('');
  const [allTasks, setAllTasks] = useState<Task[]>([]);

  useEffect(() => {
    if (!open) return;
    api.get<User[]>('/users').then(setUsers).catch(() => {});
    api.get<Team[]>('/teams').then(setTeams).catch(() => {});
    api.get<Department[]>('/departments').then(setDepts).catch(() => {});
    api.get<Task[]>('/tasks?limit=300').then((t) => setAllTasks(t)).catch(() => {});
    if (task) {
      setForm({
        title: task.title, description: task.description || '', status: task.status, priority: task.priority,
        difficulty: task.difficulty, task_type: task.task_type, flags: task.flags || [], tags: task.tags || [],
        budget: task.budget || 0, estimated_hours: task.estimated_hours || 0,
        due_date: task.due_date || '', start_date: task.start_date || '',
        assignees: (task.assignees || []).map((a) => a.user_id),
        reviewer_id: task.reviewer_id || '', team_id: task.team_id || '', department_id: task.department_id || '',
        checklist: [], is_blocked: !!task.is_blocked, is_recurring: !!task.is_recurring,
        recurring_rule: task.recurring_rule || '', parent_task_id: task.parent_task_id || '',
      });
    } else {
      const base = emptyForm();
      if (selfTask && me) base.assignees = [me.id];
      setForm(base);
    }
    setTagInput('');
    setNewCheck('');
  }, [open, task, selfTask, me]);

  const set = (patch: Partial<TaskFormValues>) => setForm((f) => ({ ...f, ...patch }));
  const toggleInList = (key: 'flags' | 'tags', v: string) => {
    setForm((f) => ({
      ...f,
      [key]: f[key].includes(v) ? f[key].filter((x) => x !== v) : [...f[key], v],
    }));
  };
  const addTag = () => {
    const t = tagInput.trim();
    if (t && !form.tags.includes(t)) set({ tags: [...form.tags, t] });
    setTagInput('');
  };

  const save = async () => {
    if (!form.title.trim()) return toast('Task title is required', 'error');
    setSaving(true);
    try {
      const payload: any = { ...form, is_self_task: selfTask ? 1 : 0, assignees: form.assignees, reviewer_id: form.reviewer_id || null, team_id: form.team_id || null, department_id: form.department_id || null, parent_task_id: form.parent_task_id || null };
      const saved = task
        ? await api.put<Task>(`/tasks/${task.id}`, payload)
        : await api.post<Task>('/tasks', payload);
      toast(task ? 'Task updated' : 'Task created');
      onSaved(saved);
      onClose();
    } catch (e: any) {
      toast(e.message, 'error');
    } finally {
      setSaving(false);
    }
  };

  const flagSet = useMemo(() => [...new Set([...FLAGS, ...form.flags])], [form.flags]);

  return (
    <Modal open={open} onClose={onClose} title={task ? 'Edit Task' : selfTask ? 'Create Self Task' : 'Create New Task'} width={760}
      footer={
        <>
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={save} disabled={saving}>{saving ? 'Saving...' : task ? 'Save Changes' : selfTask ? 'Create Self Task' : 'Create Task'}</button>
        </>
      }>
      {selfTask && !task && (
        <div className="mb-4 px-3 py-2 rounded-lg text-sm bg-brand/10 text-brand border border-brand/20">
          Self tasks are personal tasks assigned to yourself. Completing one earns KPI points (1 pt within 1 hour, 2 pts after 1 hour).
        </div>
      )}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="md:col-span-2">
          <label className="label">Task Title *</label>
          <input className="input" placeholder="e.g. Implement new dashboard widgets" value={form.title} onChange={(e) => set({ title: e.target.value })} />
        </div>

        <div className="md:col-span-2">
          <label className="label">Description</label>
          <textarea className="input textarea" placeholder="Detailed description, acceptance criteria..." value={form.description} onChange={(e) => set({ description: e.target.value })} />
        </div>

        <div>
          <label className="label">Status *</label>
          <select className="input" value={form.status} onChange={(e) => set({ status: e.target.value })}>
            {(settings?.taskStatuses || []).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </div>
        <div>
          <label className="label">Priority *</label>
          <select className="input" value={form.priority} onChange={(e) => set({ priority: e.target.value })}>
            {(settings?.priorities || []).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </div>
        {task && (
          <>
            <div>
              <label className="label">Difficulty</label>
              <select className="input" value={form.difficulty} onChange={(e) => set({ difficulty: e.target.value })}>
                {(settings?.difficulties || []).map((d) => <option key={d.id} value={d.id}>{d.name} ({d.points} pts)</option>)}
              </select>
            </div>
            <div>
              <label className="label">Task Type</label>
              <select className="input" value={form.task_type} onChange={(e) => set({ task_type: e.target.value })}>
                {TASK_TYPES.map((t) => <option key={t} value={t}>{t[0].toUpperCase() + t.slice(1)}</option>)}
              </select>
            </div>
          </>
        )}
        <div>
          <label className="label">Due Date</label>
          <input type="date" className="input" value={form.due_date} onChange={(e) => set({ due_date: e.target.value })} />
        </div>
        {task && (
          <>
            <div>
              <label className="label">Start Date</label>
              <input type="date" className="input" value={form.start_date} onChange={(e) => set({ start_date: e.target.value })} />
            </div>
            <div>
              <label className="label">Budget</label>
              <input type="number" className="input" placeholder="0" value={form.budget} onChange={(e) => set({ budget: Number(e.target.value) })} />
            </div>
            <div>
              <label className="label">Estimated Hours</label>
              <input type="number" className="input" placeholder="0" value={form.estimated_hours} onChange={(e) => set({ estimated_hours: Number(e.target.value) })} />
            </div>
          </>
        )}
        <div>
          <label className="label">Team</label>
          <select className="input" value={String(form.team_id)} onChange={(e) => set({ team_id: e.target.value ? Number(e.target.value) : '' })}>
            <option value="">None</option>
            {teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </div>
        <div>
          <label className="label">Branch</label>
          <select className="input" value={String(form.department_id)} onChange={(e) => set({ department_id: e.target.value ? Number(e.target.value) : '' })}>
            <option value="">None</option>
            {depts.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
        </div>
        {task && (
          <>
            <div>
              <label className="label">Reviewer</label>
              <select className="input" value={String(form.reviewer_id)} onChange={(e) => set({ reviewer_id: e.target.value ? Number(e.target.value) : '' })}>
                <option value="">None</option>
                {users.filter((u) => u.role !== 'user' || form.assignees.includes(u.id)).map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
              </select>
            </div>
            <div>
              <label className="label">Depends On (Task)</label>
              <select className="input" value={String(form.parent_task_id)} onChange={(e) => set({ parent_task_id: e.target.value ? Number(e.target.value) : '' })}>
                <option value="">None</option>
                {allTasks.filter((t) => !task || t.id !== task.id).map((t) => <option key={t.id} value={t.id}>#{t.id} {t.title.slice(0, 40)}</option>)}
              </select>
            </div>
          </>
        )}
      </div>

      <div className="mt-4">
        {selfTask && !task ? (
          <div>
            <label className="label">Assignee</label>
            <span className="chip !bg-brand/15 !border-brand/40 !text-brand !py-1.5 !px-2.5">
              {me ? (users.find((u) => u.id === me.id)?.name || me.name) : 'You'}
            </span>
          </div>
        ) : (
          <div>
            <label className="label">Assignees (multiple)</label>
            <select multiple className="input w-full" value={form.assignees.map(String)} onChange={(e) => {
              const selected = Array.from(e.target.selectedOptions).map((o) => Number(o.value));
              set({ assignees: selected });
            }}>
              {users.map((u) => (
                <option key={u.id} value={u.id}>{u.name}</option>
              ))}
            </select>
            <p className="text-[11px] text-ink3 mt-1">Hold Ctrl/Cmd to select multiple</p>
          </div>
        )}
      </div>

      <div className="mt-4">
        <label className="label">Flags</label>
        <div className="flex flex-wrap gap-1.5">
          {flagSet.map((f) => (
            <button key={f} type="button" onClick={() => toggleInList('flags', f)}
              className={cx('chip !py-1.5 !px-2.5 cursor-pointer transition-all', form.flags.includes(f) && '!bg-amber-500/15 !border-amber-500/40 !text-amber-500')}>
              {form.flags.includes(f) ? <><X size={10} /> {f}</> : <><Plus size={10} /> {f}</>}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-4">
        <label className="label">Tags</label>
        <div className="flex flex-wrap gap-1.5 items-center">
          {form.tags.map((t) => (
            <span key={t} className="chip"><button type="button" onClick={() => toggleInList('tags', t)} className="text-ink3 hover:text-bad"><X size={10} /></button> {t}</span>
          ))}
          <div className="flex gap-1.5">
            <input className="input !w-32 !py-1.5" placeholder="Add tag" value={tagInput} onChange={(e) => setTagInput(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), addTag())} />
            <button type="button" className="btn btn-ghost btn-sm" onClick={addTag}><Plus size={13} /></button>
          </div>
        </div>
      </div>

      {task && (
        <div className="mt-4">
          <label className="label">Checklist</label>
          <div className="space-y-1.5">
            {form.checklist.map((c, i) => (
              <div key={i} className="flex items-center gap-2">
                <span className="chip flex-1">{c}</span>
                <button type="button" className="p-1 text-ink3 hover:text-bad" onClick={() => set({ checklist: form.checklist.filter((_, j) => j !== i) })}><Trash2 size={13} /></button>
              </div>
            ))}
            <div className="flex gap-1.5">
              <input className="input !py-1.5" placeholder="Checklist item" value={newCheck}
                onChange={(e) => setNewCheck(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); if (newCheck.trim()) { set({ checklist: [...form.checklist, newCheck.trim()] }); setNewCheck(''); } } }} />
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => { if (newCheck.trim()) { set({ checklist: [...form.checklist, newCheck.trim()] }); setNewCheck(''); } }}><Plus size={13} /></button>
            </div>
          </div>
        </div>
      )}

      <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-3">
        <Switch checked={form.is_blocked} onChange={(v) => set({ is_blocked: v })} label="Blocked task" />
        <Switch checked={form.is_recurring} onChange={(v) => set({ is_recurring: v })} label="Recurring task" />
        {form.is_recurring && (
          <div className="md:col-span-2">
            <input className="input" placeholder="Recurring rule (e.g. weekly, monthly)" value={form.recurring_rule} onChange={(e) => set({ recurring_rule: e.target.value })} />
          </div>
        )}
      </div>
    </Modal>
  );
}
