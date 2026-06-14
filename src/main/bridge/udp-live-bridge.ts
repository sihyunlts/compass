import dgram from 'node:dgram';
import { randomUUID } from 'node:crypto';

import { MAX_UDP_PACKET_BYTES } from '../../shared/bridge/protocol';
import type {
  BridgeTarget,
  LiveBridgeEnvelope,
  LiveBridgeNotesEnvelope,
} from '../../shared/bridge/types';

const OSC_ALIGNMENT = 4;
const DEFAULT_SEND_TIMEOUT_MS = 5000;

const padLength = (value: number): number =>
  (OSC_ALIGNMENT - (value % OSC_ALIGNMENT)) % OSC_ALIGNMENT;

const encodeOscString = (value: string): Buffer => {
  const body = Buffer.from(value, 'utf8');
  const nulTerminatedLength = body.length + 1;
  const padding = padLength(nulTerminatedLength);
  return Buffer.concat([body, Buffer.alloc(1 + padding)]);
};

const toOscPacket = (address: string, argument: string): Buffer =>
  Buffer.concat([
    encodeOscString(address.startsWith('/') ? address : `/${address}`),
    encodeOscString(',s'),
    encodeOscString(argument),
  ]);

const toPacket = (envelope: LiveBridgeEnvelope): Buffer =>
  toOscPacket(
    envelope.path,
    JSON.stringify(envelope),
  );

const splitEnvelopeBySize = (
  envelope: LiveBridgeEnvelope,
): LiveBridgeEnvelope[] => {
  if (envelope.event !== 'clip_notes.replace') {
    return [envelope];
  }

  const firstPacket = toPacket(envelope);
  if (firstPacket.byteLength <= MAX_UDP_PACKET_BYTES) {
    return [envelope];
  }

  const baseEnvelope: Omit<LiveBridgeNotesEnvelope, 'notes' | 'applyMode'> = {
    event: envelope.event,
    source: envelope.source,
    layout: envelope.layout,
    path: envelope.path,
    targetLengthBeats: envelope.targetLengthBeats,
    autoCreateLengthBeats: envelope.autoCreateLengthBeats,
  };

  const chunks: LiveBridgeNotesEnvelope[] = [];
  let currentNotes: LiveBridgeNotesEnvelope['notes'] = [];
  const chunkTransferId = randomUUID();

  const toChunkEnvelope = (
    notes: LiveBridgeNotesEnvelope['notes'],
  ): LiveBridgeNotesEnvelope => ({
    ...baseEnvelope,
    applyMode: 'replace',
    chunkTransferId,
    chunkIndex: chunks.length,
    chunkCount: 9999,
    notes,
  });

  const flushChunk = (): void => {
    if (currentNotes.length === 0) {
      return;
    }

    chunks.push(toChunkEnvelope(currentNotes));
    currentNotes = [];
  };

  for (const note of envelope.notes) {
    const candidateNotes = [...currentNotes, note];
    const candidateEnvelope = toChunkEnvelope(candidateNotes);

    if (toPacket(candidateEnvelope).byteLength <= MAX_UDP_PACKET_BYTES) {
      currentNotes = candidateNotes;
      continue;
    }

    if (currentNotes.length === 0) {
      throw new Error(
        'single-note payload exceeds UDP packet size limit; reduce metadata size',
      );
    }

    flushChunk();
    currentNotes = [note];
  }

  flushChunk();
  return chunks.map((chunk, chunkIndex) => ({
    ...chunk,
    chunkIndex,
    chunkCount: chunks.length,
  }));
};

/** Sends OSC payloads to the Live bridge over UDP, splitting large note payloads for transport. */
export class UdpLiveBridge {
  public constructor(private readonly sendTimeoutMs = DEFAULT_SEND_TIMEOUT_MS) {}

  public async send(
    envelope: LiveBridgeEnvelope,
    target: BridgeTarget,
  ): Promise<void> {
    const envelopes = splitEnvelopeBySize(envelope);
    const packets = envelopes.map((chunkEnvelope) => toPacket(chunkEnvelope));

    await new Promise<void>((resolve, reject) => {
      const socket = dgram.createSocket('udp4');
      let settled = false;
      let timeout: ReturnType<typeof setTimeout> | null = null;

      const finish = (error?: Error): void => {
        if (settled) {
          return;
        }

        settled = true;
        if (timeout) {
          clearTimeout(timeout);
          timeout = null;
        }
        socket.close();
        if (error) {
          reject(error);
          return;
        }

        resolve();
      };

      timeout = setTimeout(() => {
        finish(new Error('Live bridge UDP send timed out'));
      }, this.sendTimeoutMs);

      socket.once('error', (error) => {
        finish(error);
      });

      let packetIndex = 0;
      const sendNext = (): void => {
        if (packetIndex >= packets.length) {
          finish();
          return;
        }

        socket.send(
          packets[packetIndex],
          target.port,
          target.host,
          (error) => {
            if (settled) {
              return;
            }

            if (error) {
              finish(error);
              return;
            }

            packetIndex += 1;
            sendNext();
          },
        );
      };

      sendNext();
    });
  }
}
