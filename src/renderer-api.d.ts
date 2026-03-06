import type { CompassApi } from './shared/contracts/ipc';

declare global {
  interface Window {
    compass: CompassApi;
  }
}

export {};
