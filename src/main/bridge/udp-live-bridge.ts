import dgram from 'node:dgram';
import { randomUUID } from 'node:crypto';

import { MAX_UDP_PACKET_BYTES } from '../../shared/bridge/protocol';
import type {
  BridgeTarget,
  LiveBridgeEnvelope,
  LiveBridgeNotesEnvelope,
  LiveBridgeTransferReply,
} from '../../shared/bridge/types';

const OSC_ALIGNMENT = 4;
const DEFAULT_ACK_TIMEOUT_MS = 1000;
const MAX_ATTEMPTS = 8;
const TRANSFER_LIFETIME_MS = 120_000;

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

  envelope = {
    ...envelope,
    chunkTransferId: randomUUID(),
    transferExpiresAt: Date.now() + TRANSFER_LIFETIME_MS,
    chunkIndex: 0,
    chunkCount: 1,
  };
  const firstPacket = toPacket(envelope);
  if (firstPacket.byteLength <= MAX_UDP_PACKET_BYTES) {
    return [envelope];
  }

  const baseEnvelope: Omit<LiveBridgeNotesEnvelope, 'notes' | 'applyMode'> = {
    chunkTransferId: envelope.chunkTransferId,
    transferExpiresAt: envelope.transferExpiresAt,
    event: envelope.event,
    source: envelope.source,
    layout: envelope.layout,
    path: envelope.path,
    targetLengthBeats: envelope.targetLengthBeats,
    autoCreateLengthBeats: envelope.autoCreateLengthBeats,
    clipName: envelope.clipName,
  };

  const chunks: LiveBridgeNotesEnvelope[] = [];
  let currentNotes: LiveBridgeNotesEnvelope['notes'] = [];

  const toChunkEnvelope = (
    notes: LiveBridgeNotesEnvelope['notes'],
  ): LiveBridgeNotesEnvelope => ({
    ...baseEnvelope,
    applyMode: 'replace',
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

/** Sends one chunk at a time; only Live's applied acknowledgement completes a note transfer. */
export class UdpLiveBridge {
  private receiveReply: ((reply: LiveBridgeTransferReply) => void) | null = null;

  public constructor(private readonly ackTimeoutMs = DEFAULT_ACK_TIMEOUT_MS) {}

  public acceptTransferReply(reply: LiveBridgeTransferReply): void {
    this.receiveReply?.(reply);
  }

  public async send(envelope: LiveBridgeEnvelope, target: BridgeTarget): Promise<void> {
    if (envelope.event === 'clip_notes.replace' && this.receiveReply) {
      throw new Error('A Live clip transfer is already in progress.');
    }
    const envelopes = splitEnvelopeBySize(envelope);
    const packets = envelopes.map(toPacket);
    const transferId = envelopes[0].event === 'clip_notes.replace'
      ? envelopes[0].chunkTransferId : undefined;
    const probe = transferId ? toPacket({
      event: 'clip_transfer.probe', source: envelope.source, layout: envelope.layout,
      path: envelope.path, chunkTransferId: transferId,
    }) : null;

    await new Promise<void>((resolve, reject) => {
      const socket = dgram.createSocket('udp4');
      let settled = false;
      let timer: ReturnType<typeof setTimeout> | undefined;
      let packetIndex = probe ? -1 : 0;
      let attempts = 0;
      const deadline = envelopes[0].event === 'clip_notes.replace'
        ? envelopes[0].transferExpiresAt! : Date.now() + TRANSFER_LIFETIME_MS;

      const finish = (error?: Error): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (transferId) this.receiveReply = null;
        socket.close();
        if (error) reject(error);
        else resolve();
      };

      const sendCurrent = (): void => {
        clearTimeout(timer);
        if (++attempts > MAX_ATTEMPTS || Date.now() >= deadline) {
          finish(new Error(packetIndex === -1
            ? 'The updated Compass Bridge did not respond. Load the matching bridge device in Live.'
            : 'Live bridge did not confirm completion. Check that the updated Compass Bridge is loaded. '
            + 'The clip may already have been applied; check Live before sending again.',
          ));
          return;
        }
        const sentIndex = packetIndex;
        timer = setTimeout(sendCurrent, this.ackTimeoutMs
          * (transferId && packetIndex === packets.length - 1 ? 5 : 1));
        socket.send(sentIndex === -1 ? probe! : packets[sentIndex], target.port, target.host, (error) => {
          if (settled) return;
          if (error) finish(error);
          else if (!transferId) finish();
        });
      };

      if (transferId) {
        this.receiveReply = (reply) => {
          if (reply.transferId !== transferId || settled) return;
          if (reply.state === 'error') {
            finish(new Error(reply.message || 'Live could not apply the clip.'));
          } else if (reply.state === 'ready' && packetIndex === -1) {
            packetIndex = 0;
            attempts = 0;
            sendCurrent();
          } else if (reply.state === 'applied' && packetIndex === packets.length - 1) {
            finish();
          } else if (reply.state === 'received' && packetIndex >= 0 && reply.chunkIndex === packetIndex
            && packetIndex < packets.length - 1) {
            packetIndex += 1;
            attempts = 0;
            sendCurrent();
          }
        };
      }
      socket.once('error', finish);
      sendCurrent();
    });
  }
}
