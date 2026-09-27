import { randomUUID } from 'node:crypto';
import { open, rename, unlink } from 'node:fs/promises';
import path from 'node:path';
import { parseSaveMidiFileRequest, type SaveMidiFileResponse } from '../../shared/contracts/ipc/midi';

export type MidiSaveDialogResult = { canceled: boolean; filePath?: string };

/** Both native hosts choose the path in their OS dialog before any file is written. */
export const saveMidiFile = async (
  request: unknown,
  choosePath: (fileName: string) => Promise<MidiSaveDialogResult>,
): Promise<SaveMidiFileResponse> => {
  const parsed = parseSaveMidiFileRequest(request);
  if (!parsed) return { status: 'error', message: 'Invalid MIDI save request.' };
  try {
    const result = await choosePath(parsed.fileName);
    if (result.canceled) return { status: 'canceled' };
    const filePath = result.filePath;
    if (!filePath || !path.isAbsolute(filePath) || !filePath.toLowerCase().endsWith('.mid')) {
      throw new Error('The save dialog did not return an absolute MIDI file path.');
    }
    const temporaryFilePath = path.join(path.dirname(filePath), `.compass-midi-${randomUUID()}.tmp`);
    const file = await open(temporaryFilePath, 'wx', 0o600);
    try {
      try {
        await file.writeFile(Uint8Array.from(parsed.bytes));
      } finally {
        await file.close();
      }
      await rename(temporaryFilePath, filePath);
    } catch (error) {
      // A failed write may leave a partial staging file, but never replace the destination.
      await unlink(temporaryFilePath).catch(() => {});
      throw error;
    }
    return { status: 'saved', filePath };
  } catch (error) {
    return { status: 'error', message: error instanceof Error ? error.message : String(error) };
  }
};
