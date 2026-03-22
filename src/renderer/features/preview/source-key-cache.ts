const getSourceKeyFamily = (sourceKey: string): string | null => {
  const separatorIndex = sourceKey.indexOf(':');
  if (separatorIndex <= 0) {
    return null;
  }

  return sourceKey.slice(0, separatorIndex);
};

/** Tracks the latest source key per family and evicts stale family entries on revision changes. */
export class LatestSourceKeyFamilyCache {
  private readonly latestSourceKeyByFamily = new Map<string, string>();

  public evictStaleEntries(
    sourceKey: string,
    onEvict: (staleSourceKey: string) => void,
  ): void {
    const family = getSourceKeyFamily(sourceKey);
    if (!family) {
      return;
    }

    const previousSourceKey = this.latestSourceKeyByFamily.get(family);
    if (previousSourceKey === sourceKey) {
      return;
    }

    if (previousSourceKey) {
      onEvict(previousSourceKey);
    }

    this.latestSourceKeyByFamily.set(family, sourceKey);
  }

  public reset(): void {
    this.latestSourceKeyByFamily.clear();
  }
}
