import type { SaveMidiFileRequest } from '../../shared/contracts/ipc/midi';

export const downloadMidiFile = ({ fileName, bytes }: SaveMidiFileRequest): void => {
  const midiFile = Uint8Array.from(bytes);
  const objectUrl = URL.createObjectURL(new Blob([midiFile], { type: 'audio/midi' }));
  const anchor = document.createElement('a');
  anchor.href = objectUrl;
  anchor.download = fileName;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(objectUrl), 0);
};
