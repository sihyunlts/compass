export interface BridgeSettings {
  autoCreateLengthBeats: number;
}

export interface BridgeTarget {
  host: string;
  port: number;
  path: string;
}

export interface LiveTempoUpdate {
  bpm: number;
  receivedAtIso: string;
  source: 'm4l-udp';
}

interface LiveBridgeBaseEnvelope {
  source: 'compass';
  layout: 'drum-rack';
  path: string;
}

export interface LiveBridgeNotesEnvelope extends LiveBridgeBaseEnvelope {
  event: 'clip_notes.replace';
  applyMode?: 'replace';
  chunkTransferId?: string;
  chunkIndex?: number;
  chunkCount?: number;
  targetLengthBeats?: number;
  autoCreateLengthBeats?: number;
  notes: Array<{
    pitch: number;
    channel: number;
    startBeat: number;
    durationBeats: number;
    velocity: number;
    mute: boolean;
  }>;
}

export interface LiveBridgeTempoRequestEnvelope extends LiveBridgeBaseEnvelope {
  event: 'live_tempo.request';
}

export type LiveBridgeEnvelope =
  | LiveBridgeNotesEnvelope
  | LiveBridgeTempoRequestEnvelope;
