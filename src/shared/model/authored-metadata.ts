export const AUTHORED_METADATA_AUTHOR_MAX_LENGTH = 100;
export const AUTHORED_METADATA_DESCRIPTION_MAX_LENGTH = 1000;

export interface AuthoredMetadata {
  author?: string;
  description?: string;
}

const normalizeMetadataText = (
  value: unknown,
  maxLength: number,
): string | undefined => {
  if (typeof value !== 'string') {
    return undefined;
  }

  const normalized = value.trim().slice(0, maxLength);
  return normalized || undefined;
};

export const normalizeAuthoredMetadata = (
  value: unknown,
): AuthoredMetadata | undefined => {
  if (typeof value !== 'object' || value === null) {
    return undefined;
  }

  const source = value as Record<string, unknown>;
  const author = normalizeMetadataText(
    source.author,
    AUTHORED_METADATA_AUTHOR_MAX_LENGTH,
  );
  const description = normalizeMetadataText(
    source.description,
    AUTHORED_METADATA_DESCRIPTION_MAX_LENGTH,
  );

  return author || description
    ? {
        ...(author ? { author } : {}),
        ...(description ? { description } : {}),
      }
    : undefined;
};

export const cloneAuthoredMetadata = (
  value: AuthoredMetadata | undefined,
): AuthoredMetadata | undefined => normalizeAuthoredMetadata(value);

export const replaceAuthoredMetadata = <T extends { metadata?: AuthoredMetadata }>(
  value: T,
  metadata: AuthoredMetadata | undefined,
): T => {
  const next = { ...value };
  const normalized = normalizeAuthoredMetadata(metadata);
  if (normalized) {
    next.metadata = normalized;
  } else {
    delete next.metadata;
  }
  return next;
};
