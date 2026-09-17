export type PresetOperationErrorCode = 'name-conflict';

/** Domain error identity survives IPC without relying on English message matching. */
export class PresetNameConflictError extends Error {
  public readonly code = 'name-conflict' as const;

  public constructor(options?: ErrorOptions) {
    super('An item or folder with that name already exists.', options);
    this.name = 'PresetNameConflictError';
  }
}
