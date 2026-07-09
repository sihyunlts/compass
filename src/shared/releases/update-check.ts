import type { UpdateCheckResponse } from '../contracts/ipc/releases';
import {
  compareStableVersions,
  normalizeVersionText,
  parseStableVersion,
} from './version';

export const resolveUpdateCheckResponse = (
  currentVersion: string,
  latestVersion: string,
): UpdateCheckResponse => {
  const normalizedCurrentVersion = normalizeVersionText(currentVersion);
  const normalizedLatestVersion = normalizeVersionText(latestVersion);
  const currentParsed = parseStableVersion(normalizedCurrentVersion);
  const latestParsed = parseStableVersion(normalizedLatestVersion);
  if (!currentParsed || !latestParsed) {
    return {
      status: 'unavailable',
      currentVersion: normalizedCurrentVersion,
      message: 'Release version format is not recognized.',
    };
  }

  if (compareStableVersions(latestParsed, currentParsed) > 0) {
    return {
      status: 'available',
      currentVersion: normalizedCurrentVersion,
      latestVersion: normalizedLatestVersion,
    };
  }

  return {
    status: 'up-to-date',
    currentVersion: normalizedCurrentVersion,
    latestVersion: normalizedLatestVersion,
  };
};
