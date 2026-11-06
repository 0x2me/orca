export const WORKER_THREAD_ENTRY_NAMES = [
  'image-parser-worker-entry',
  'stt-worker',
  'warp-theme-parser-worker',
  'foreign-sqlite-reader-entry',
  'main-thread-hang-watchdog-entry',
  'port-scan-command-worker-entry',
  'command-path-directory-worker-entry',
  'worker-thread-child-process-entry',
  ...(['usage-scan', 'workspace-space-scan'] as const).map((n) => `${n}-worker-entry` as const),
  'claude-profile-setup-worker-entry',
  ...(['backup', 'writer'] as const).map((kind) => `profile-state-${kind}-worker-entry` as const),
  'plugin-source-transpile-worker-entry'
] as const
