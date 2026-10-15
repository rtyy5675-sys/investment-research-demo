export function researchStorageLabels(storage) {
  if (storage?.mode === 'ephemeral') return {
    note: '记录保存在当前服务实例；可在本次访问中跨会话延续。实例休眠、重启或重新部署后，本地记录不保留。',
    conversationSaved: '当前对话已写入当前服务实例',
    memorySaved: '研究进度已写入当前服务实例',
  };
  if (storage?.mode === 'local') return {
    note: '记录保存在本机服务目录，可修改、停用或删除。',
    conversationSaved: '当前对话已保存至本机服务',
    memorySaved: '个人研究记录已更新至本机服务',
  };
  return {
    note: storage?.mode === 'server' ? '记录保存在服务端，保留期限取决于部署存储配置。' : '保存位置与保留期限尚未确认；请稍后刷新服务配置。',
    conversationSaved: '当前对话已保存至服务端',
    memorySaved: '个人研究记录已更新至服务端',
  };
}
