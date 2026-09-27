/**
 * Bridges Compass OSC envelopes with Live clip and tempo operations in Max for Live.
 * Minimum supported: Ableton Live 10 + Max 8.
 */

autowatch = 1;

inlets = 1;
outlets = 3;

var DEFAULT_INCOMING_OSC_PATH = "/compass/clip-notes";
var TEMPO_OSC_PATH = "/compass/live-tempo";
var STATUS_OSC_PATH = "/compass/bridge-status";
var BRIDGE_VERSION = "v1.1.0";

var TEMPO_POLL_INTERVAL_MS = 250;
var expectedOscPath = DEFAULT_INCOMING_OSC_PATH;

var pendingChunkTransferId = "";
var pendingChunkCount = 0;
var pendingChunkNotesByIndex = [];
var pendingChunkReceived = 0;

var lastSentTempo = null;
var tempoPollTask = null;

function set_path(path) {
  expectedOscPath = path || DEFAULT_INCOMING_OSC_PATH;
  status("set_path", expectedOscPath);
}

function bang() {
  status("ready", BRIDGE_VERSION, "path", expectedOscPath);
}

function loadbang() {
  ensureTempoPolling();
}

function list() {
  handleIncomingTokens(arrayfromargs(arguments));
}

function anything() {
  handleIncomingTokens([messagename].concat(arrayfromargs(arguments)));
}

function handleIncomingTokens(tokens) {
  try {
    ensureTempoPolling();

    var payloadText = decodeIncomingPayload(tokens);
    if (!payloadText) {
      return;
    }

    var envelope = parseJsonEnvelope(payloadText);
    if (envelope === undefined) {
      return;
    }
    if (!envelope || !envelope.event) {
      errorOut("invalid_envelope", "missing_event");
      return;
    }

    if (envelope.event === "live_tempo.request") {
      handleTempoRequest(envelope);
      return;
    }

    if (envelope.event !== "clip_notes.replace") {
      status("ignored_event", envelope.event);
      return;
    }

    if (envelope.path && expectedOscPath && envelope.path !== expectedOscPath) {
      status("ignored_path", envelope.path);
      return;
    }

    envelope = collectChunkedClipNotesEnvelope(envelope);
    if (envelope) applyClipNotesEnvelope(envelope);
  } catch (e) {
    errorOut("handleIncomingTokens", safeErrorMessage(e));
  }
}

function decodeIncomingPayload(tokens) {
  if (!tokens || tokens.length === 0) {
    return null;
  }

  // Support common udpreceive token shapes and recover the JSON payload.
  var t0 = tokens[0];
  var t1 = tokens.length > 1 ? tokens[1] : null;

  if (t0 === "list" || t0 === "symbol") {
    tokens = tokens.slice(1);
    t0 = tokens[0];
    t1 = tokens.length > 1 ? tokens[1] : null;
  }

  if (typeof t0 === "string" && t0.charAt(0) === "/") {
    return typeof t1 === "string" ? t1 : null;
  }

  if (typeof t0 === "string" && (t0.charAt(0) === "{" || t0.charAt(0) === "[")) {
    return t0;
  }

  var joined = tokens.join(" ");
  if (joined && (joined.charAt(0) === "{" || joined.charAt(0) === "[")) {
    return joined;
  }

  return null;
}

function parseJsonEnvelope(payloadText) {
  try {
    return JSON.parse(payloadText);
  } catch (e) {
    errorOut("parse_error", safeErrorMessage(e));
    return undefined;
  }
}

function collectChunkedClipNotesEnvelope(envelope) {
  // Live 10's legacy note sequence is replace-based, so transport chunks must be
  // reassembled before writing notes to avoid later chunks replacing earlier ones.
  var chunkCount = Math.floor(toNumber(envelope.chunkCount, 1));
  if (!isFinite(chunkCount) || chunkCount <= 1) {
    return envelope;
  }

  var chunkIndex = Math.floor(toNumber(envelope.chunkIndex, -1));
  var transferId =
    typeof envelope.chunkTransferId === "string" ? envelope.chunkTransferId : "";
  if (!transferId || !isFinite(chunkIndex) || chunkIndex < 0 || chunkIndex >= chunkCount) {
    resetPendingChunkTransfer();
    errorOut("invalid_chunk", chunkIndex, "count", chunkCount);
    return null;
  }

  if (pendingChunkTransferId !== transferId) {
    pendingChunkTransferId = transferId;
    pendingChunkCount = chunkCount;
    pendingChunkNotesByIndex = [];
    pendingChunkReceived = 0;
  }

  if (pendingChunkCount !== chunkCount) {
    resetPendingChunkTransfer();
    errorOut("chunk_count_changed", transferId);
    return null;
  }

  if (!(pendingChunkNotesByIndex[chunkIndex] instanceof Array)) {
    pendingChunkReceived += 1;
  }
  pendingChunkNotesByIndex[chunkIndex] = envelope.notes ? envelope.notes.slice(0) : [];

  if (pendingChunkReceived < pendingChunkCount) {
    status("chunk_received", chunkIndex + 1, "of", pendingChunkCount);
    return null;
  }

  var notes = [];
  for (var i = 0; i < pendingChunkCount; i++) {
    var chunkNotes = pendingChunkNotesByIndex[i];
    if (!(chunkNotes instanceof Array)) {
      resetPendingChunkTransfer();
      errorOut("missing_chunk", transferId, i);
      return null;
    }

    for (var j = 0; j < chunkNotes.length; j++) {
      notes.push(chunkNotes[j]);
    }
  }

  envelope.notes = notes;
  resetPendingChunkTransfer();
  status("chunk_assembled", "chunks", chunkCount, "notes", notes.length);
  return envelope;
}

function resetPendingChunkTransfer() {
  pendingChunkTransferId = "";
  pendingChunkCount = 0;
  pendingChunkNotesByIndex = [];
  pendingChunkReceived = 0;
}

function handleTempoRequest(envelope) {
  if (envelope.path && expectedOscPath && envelope.path !== expectedOscPath) {
    status("ignored_path", envelope.path);
    return;
  }

  ensureTempoPolling();
  sendTempoUpdate(true);
  status("tempo_requested");
}

function ensureTempoPolling() {
  if (tempoPollTask) {
    return;
  }
  if (typeof Task !== "function") {
    return;
  }

  tempoPollTask = new Task(pollTempoTaskTick, this);
  tempoPollTask.interval = TEMPO_POLL_INTERVAL_MS;
  tempoPollTask.repeat();

  sendTempoUpdate(true);
}

function pollTempoTaskTick() {
  try {
    sendTempoUpdate(false);
  } catch (_e) {}
}

function sendTempoUpdate(forceSend) {
  var song = getLiveSetApi();
  if (!song) {
    return;
  }
  var tempo = toNumber(song.get("tempo"), null);
  if (!isFinite(tempo) || tempo <= 0) {
    return;
  }

  // Quantize and gate updates to avoid redundant tempo messages.
  var normalized = Math.round(tempo * 1000) / 1000;
  if (!forceSend && lastSentTempo !== null && Math.abs(normalized - lastSentTempo) < 0.01) {
    return;
  }

  lastSentTempo = normalized;
  outlet(2, TEMPO_OSC_PATH, JSON.stringify({ event: "live_tempo", bpm: normalized }));
}

function status() {
  var args = arrayfromargs(arguments);
  outlet(0, args);
  emitBridgeStatus("status", args);
}

function errorOut(code, message) {
  var msg = code + ": " + message;
  outlet(0, "error", msg);
  outlet(1, "error", msg);
  emitBridgeStatus("error", [msg]);
}

function emitBridgeStatus(level, args) {
  try {
    outlet(2, STATUS_OSC_PATH, JSON.stringify({
      event: "bridge_status",
      level: level,
      message: argsToStatusMessage(args),
      args: args,
    }));
  } catch (_e) {}
}

function argsToStatusMessage(args) {
  if (!args || !args.length) {
    return "";
  }
  var out = [];
  for (var i = 0; i < args.length; i++) {
    out.push(String(args[i]));
  }
  return out.join(" ");
}
