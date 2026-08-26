export interface HardwareMidiOutput {
  id: string;
  name: string;
}

export type HardwareMidiError =
  | 'unsupported'
  | 'access-denied'
  | 'output-open-failed'
  | 'output-disconnected'
  | 'output-failed';

export interface HardwareMidiOutputState {
  outputs: HardwareMidiOutput[];
  selectedOutputId: string | null;
  isAccessing: boolean;
  error: HardwareMidiError | null;
}
