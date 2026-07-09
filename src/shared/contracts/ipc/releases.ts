export type UpdateCheckResponse =
  | {
      status: 'available';
      currentVersion: string;
      latestVersion: string;
    }
  | {
      status: 'up-to-date';
      currentVersion: string;
      latestVersion: string;
    }
  | {
      status: 'unavailable';
      currentVersion: string;
      message: string;
    };
