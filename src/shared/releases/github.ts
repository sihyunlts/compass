export const GITHUB_RELEASES_API_URL =
  'https://api.github.com/repos/sihyunlts/compass/releases/latest';
export const GITHUB_LATEST_RELEASE_URL =
  'https://github.com/sihyunlts/compass/releases/latest';
export const GITHUB_API_VERSION = '2026-03-10';

export interface GitHubReleaseResponse {
  tag_name?: unknown;
  draft?: unknown;
  prerelease?: unknown;
}
