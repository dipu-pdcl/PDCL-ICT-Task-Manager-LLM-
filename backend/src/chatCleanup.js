import { db } from './db.js';

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;
const CHECK_INTERVAL_MS = 60 * 60 * 1000; // Run every hour

function deleteOldMessages() {
  try {
    const cutoff = new Date(Date.now() - THIRTY_DAYS_MS);
    const cutoffStr = cutoff.toISOString().replace('T', ' ').substring(0, 19);
    const result = db.prepare('DELETE FROM chat_messages WHERE updated_at < ?').run(cutoffStr);
    if (result.changes > 0) {
      console.log(`[ChatCleanup] Deleted ${result.changes} chat messages older than 30 days`);
    }
    return result.changes;
  } catch (err) {
    console.error('[ChatCleanup] Error cleaning up old chat messages:', err);
    return 0;
  }
}

let intervalHandle = null;

export function startChatCleanup() {
  // Run once on startup
  deleteOldMessages();
  // Then run periodically
  intervalHandle = setInterval(deleteOldMessages, CHECK_INTERVAL_MS);
  intervalHandle.unref?.();
  console.log('[ChatCleanup] Scheduled chat message cleanup (older than 30 days) every hour');
}

export function stopChatCleanup() {
  if (intervalHandle) {
    clearInterval(intervalHandle);
    intervalHandle = null;
  }
}

export { deleteOldMessages };
