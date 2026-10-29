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

// Records live until the sender's deadline; expired packets cannot start again.
var clipTransfers = {};
var activeClipTransferId = "";
var lastClipApplyError = "";

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

    if (envelope.event === "clip_transfer.probe") {
      if (envelope.path !== expectedOscPath) return;
      sendClipTransferReply({ id: envelope.chunkTransferId, state: "ready" }, -1);
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
    if (envelope) {
      var transfer = clipTransfers[envelope.chunkTransferId];
      transfer.state = "applying";
      lastClipApplyError = "";
      try {
        applyClipNotesEnvelope(envelope, function (success, message) {
          finishClipTransfer(transfer, success ? "applied" : "error",
            success ? "" : lastClipApplyError || message);
        });
      } catch (e) {
        finishClipTransfer(transfer, "error", safeErrorMessage(e));
      }
    }
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

function sendClipTransferReply(transfer, chunkIndex) {
  outlet(2, STATUS_OSC_PATH, JSON.stringify({
    event: "clip_transfer",
    transferId: transfer.id,
    state: transfer.state === "receiving" || transfer.state === "applying"
      ? "received" : transfer.state,
    chunkIndex: chunkIndex,
    message: transfer.message || "",
  }));
}

function finishClipTransfer(transfer, state, message) {
  transfer.state = state;
  transfer.message = message;
  transfer.notesByIndex = [];
  if (activeClipTransferId === transfer.id) activeClipTransferId = "";
  sendClipTransferReply(transfer, transfer.count - 1);
}

function expireClipTransfers() {
  var now = nowMs();
  for (var id in clipTransfers) {
    if (!Object.prototype.hasOwnProperty.call(clipTransfers, id)) continue;
    var transfer = clipTransfers[id];
    if (now >= transfer.expiresAt) {
      if (activeClipTransferId === id) activeClipTransferId = "";
      delete clipTransfers[id];
    } else if (transfer.state === "receiving" && now - transfer.lastReceivedAt > 15000) {
      finishClipTransfer(transfer, "error", "Clip transfer stopped before all chunks arrived");
    }
  }
}

function collectChunkedClipNotesEnvelope(envelope) {
  expireClipTransfers();
  var id = envelope.chunkTransferId;
  var count = envelope.chunkCount;
  var index = envelope.chunkIndex;
  var expiresAt = envelope.transferExpiresAt;
  // A deadline also prevents late packets from reapplying an evicted transfer.
  if (typeof id !== "string" || !/^[0-9a-f-]{36}$/.test(id)
    || typeof count !== "number" || !isFinite(count) || count < 1 || count !== Math.floor(count)
    || typeof index !== "number" || index < 0 || index >= count || index !== Math.floor(index)
    || typeof expiresAt !== "number" || !isFinite(expiresAt)
    || expiresAt <= nowMs() || expiresAt > nowMs() + 125000
    || !(envelope.notes instanceof Array)) {
    errorOut("invalid_transfer", "Use matching updated Compass and Compass Bridge versions");
    return null;
  }
  var transfer = clipTransfers[id];
  if (!transfer) {
    transfer = {
      id: id, count: count, expiresAt: expiresAt, state: "receiving",
      notesByIndex: [], received: 0, lastReceivedAt: nowMs(),
      clipName: envelope.clipName, targetLengthBeats: envelope.targetLengthBeats,
      autoCreateLengthBeats: envelope.autoCreateLengthBeats,
    };
    clipTransfers[id] = transfer;
    if (activeClipTransferId) {
      finishClipTransfer(transfer, "error", "Another clip transfer is in progress");
      return null;
    }
    activeClipTransferId = id;
  }
  if (transfer.state !== "receiving") {
    sendClipTransferReply(transfer, index);
    return null;
  }
  if (transfer.count !== count || transfer.expiresAt !== expiresAt
    || transfer.clipName !== envelope.clipName
    || transfer.targetLengthBeats !== envelope.targetLengthBeats
    || transfer.autoCreateLengthBeats !== envelope.autoCreateLengthBeats) {
    finishClipTransfer(transfer, "error", "Clip transfer metadata changed");
    return null;
  }
  transfer.lastReceivedAt = nowMs();
  if (!(transfer.notesByIndex[index] instanceof Array)) {
    transfer.notesByIndex[index] = envelope.notes;
    transfer.received++;
  }
  sendClipTransferReply(transfer, index);
  if (transfer.received < count) return null;
  var notes = [];
  for (var i = 0; i < count; i++) {
    var chunkNotes = transfer.notesByIndex[i];
    for (var j = 0; j < chunkNotes.length; j++) notes.push(chunkNotes[j]);
  }
  envelope.notes = notes;
  transfer.notesByIndex = [];
  status("chunk_assembled", "chunks", count, "notes", notes.length);
  return envelope;
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
  expireClipTransfers();
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
  lastClipApplyError = msg;
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
