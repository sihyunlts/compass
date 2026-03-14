const HASH_TOKEN_PATTERN = /#+/g;
export const DEFAULT_GROUP_NAME_TEMPLATE = 'Group #';

export const normalizeCustomName = (value: unknown): string | null => {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  return trimmed ? trimmed : null;
};

export const hasNameIndexToken = (value: string): boolean => value.includes('#');

export const applyNameIndex = (value: string, index: number): string =>
  value.replace(HASH_TOKEN_PATTERN, `${index}`);
