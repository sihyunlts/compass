import type { BridgeTarget } from './types';

/** Fixed UDP destination used by Compass to send clip-note and tempo-request OSC messages. */
export const LIVE_BRIDGE_TARGET: BridgeTarget = Object.freeze({
  host: '127.0.0.1',
  port: 8970,
  path: '/compass/clip-notes',
});

/** Fixed UDP binding used by Compass to receive Live tempo OSC updates from the M4L bridge. */
export const LIVE_TEMPO_ENDPOINT = Object.freeze({
  host: '127.0.0.1',
  port: 8971,
  address: '/compass/live-tempo',
});

/** Maximum UDP packet payload size used when chunking OSC clip-note messages. */
export const MAX_UDP_PACKET_BYTES = 8 * 1024;
