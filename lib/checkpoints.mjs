export function checkpointForResume(task, resume) {
  const checkpoint = task.checkpoint;
  return resume && checkpoint?.operationKey && checkpoint.operationKey === task.lastOperation?.operationKey ? checkpoint : null;
}
