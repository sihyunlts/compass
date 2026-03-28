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

  public getLatestSourceKey(sourceKey: string): string | null {
    const family = getSourceKeyFamily(sourceKey);
    if (!family) {
      return null;
    }

    return this.latestSourceKeyByFamily.get(family) ?? null;
  }

  public replaceLatestSourceKey(sourceKey: string): string | null {
    const family = getSourceKeyFamily(sourceKey);
    if (!family) {
      return null;
    }

    const previousSourceKey = this.latestSourceKeyByFamily.get(family) ?? null;
    this.latestSourceKeyByFamily.set(family, sourceKey);
    return previousSourceKey !== sourceKey ? previousSourceKey : null;
  }

  public evictStaleEntries(
    sourceKey: string,
    onEvict: (staleSourceKey: string) => void,
  ): void {
    const previousSourceKey = this.replaceLatestSourceKey(sourceKey);
    if (!previousSourceKey) {
      return;
    }

    onEvict(previousSourceKey);
  }

  public reset(): void {
    this.latestSourceKeyByFamily.clear();
  }
}
