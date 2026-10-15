import { mkdir, writeFile, rename } from 'node:fs/promises';
import { join } from 'node:path';

export function createTaskStore(directory, { write = async (id, snapshot) => { await mkdir(directory, { recursive: true }); const temp = join(directory, `${id}.tmp`); await writeFile(temp, snapshot); await rename(temp, join(directory, `${id}.json`)); } } = {}) {
  const pending = new Map();
  return {
    save(task) {
      const version = task.stateVersion = (task.stateVersion || 0) + 1;
      const savedAt = new Date().toISOString();
      task.storage = { status: 'saving', version };
      const snapshot = JSON.stringify({ ...task, storage: { status: 'saved', version, savedAt } }, null, 2);
      const saving = (pending.get(task.id) || Promise.resolve()).catch(() => {}).then(() => write(task.id, snapshot)).then(() => {
        if (task.storage?.version === version) task.storage = { status: 'saved', version, savedAt };
      }).catch(cause => {
        if ((task.storage?.version || 0) <= version) {
          task.stateVersion++; task.storage = { status: 'error', version: task.stateVersion, message: '当前服务保存失败，当前内容仍在内存中；请重试保存，暂勿关闭服务。', occurredAt: new Date().toISOString() };
        }
        throw Object.assign(new Error('当前服务保存失败，请重试保存。'), { code: 'STORAGE_ERROR', category: 'storage_error', retryable: true, status: 503, cause });
      });
      pending.set(task.id, saving);
      // Register a rejection handler immediately; callers still receive the rejected promise.
      void saving.catch(() => {});
      void saving.finally(() => { if (pending.get(task.id) === saving) pending.delete(task.id); }).catch(() => {});
      return saving;
    },
  };
}
