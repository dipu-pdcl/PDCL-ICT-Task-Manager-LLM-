import { useNavigate } from 'react-router-dom';
import { CalendarDays, Paperclip, MessageSquare, ListChecks, Flag, Clock } from 'lucide-react';
import type { Task } from '../lib/types';
import { useSettings } from '../lib/settings';
import { statusById, priorityById, difficultyById, fmtDate, isOverdue, cx } from '../lib/utils';
import { Avatar, Badge } from './ui';

export function TaskCard({ task, compact }: { task: Task; compact?: boolean }) {
  const settings = useSettings();
  const navigate = useNavigate();
  const st = statusById(settings, task.status);
  const pr = priorityById(settings, task.priority);
  const diff = difficultyById(settings, task.difficulty);
  const overdue = isOverdue(task);

  return (
    <div
      className="card card-hover p-3.5 cursor-pointer anim-in group"
      onClick={() => navigate(`/tasks/${task.id}`)}
    >
      <div className="flex items-start gap-2 mb-2">
        <Badge color={st.color} dot>{st.name}</Badge>
        <span className="ml-auto flex items-center gap-1 text-[11px] font-semibold" style={{ color: pr.color }}>
          <Flag size={11} /> {pr.name}
        </span>
      </div>
      <h4 className={cx('font-semibold leading-snug group-hover:text-brand transition-colors', compact ? 'text-sm' : 'text-[15px]')}>
        {task.title}
      </h4>
      {!compact && task.tags.length > 0 && (
        <div className="flex flex-wrap gap-1 mt-2">
          {task.tags.slice(0, 4).map((t) => <span key={t} className="chip">{t}</span>)}
        </div>
      )}
      <div className="flex items-center justify-between mt-3">
        <div className="flex -space-x-1.5">
          {(task.assignees || []).slice(0, 4).map((a) => (
            <span key={a.user_id} title={a.user_name}><Avatar name={a.user_name} src={a.avatar} size={24} /></span>
          ))}
          {(task.assignees || []).length > 4 && (
            <span className="w-6 h-6 rounded-full bg-card2 border border-line text-[10px] font-bold flex items-center justify-center text-ink2">
              +{(task.assignees || []).length - 4}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2 text-ink3 text-[11px]">
          {task.due_date && (
            <span className={cx('flex items-center gap-1', overdue && 'text-bad font-semibold')}>
              <CalendarDays size={12} /> {fmtDate(task.due_date)}
            </span>
          )}
          {task.comments_count ? <span className="flex items-center gap-0.5"><MessageSquare size={12} />{task.comments_count}</span> : null}
          {task.attachments_count ? <span className="flex items-center gap-0.5"><Paperclip size={12} />{task.attachments_count}</span> : null}
          {task.checklist && task.checklist.total > 0 && (
            <span className="flex items-center gap-0.5"><ListChecks size={12} />{task.checklist.done}/{task.checklist.total}</span>
          )}
        </div>
      </div>
      {!compact && (
        <div className="mt-3">
          <div className="flex items-center justify-between text-[11px] text-ink3 mb-1">
            <span>Progress</span><span className="font-semibold text-ink2">{task.progress}%</span>
          </div>
          <div className="progress-bar"><div style={{ width: `${task.progress}%` }} /></div>
        </div>
      )}
    </div>
  );
}
