interface ParsedVersion {
  major: number;
  minor: number;
  patch: number;
}

export const normalizeVersionText = (version: string): string =>
  version.trim().replace(/^v/i, '');

export const parseStableVersion = (version: string): ParsedVersion | null => {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(normalizeVersionText(version));
  if (!match) {
    return null;
  }

  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
  };
};

export const compareStableVersions = (left: ParsedVersion, right: ParsedVersion): number => {
  if (left.major !== right.major) {
    return left.major - right.major;
  }
  if (left.minor !== right.minor) {
    return left.minor - right.minor;
  }
  return left.patch - right.patch;
};
