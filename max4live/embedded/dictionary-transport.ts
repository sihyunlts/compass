import type { MaxWebApi } from './web-api';

type MaxPacket = { requestId: string } & Record<string, unknown>;

export const readMaxDictionary = (max: MaxWebApi, name: string): Promise<unknown> =>
  new Promise((resolve) => max.getDict(name, resolve));

/** Confirm the complete payload before asking the host to act on it. */
export const writeMaxPacket = async (
  max: MaxWebApi,
  name: string,
  packet: { json: string },
): Promise<void> => {
  max.setDict(name, packet);
  const stored = await readMaxDictionary(max, name);
  if (!stored || typeof stored !== 'object' || !('json' in stored) || stored.json !== packet.json) {
    throw new Error('Max did not retain the complete request.');
  }
};

// Max Dict does not preserve JSON booleans. Keep the entire packet opaque so
// transferred values, nulls and arrays reach both JS runtimes without conversion.
// https://docs.cycling74.com/userguide/dictionaries/
export const encodeMaxPacket = (packet: MaxPacket): { json: string } => ({
  json: JSON.stringify(packet),
});

export const decodeMaxPacket = (dictionary: unknown): MaxPacket => {
  if (!dictionary || typeof dictionary !== 'object'
    || !('json' in dictionary) || typeof dictionary.json !== 'string') {
    throw new Error('Invalid Max transport.');
  }
  const packet: unknown = JSON.parse(dictionary.json);
  if (!packet || typeof packet !== 'object' || Array.isArray(packet)
    || !('requestId' in packet) || typeof packet.requestId !== 'string') {
    throw new Error('Invalid Max packet.');
  }
  return packet as MaxPacket;
};
