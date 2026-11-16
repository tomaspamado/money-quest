// Local persistence. Everything stays in this browser's localStorage; nothing is sent anywhere.
const KEY_DATA = 'mq:data';
const KEY_SAVED = 'mq:saved';

export function emptySaved() {
  return {
    version: 1,
    meta: { firstUploadAt: null, lastUploadAt: null, uploads: 0 },
    challenges: { active: null, history: [] },
    badgeLog: {},          // badgeId -> { at: ISO time it was first seen unlocked }
    prev: null,            // summary of the state before the latest upload
    lastResult: null,      // what the latest upload changed (XP, new badges, challenges)
  };
}

function read(key) {
  try { const s = localStorage.getItem(key); return s ? JSON.parse(s) : null; } catch { return null; }
}
function write(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); return true; } catch { return false; }
}

export const loadData = () => read(KEY_DATA);
export const loadSaved = () => ({ ...emptySaved(), ...(read(KEY_SAVED) || {}) });
export const saveAll = (data, saved) => write(KEY_DATA, data) && write(KEY_SAVED, saved);
export function resetAll() {
  try { localStorage.removeItem(KEY_DATA); localStorage.removeItem(KEY_SAVED); } catch { /* ignore */ }
}
