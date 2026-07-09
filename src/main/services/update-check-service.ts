import { app, shell } from 'electron';

import type { UpdateCheckResponse } from '../../shared/contracts/ipc/releases';
import {
  GITHUB_API_VERSION,
  GITHUB_LATEST_RELEASE_URL,
  GITHUB_RELEASES_API_URL,
  type GitHubReleaseResponse,
} from '../../shared/releases/github';
import { resolveUpdateCheckResponse } from '../../shared/releases/update-check';

const toErrorMessage = (error: unknown): string => {
  if (error instanceof Error && error.message.trim()) {
    return error.message.trim();
  }

  return 'Update check failed.';
};

export class UpdateCheckService {
  public async checkForUpdates(): Promise<UpdateCheckResponse> {
    const currentVersion = app.getVersion();

    try {
      const latestReleaseTag = await this.fetchLatestStableReleaseTag();
      return resolveUpdateCheckResponse(currentVersion, latestReleaseTag);
    } catch (error) {
      return {
        status: 'unavailable',
        currentVersion,
        message: toErrorMessage(error),
      };
    }
  }

  public async openLatestReleasePage(): Promise<void> {
    await shell.openExternal(GITHUB_LATEST_RELEASE_URL);
  }

  private async fetchLatestStableReleaseTag(): Promise<string> {
    const response = await fetch(GITHUB_RELEASES_API_URL, {
      headers: {
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': GITHUB_API_VERSION,
      },
    });

    if (!response.ok) {
      throw new Error(`GitHub returned ${response.status}.`);
    }

    const release = await response.json() as GitHubReleaseResponse;
    if (release.draft === true || release.prerelease === true) {
      throw new Error('Latest release is not a stable release.');
    }
    if (typeof release.tag_name !== 'string' || !release.tag_name.trim()) {
      throw new Error('Latest release tag is missing.');
    }

    return release.tag_name;
  }
}
