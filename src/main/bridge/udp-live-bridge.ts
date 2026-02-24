import dgram from 'node:dgram';

import { MAX_UDP_PACKET_BYTES } from '../../shared/bridge-protocol';
import type {
  BridgeTarget,
  LiveBridgeEnvelope,
  LiveBridgeNotesEnvelope,
} from '../../shared/types';

const OSC_ALIGNMENT = 4;

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

  const flushChunk = (): void => {
    if (currentNotes.length === 0) {
      return;
    }

    chunks.push({
      ...baseEnvelope,
      applyMode: chunks.length === 0 ? 'replace' : 'append',
      notes: currentNotes,
    });
    currentNotes = [];
  };

  for (const note of envelope.notes) {
    const candidateNotes = [...currentNotes, note];
    const candidateEnvelope: LiveBridgeNotesEnvelope = {
      ...baseEnvelope,
      applyMode: chunks.length === 0 ? 'replace' : 'append',
      notes: candidateNotes,
    };

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
  return chunks;
};

/** Sends OSC payloads to the Live bridge over UDP with replace-then-append chunking. */
export class UdpLiveBridge {
  public async send(
    envelope: LiveBridgeEnvelope,
    target: BridgeTarget,
  ): Promise<void> {
    const envelopes = splitEnvelopeBySize(envelope);
    const packets = envelopes.map((chunkEnvelope) => toPacket(chunkEnvelope));

    await new Promise<void>((resolve, reject) => {
      const socket = dgram.createSocket('udp4');

      socket.once('error', (error) => {
        socket.close();
        reject(error);
      });

      let packetIndex = 0;
      const sendNext = (): void => {
        if (packetIndex >= packets.length) {
          socket.close();
          resolve();
          return;
        }

        socket.send(
          packets[packetIndex],
          target.port,
          target.host,
          (error) => {
            if (error) {
              socket.close();
              reject(error);
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
