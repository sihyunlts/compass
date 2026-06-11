import type { CompassApi } from './shared/contracts/ipc/api';

declare global {
  interface Window {
    compass?: CompassApi;
  }
}

export {};
