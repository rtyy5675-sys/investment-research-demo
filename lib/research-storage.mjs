// Public deployment metadata only; never expose paths or credentials.
export function researchStorageInfo(env = process.env) {
  const mode = env.RESEARCH_STORAGE_MODE === 'ephemeral' || env.RENDER === 'true'
    ? 'ephemeral'
    : env.RESEARCH_STORAGE_MODE === 'server' || env.NODE_ENV === 'production' ? 'server' : 'local';
  return { mode };
}
