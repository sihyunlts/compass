import dgram from 'node:dgram';

import { LIVE_TEMPO_ENDPOINT } from '../../shared/bridge/protocol';
import type { LiveTempoUpdate } from '../../shared/bridge/types';

const OSC_ALIGNMENT = 4;
const TEMPO_EPSILON = 0.001;
const MIN_BPM = 20;
const MAX_BPM = 300;

interface OscStringReadResult {
  value: string;
  nextOffset: number;
}

const reportTempoListenerError = (message: string, error: unknown): void => {
  console.error(`[live-tempo-listener] ${message}`, error);
};

const alignOscOffset = (value: number): number => (value + (OSC_ALIGNMENT - 1)) & ~(OSC_ALIGNMENT - 1);

const readOscString = (
  buffer: Buffer,
  offset: number,
): OscStringReadResult | null => {
  if (offset < 0 || offset >= buffer.length) {
    return null;
  }

  let end = offset;
  while (end < buffer.length && buffer[end] !== 0) {
    end += 1;
  }

  if (end >= buffer.length) {
    return null;
  }

  const value = buffer.toString('utf8', offset, end);
  const nextOffset = alignOscOffset(end + 1);
  if (nextOffset > buffer.length) {
    return null;
  }

  return { value, nextOffset };
};

const parseTempoBpmFromJson = (raw: string): number | null => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return null;
  }

  const event = (parsed as { event?: unknown }).event;
  const bpmValue = (parsed as { bpm?: unknown }).bpm;
  if (event !== 'live_tempo') {
    return null;
  }

  const bpm = Number(bpmValue);
  return Number.isFinite(bpm) ? bpm : null;
};

const parseTempoBpmFromOsc = (buffer: Buffer): number | null => {
  const addressField = readOscString(buffer, 0);
  if (!addressField || addressField.value !== LIVE_TEMPO_ENDPOINT.address) {
    return null;
  }

  const typeField = readOscString(buffer, addressField.nextOffset);
  if (!typeField || typeField.value !== ',s') {
    return null;
  }

  const argumentField = readOscString(buffer, typeField.nextOffset);
  if (!argumentField) {
    return null;
  }

  return parseTempoBpmFromJson(argumentField.value);
};

const normalizeTempoBpm = (rawBpm: number): number =>
  Number(Math.min(MAX_BPM, Math.max(MIN_BPM, rawBpm)).toFixed(3));

/** Listens for Live tempo events from the local M4L UDP bridge. */
export class LiveTempoListener {
  private socket: dgram.Socket | null = null;

  private lastBpm: number | null = null;

  public start(onTempo: (update: LiveTempoUpdate) => void): void {
    if (this.socket) {
      return;
    }

    const socket = dgram.createSocket('udp4');
    socket.on('message', (buffer) => {
      const bpm = parseTempoBpmFromOsc(buffer);
      if (bpm === null) {
        return;
      }

      const normalizedBpm = normalizeTempoBpm(bpm);
      if (
        this.lastBpm !== null
        && Math.abs(this.lastBpm - normalizedBpm) < TEMPO_EPSILON
      ) {
        return;
      }

      this.lastBpm = normalizedBpm;
      onTempo({
        bpm: normalizedBpm,
        receivedAtIso: new Date().toISOString(),
        source: 'm4l-udp',
      });
    });

    socket.on('error', (error) => {
      reportTempoListenerError('UDP socket error', error);
    });

    socket.bind(LIVE_TEMPO_ENDPOINT.port, LIVE_TEMPO_ENDPOINT.host);
    this.socket = socket;
  }

  public stop(): void {
    if (!this.socket) {
      return;
    }

    try {
      this.socket.close();
    } catch (error) {
      reportTempoListenerError('Socket close failed during stop()', error);
    }

    this.socket = null;
    this.lastBpm = null;
  }
}
