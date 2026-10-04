import type { MaxWebApi } from './web-api';

type MaxPacket = { requestId: string } & Record<string, unknown>;
export interface MaxPacketDictionary {
  chunks: string[];
}

// Max symbols are limited to 32767 characters. 8192 UTF-16 code units also
// stay below that limit in UTF-8 (at most 24576 bytes).
// https://docs.cycling74.com/userguide/strings/
const CHUNK_LENGTH = 8192;

const readPacketText = (dictionary: unknown): string => {
  if (!dictionary || typeof dictionary !== 'object' || !('chunks' in dictionary)) {
    throw new Error('Invalid Max transport.');
  }
  // Max can expose a one-element list as a scalar.
  const chunks = typeof dictionary.chunks === 'string' ? [dictionary.chunks] : dictionary.chunks;
  if (!Array.isArray(chunks) || chunks.length === 0 || chunks.some((chunk) => typeof chunk !== 'string')) {
    throw new Error('Invalid Max transport.');
  }
  return chunks.join('');
};

export const readMaxDictionary = (max: MaxWebApi, name: string): Promise<unknown> =>
  new Promise((resolve) => max.getDict(name, resolve));

/** Confirm the complete payload before asking the host to act on it. */
export const writeMaxPacket = async (
  max: MaxWebApi,
  name: string,
  packet: MaxPacketDictionary,
): Promise<void> => {
  max.setDict(name, packet);
  const stored = await readMaxDictionary(max, name);
  if (readPacketText(stored) !== packet.chunks.join('')) {
    throw new Error('Max did not retain the complete request.');
  }
};

// Max Dict does not preserve JSON booleans. Keep the packet opaque so
// transferred values, nulls and arrays reach both JS runtimes without conversion.
// https://docs.cycling74.com/userguide/dictionaries/
export const encodeMaxPacket = (packet: MaxPacket): MaxPacketDictionary => {
  const json = JSON.stringify(packet);
  const chunks: string[] = [];
  for (let start = 0; start < json.length;) {
    let end = Math.min(start + CHUNK_LENGTH, json.length);
    // Keep surrogate pairs together when the host converts each chunk to UTF-8.
    const last = json.charCodeAt(end - 1);
    if (last >= 0xd800 && last <= 0xdbff && end < json.length) end -= 1;
    chunks.push(json.slice(start, end));
    start = end;
  }
  return { chunks };
};

export const decodeMaxPacket = (dictionary: unknown): MaxPacket => {
  const packet: unknown = JSON.parse(readPacketText(dictionary));
  if (!packet || typeof packet !== 'object' || Array.isArray(packet)
    || !('requestId' in packet) || typeof packet.requestId !== 'string') {
    throw new Error('Invalid Max packet.');
  }
  return packet as MaxPacket;
};
