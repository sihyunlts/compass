export const sanitizeFileStem = (value: string, fallback: string): string => {
  const trimmed = value.trim();
  const sanitized = trimmed
    .replace(/[\\/:*?"<>|\0]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return sanitized || fallback;
};

export const normalizePresetPathSegment = (value: string): string => value.trim();

export const isValidPresetPathSegment = (value: string): boolean => {
  const normalized = normalizePresetPathSegment(value);
  return normalized.length > 0
    && normalized !== '.'
    && normalized !== '..'
    && !/[\\/:*?"<>|\0]/.test(normalized);
};

export const isSafePresetRelativePathSegment = (value: string): boolean =>
  value.length > 0
  && value !== '.'
  && value !== '..'
  && !/[\\/\0]/.test(value);

export const hasPresetExtension = (filePath: string, extension: string): boolean =>
  filePath.toLowerCase().endsWith(extension);

// A dot may be part of the user's name; only the preset suffix is an extension.
export const ensurePresetExtension = (filePath: string, extension: string): string =>
  hasPresetExtension(filePath, extension) ? filePath : `${filePath}${extension}`;
