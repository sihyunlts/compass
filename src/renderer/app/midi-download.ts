import type { GeneratorPreview } from '../../shared/contracts/preview/generator-preview';
import {
  normalizeCustomName,
  type ClipNote,
} from '../../shared/model';

const MIDI_TICKS_PER_BEAT = 480;
const MIDI_FILE_EXTENSION = '.mid';
const DEFAULT_MIDI_NAME = 'Compass Lightshow';
const MAX_MIDI_DATA_VALUE = 0x7f;
const MAX_MIDI_CHANNEL = 16;

interface MidiEvent {
  tick: number;
  order: number;
  bytes: readonly number[];
}

interface DownloadGeneratedPreviewOptions {
  preview: GeneratorPreview;
  clipName: string;
}

const toUint16Bytes = (value: number): number[] => [
  (value >>> 8) & 0xff,
  value & 0xff,
];

const toUint32Bytes = (value: number): number[] => [
  (value >>> 24) & 0xff,
  (value >>> 16) & 0xff,
  (value >>> 8) & 0xff,
  value & 0xff,
];

const toVariableLengthBytes = (value: number): number[] => {
  let remaining = Math.max(0, Math.round(value));
  const bytes = [remaining & MAX_MIDI_DATA_VALUE];
  remaining >>>= 7;

  while (remaining > 0) {
    bytes.unshift((remaining & MAX_MIDI_DATA_VALUE) | 0x80);
    remaining >>>= 7;
  }

  return bytes;
};

const toMidiDataValue = (value: number): number =>
  Math.max(0, Math.min(MAX_MIDI_DATA_VALUE, Math.round(value)));

const toMidiChannelIndex = (channel: number): number =>
  Math.max(1, Math.min(MAX_MIDI_CHANNEL, Math.round(channel))) - 1;

const toMidiTick = (beat: number): number =>
  Math.max(0, Math.round(beat * MIDI_TICKS_PER_BEAT));

const resolveMidiName = (clipName: string): string =>
  normalizeCustomName(clipName) ?? DEFAULT_MIDI_NAME;

const toNoteEvents = (note: ClipNote, trackEndTick: number): MidiEvent[] => {
  const startTick = toMidiTick(note.startBeat);
  if (startTick >= trackEndTick) {
    return [];
  }

  const endTick = Math.min(
    trackEndTick,
    Math.max(startTick + 1, toMidiTick(note.startBeat + note.durationBeats)),
  );
  const pitch = toMidiDataValue(note.pitch);
  const channelIndex = toMidiChannelIndex(note.channel);

  return [
    {
      tick: startTick,
      order: 1,
      bytes: [0x90 | channelIndex, pitch, toMidiDataValue(note.velocity)],
    },
    {
      tick: endTick,
      order: 0,
      bytes: [0x80 | channelIndex, pitch, 0],
    },
  ];
};

const createTrackBytes = (
  preview: GeneratorPreview,
  clipName: string,
): number[] => {
  const trackEndTick = toMidiTick(preview.sourceTimelineEndBeat);
  const trackNameBytes = [...new TextEncoder().encode(resolveMidiName(clipName))];
  const events = preview.notes
    .flatMap((note) => toNoteEvents(note, trackEndTick))
    .sort((left, right) =>
      left.tick - right.tick
      || left.order - right.order
      || left.bytes[0] - right.bytes[0]
      || left.bytes[1] - right.bytes[1]);
  const trackBytes = [
    0,
    0xff,
    0x03,
    ...toVariableLengthBytes(trackNameBytes.length),
    ...trackNameBytes,
  ];
  let previousTick = 0;

  for (const event of events) {
    trackBytes.push(
      ...toVariableLengthBytes(event.tick - previousTick),
      ...event.bytes,
    );
    previousTick = event.tick;
  }

  trackBytes.push(
    ...toVariableLengthBytes(trackEndTick - previousTick),
    0xff,
    0x2f,
    0,
  );
  return trackBytes;
};

const encodeGeneratedPreviewMidi = (
  preview: GeneratorPreview,
  clipName: string,
): Uint8Array<ArrayBuffer> => {
  const trackBytes = createTrackBytes(preview, clipName);
  return new Uint8Array([
    0x4d, 0x54, 0x68, 0x64,
    ...toUint32Bytes(6),
    ...toUint16Bytes(0),
    ...toUint16Bytes(1),
    ...toUint16Bytes(MIDI_TICKS_PER_BEAT),
    0x4d, 0x54, 0x72, 0x6b,
    ...toUint32Bytes(trackBytes.length),
    ...trackBytes,
  ]);
};

const toMidiFileName = (clipName: string): string => {
  const fileStem = [...resolveMidiName(clipName)]
    .map((character) => character.charCodeAt(0) < 0x20 ? ' ' : character)
    .join('')
    .replace(/[\\/:*?"<>|]+/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/[.\s]+$/g, '')
    .trim()
    || DEFAULT_MIDI_NAME;
  return fileStem.toLowerCase().endsWith(MIDI_FILE_EXTENSION)
    ? fileStem
    : `${fileStem}${MIDI_FILE_EXTENSION}`;
};

export const downloadGeneratedPreviewMidi = ({
  preview,
  clipName,
}: DownloadGeneratedPreviewOptions): void => {
  const midiFile = encodeGeneratedPreviewMidi(preview, clipName);
  const objectUrl = URL.createObjectURL(new Blob([midiFile], { type: 'audio/midi' }));
  const anchor = document.createElement('a');
  anchor.href = objectUrl;
  anchor.download = toMidiFileName(clipName);
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(objectUrl), 0);
};
