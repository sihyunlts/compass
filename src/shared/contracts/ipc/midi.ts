export interface SaveMidiFileRequest {
  fileName: string;
  bytes: number[];
}

export type SaveMidiFileResponse =
  | { status: 'saved'; filePath: string }
  | { status: 'downloaded' }
  | { status: 'canceled' }
  | { status: 'error'; message: string };

/** Only a filename and a complete single-track MIDI file cross the host boundary. */
export const parseSaveMidiFileRequest = (value: unknown): SaveMidiFileRequest | null => {
  if (!value || typeof value !== 'object') return null;
  const { fileName, bytes } = value as Partial<SaveMidiFileRequest>;
  if (typeof fileName !== 'string' || !fileName.trim()
    || [...fileName].some((character) => character.charCodeAt(0) < 0x20)
    || /[\\/:*?"<>|]/.test(fileName) || !fileName.toLowerCase().endsWith('.mid')
    || !Array.isArray(bytes) || bytes.length < 26
    || !bytes.every((byte) => Number.isInteger(byte) && byte >= 0 && byte <= 255)) return null;
  // Header fields occupy 22 bytes; validating them needs no copy of the track.
  const data = new DataView(Uint8Array.from(bytes.slice(0, 22)).buffer);
  if (data.getUint32(0) !== 0x4d546864 || data.getUint32(4) !== 6
    || data.getUint16(8) !== 0 || data.getUint16(10) !== 1 || data.getUint16(12) !== 480
    || data.getUint32(14) !== 0x4d54726b || data.getUint32(18) !== bytes.length - 22) return null;
  return { fileName, bytes };
};
