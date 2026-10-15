// Screenshot acceptance only. The base fixture rejects every unrecognized fetch,
// including arbitrary external hosts. All model and MCP output is synthetic.
import './runtime-fetch-stub.mjs';
import fs from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';

if (process.env.SYSTEM_UI_SAVE_FAILURE === 'true') {
  const originalWrite = fs.writeFile;
  const denied = new Set();
  fs.writeFile = async (path, contents, ...args) => {
    if (String(path).includes('/artifacts/tasks/') && typeof contents === 'string') {
      const snapshot = JSON.parse(contents);
      if (snapshot.input?.includes('[保存失败]') && snapshot.status === 'complete' && !denied.has(snapshot.id)) {
        denied.add(snapshot.id);
        throw Object.assign(new Error('Synthetic ENOSPC for screenshot acceptance'), { code: 'ENOSPC' });
      }
    }
    return originalWrite(path, contents, ...args);
  };
  syncBuiltinESMExports();
}
