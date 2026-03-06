type MessageKind = 'note' | 'cc';
type ButtonZone = 'grid' | 'left' | 'right' | 'top' | 'bottom' | 'logo';

export type LaunchpadModel = 'mk3' | 'mk2';

export interface MidiAddress {
  kind: MessageKind;
  number: number;
  channel: number;
}

export interface LaunchpadButton {
  id: string;
  zone: ButtonZone;
  x: number;
  y: number;
  output: MidiAddress;
}
