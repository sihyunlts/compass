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
var BRIDGE_VERSION = "v1.0.1";

var TEMPO_POLL_INTERVAL_MS = 250;
var CREATE_MIDI_CLIP_SUPPORT_UNKNOWN = -1;
var CREATE_MIDI_CLIP_SUPPORT_NO = 0;
var CREATE_MIDI_CLIP_SUPPORT_YES = 1;

// Retry LiveAPI root resolution to avoid noisy failures during device boot.
var LIVEAPI_RESOLVE_RETRY_MS = 1000;
var LIVE10_DETAIL_CLIP_RETRY_MS = 120;

var MIN_CLIP_LENGTH_BEATS = 0.25;
var DEFAULT_AUTO_CREATE_LENGTH_BEATS = 4.0;

var expectedOscPath = DEFAULT_INCOMING_OSC_PATH;

var pendingChunkTransferId = "";
var pendingChunkCount = 0;
var pendingChunkNotesByIndex = [];
var pendingChunkReceived = 0;

var lastSentTempo = null;
var tempoPollTask = null;
var selectionRetryTask = null;
var createMidiClipSupport = CREATE_MIDI_CLIP_SUPPORT_UNKNOWN;

// Cache root LiveAPI objects after the first successful resolve.
var liveSetApi = null;
var liveSetViewApi = null;
var liveAppApi = null;
var liveMajorVersion = null;
var lastLiveSetResolveAttemptMs = 0;
var lastViewResolveAttemptMs = 0;
var lastLiveAppResolveAttemptMs = 0;

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

    applyClipNotesEnvelope(envelope);
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

function applyClipNotesEnvelope(envelope) {
  envelope = collectChunkedClipNotesEnvelope(envelope);
  if (!envelope) {
    return;
  }

  if (!envelope.notes || !envelope.notes.length) {
    status("empty_notes");
    return;
  }

  var normalized = normalizeNotes(envelope.notes);
  if (!normalized.notes.length) {
    status("empty_notes");
    return;
  }
  var requiredClipLength = resolveRequiredClipLength(envelope, normalized);
  var shouldRetrySelection = shouldUseLegacyNoteApi();

  applyResolvedClipNotes(
    normalized.notes,
    requiredClipLength,
    shouldRetrySelection
  );
}

function applyResolvedClipNotes(notes, requiredClipLength, shouldRetrySelection) {
  var target = resolveSelectedMidiClipTarget();
  if (target) {
    applyNotesToSelectedTarget(target, notes, requiredClipLength);
    return;
  }

  if (shouldRetrySelection) {
    deferApplyResolvedClipNotes(notes, requiredClipLength);
    return;
  }

  applyNotesToNewArrangementClipOnSelectedTrack(
    notes,
    requiredClipLength
  );
}

function deferApplyResolvedClipNotes(notes, requiredClipLength) {
  if (typeof Task !== "function") {
    applyResolvedClipNotes(notes, requiredClipLength, false);
    return;
  }

  if (selectionRetryTask) {
    try {
      selectionRetryTask.cancel();
    } catch (_e) {}
    selectionRetryTask = null;
  }

  selectionRetryTask = new Task(function () {
    selectionRetryTask = null;
    applyResolvedClipNotes(notes, requiredClipLength, false);
  }, this);
  selectionRetryTask.schedule(LIVE10_DETAIL_CLIP_RETRY_MS);
  status("selection_retry_scheduled", LIVE10_DETAIL_CLIP_RETRY_MS);
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

function applyNotesToSelectedClip(targetClip, notes, sourceLength) {
  var clipLength = readClipLengthBeats(targetClip, sourceLength);
  applyNotesToClip(targetClip, notes, sourceLength, clipLength);
}

function applyNotesToClip(targetClip, notes, sourceLength, clipLength) {
  var fittedNotes = fitNotesToClipLength(notes, sourceLength, clipLength);

  replaceClipNotes(targetClip, fittedNotes, clipLength);
  status("applied", "replace", "notes", fittedNotes.length);
}

function normalizeNotes(notes) {
  var out = [];
  var maxEnd = 0.0;

  for (var i = 0; i < notes.length; i++) {
    var n = notes[i];
    if (!n) {
      continue;
    }

    var rawPitch = toNumber(n.pitch, NaN);
    var rawStart = toNumber(n.startBeat, NaN);
    var rawDur = toNumber(n.durationBeats, NaN);
    if (
      !isFinite(rawPitch) ||
      !isFinite(rawStart) ||
      !isFinite(rawDur) ||
      rawPitch < 0 ||
      rawPitch > 127 ||
      rawStart < 0 ||
      rawDur <= 0
    ) {
      continue;
    }

    var pitch = clampInt(rawPitch, 0, 127);
    var start = rawStart;
    var dur = rawDur;
    var velocity = clampInt(toNumber(n.velocity, 100), 1, 127);
    var mute = n.mute ? 1 : 0;

    out.push({
      pitch: pitch,
      start_time: start,
      duration: dur,
      velocity: velocity,
      mute: mute,
    });

    maxEnd = Math.max(maxEnd, start + dur);
  }

  return {
    notes: out,
    maxEnd: Math.max(maxEnd, MIN_CLIP_LENGTH_BEATS),
  };
}

function resolveRequiredClipLength(envelope, normalized) {
  var autoCreateLength = toNumber(envelope.autoCreateLengthBeats, NaN);
  var targetLength = toNumber(envelope.targetLengthBeats, NaN);
  var length = isFinite(autoCreateLength) && autoCreateLength > 0
    ? autoCreateLength
    : targetLength;
  if (!isFinite(length) || length <= 0) {
    length = normalized.maxEnd;
  }

  return Math.max(
    roundBeat(Math.max(length, normalized.maxEnd, MIN_CLIP_LENGTH_BEATS)),
    MIN_CLIP_LENGTH_BEATS
  );
}

function fitNotesToClipLength(notes, sourceLength, clipLength) {
  var out = [];
  var src = Math.max(sourceLength, MIN_CLIP_LENGTH_BEATS);
  var dst = Math.max(clipLength, MIN_CLIP_LENGTH_BEATS);
  var scale = dst / src;
  if (!isFinite(scale) || scale <= 0) {
    scale = 1.0;
  }

  for (var i = 0; i < notes.length; i++) {
    var n = notes[i];
    var start = n.start_time * scale;
    var dur = n.duration * scale;

    if (start >= dst) {
      continue;
    }

    var end = Math.min(start + dur, dst);
    var clampedDur = Math.max(end - start, 1e-6);

    out.push({
      pitch: n.pitch,
      start_time: start,
      duration: clampedDur,
      velocity: n.velocity,
      mute: n.mute,
    });
  }

  return out;
}

function replaceClipNotes(clipApi, notes, clipLength) {
  var live11Error = null;

  if (!shouldUseLegacyNoteApi()) {
    try {
      clearClipNotesExtended(clipApi, clipLength);
      addNewNotesToClip(clipApi, notes);
      return;
    } catch (e1) {
      live11Error = e1;
    }
  }

  try {
    replaceSelectedNotesLegacy(clipApi, notes);
    return;
  } catch (e2) {
    throw new Error(
      "replace notes failed: live11=" +
        safeErrorMessage(live11Error) +
        " legacy=" +
        safeErrorMessage(e2)
    );
  }
}

function clearClipNotesExtended(clipApi, clipLength) {
  clipApi.call("remove_notes_extended", 0, 128, 0, clipLength);
}

function addNewNotesToClip(clipApi, notes) {
  // Max usually accepts objects here; keep JSON fallback for compatibility edges.
  var payload = { notes: notes };

  try {
    clipApi.call("add_new_notes", payload);
    return;
  } catch (e1) {
    try {
      clipApi.call("add_new_notes", JSON.stringify(payload));
      return;
    } catch (e2) {
      throw new Error(
        "add_new_notes failed: object=" + safeErrorMessage(e1) + " json=" + safeErrorMessage(e2)
      );
    }
  }
}

function replaceSelectedNotesLegacy(clipApi, notes) {
  clipApi.call("select_all_notes");
  writeSelectedNotesLegacy(clipApi, notes);
}

function writeSelectedNotesLegacy(clipApi, notes) {
  status("legacy_note_sequence", "replace_selected_notes", "notes", notes.length);
  clipApi.call("replace_selected_notes");
  clipApi.call("notes", notes.length);

  for (var i = 0; i < notes.length; i++) {
    var n = notes[i];
    clipApi.call(
      "note",
      n.pitch,
      legacyBeatArg(n.start_time),
      legacyBeatArg(n.duration),
      n.velocity,
      n.mute ? 1 : 0
    );
  }

  clipApi.call("done");
}

function legacyBeatArg(value) {
  var n = toNumber(value, 0);
  if (!isFinite(n) || n <= 0) {
    return "0.0";
  }
  return n.toFixed(4);
}

function shouldUseLegacyNoteApi() {
  var major = getLiveMajorVersion();
  return major > 0 && major < 11;
}

function resolveSelectedMidiClipTarget() {
  var view = getLiveSetViewApi();
  if (!view) {
    return null;
  }

  var detailId = readLiveId(view.get("detail_clip"));
  var detailClip = resolveMidiClipById(detailId);
  if (detailClip) {
    status("target", "detail_clip", detailId);
    return {
      mode: "direct",
      clip: detailClip,
      clipId: detailId,
    };
  }

  if (detailId > 0) {
    if (shouldUseLegacyNoteApi()) {
      try {
        // In Live 10 the selected Arrangement clip can fail MIDI checks when
        // opened by id, but the detail_clip path still accepts legacy note calls.
        var legacyDetailClip = new LiveAPI("live_set view detail_clip");
        status("target", "legacy_detail_clip", detailId);
        return {
          mode: "direct",
          clip: legacyDetailClip,
          clipId: detailId,
        };
      } catch (e) {
        status("legacy_detail_clip_unresolved", detailId, safeErrorMessage(e));
        return {
          mode: "unusable_live10_detail_clip",
          clip: null,
          clipId: detailId,
        };
      }
    }

    status("detail_clip_not_midi", detailId);
    return null;
  }

  if (!shouldUseLegacyNoteApi()) {
    return null;
  }
  return null;
}

function applyNotesToSelectedTarget(target, notes, sourceLength) {
  if (target.mode === "unusable_live10_detail_clip") {
    errorOut(
      "live10_detail_clip_unavailable",
      "Live 10 detail_clip was present but its LiveAPI path could not be resolved"
    );
    return;
  }

  applyNotesToSelectedClip(target.clip, notes, sourceLength);
}

function resolveMidiClipById(clipId) {
  if (clipId <= 0) {
    return null;
  }

  try {
    var clip = new LiveAPI("id " + clipId);
    return isMidiClip(clip) ? clip : null;
  } catch (_e) {
    return null;
  }
}

function applyNotesToNewArrangementClipOnSelectedTrack(
  notes,
  requiredClipLength
) {
  var view = getLiveSetViewApi();
  if (!view) {
    return;
  }
  var trackId = readLiveId(view.get("selected_track"));
  if (!trackId) {
    errorOut("no_selected_track", "Select a MIDI track in Live");
    return;
  }

  var track = new LiveAPI("id " + trackId);
  if (!isMidiTrack(track)) {
    errorOut("selected_track_not_midi", trackId);
    return;
  }

  var song = getLiveSetApi();
  if (!song) {
    return;
  }
  var startTime = roundBeat(Math.max(0.0, toNumber(song.get("current_song_time"), 0.0)));
  var length = roundBeat(Math.max(requiredClipLength, MIN_CLIP_LENGTH_BEATS));

  if (!canResolveArrangementClips()) {
    // Live 10 cannot resolve newly-created Arrangement clip ids reliably, but it
    // can duplicate a populated Session clip into the Arrangement.
    applyNotesToSessionClipThenDuplicate(track, startTime, length, notes);
    return;
  }

  var createdId = tryCreateArrangementClip(track, startTime, length);

  if (!createdId) {
    applyNotesToSessionClipThenDuplicate(track, startTime, length, notes);
    return;
  }

  var clip = new LiveAPI("id " + createdId);
  if (!isMidiClip(clip)) {
    errorOut("created_clip_not_midi", createdId);
    return;
  }

  // Keep clip loop and marker boundaries aligned to the generated length.
  safeSetClipMarkers(clip, length);

  status("target", "created_arrangement_clip", createdId);
  applyNotesToClip(clip, notes, length, length);
}

function applyNotesToSessionClipThenDuplicate(trackApi, startTime, length, notes) {
  var temp = createSessionClipOnTrack(trackApi, length);
  if (!temp) {
    return;
  }

  try {
    applyNotesToClip(temp.clip, notes, length, length);
  } catch (e1) {
    safeDeleteClipInSlot(temp.slot);
    errorOut("write_session_clip_failed", safeErrorMessage(e1));
    return;
  }

  try {
    trackApi.call("duplicate_clip_to_arrangement", "id " + temp.clipId, startTime);
  } catch (e2) {
    safeDeleteClipInSlot(temp.slot);
    errorOut("duplicate_clip_to_arrangement_failed", safeErrorMessage(e2));
    return;
  }

  safeDeleteClipInSlot(temp.slot);
  status("target", "created_arrangement_clip_from_session");
}

function createSessionClipOnTrack(trackApi, length) {
  var slotIndex = findEmptyClipSlotIndex(trackApi);
  if (slotIndex < 0) {
    errorOut("no_empty_clip_slot", "No empty clip slot found on selected track");
    return null;
  }

  var slot = new LiveAPI(trackApi.unquotedpath + " clip_slots " + slotIndex);
  var clipId = 0;
  try {
    slot.call("create_clip", length);
    clipId = readLiveId(slot.get("clip"));
  } catch (e) {
    errorOut("create_session_clip_failed", safeErrorMessage(e));
    return null;
  }

  if (!clipId) {
    errorOut("temp_clip_missing", "create_clip did not yield a clip id");
    return null;
  }

  var clip = new LiveAPI("id " + clipId);
  safeSetClipMarkers(clip, length);

  return {
    slot: slot,
    clip: clip,
    clipId: clipId,
  };
}

function tryCreateArrangementClip(trackApi, startTime, length) {
  var before = readArrangementClipIds(trackApi);

  if (tryCallCreateMidiClip(trackApi, startTime, length)) {
    var created = resolveNewArrangementClipId(trackApi, before, startTime);
    if (created) {
      status("created_arrangement_clip_direct", created);
      return created;
    }
  }

  return 0;
}

function tryCallCreateMidiClip(trackApi, startTime, length) {
  if (createMidiClipSupport === CREATE_MIDI_CLIP_SUPPORT_NO) {
    return false;
  }

  try {
    trackApi.call("create_midi_clip", startTime, length);
    createMidiClipSupport = CREATE_MIDI_CLIP_SUPPORT_YES;
    return true;
  } catch (e) {
    var message = safeErrorMessage(e);
    if (isCreateMidiClipUnsupportedError(message)) {
      createMidiClipSupport = CREATE_MIDI_CLIP_SUPPORT_NO;
      return false;
    }
    status("create_midi_clip_failed", message);
    return false;
  }
}

function isCreateMidiClipUnsupportedError(message) {
  if (!message) {
    return false;
  }
  var lower = String(message).toLowerCase();
  return (
    lower.indexOf("no attribute") >= 0 ||
    lower.indexOf("unknown function") >= 0 ||
    lower.indexOf("doesn't understand") >= 0 ||
    lower.indexOf("does not understand") >= 0
  );
}

function resolveNewArrangementClipId(trackApi, beforeIds, startTime) {
  var afterIds = readArrangementClipIds(trackApi);
  var newIds = diffIds(afterIds, beforeIds);
  if (!newIds.length) {
    return 0;
  }
  return pickClipByStartTime(trackApi, newIds, startTime);
}

function pickClipByStartTime(trackApi, ids, startTime) {
  var epsilon = 0.01;
  var bestId = 0;
  var bestDelta = Infinity;

  for (var i = 0; i < ids.length; i++) {
    var id = ids[i];
    if (!id) {
      continue;
    }

    var clip;
    try {
      clip = new LiveAPI("id " + id);
    } catch (e) {
      continue;
    }

    if (!isMidiClip(clip)) {
      continue;
    }

    var clipStart = toNumber(clip.get("start_time"), null);
    if (!isFinite(clipStart)) {
      continue;
    }

    var delta = Math.abs(clipStart - startTime);
    if (delta < bestDelta) {
      bestDelta = delta;
      bestId = id;
    }

    if (delta <= epsilon) {
      return id;
    }
  }

  return bestId;
}

function canResolveArrangementClips() {
  var major = getLiveMajorVersion();
  return major >= 11;
}

function readArrangementClipIds(trackApi) {
  // Prefer direct property read, then fallback to indexed lookup.
  try {
    var raw = trackApi.get("arrangement_clips");
    var ids = readLiveIds(raw);
    if (ids.length) {
      return ids;
    }
  } catch (_e) {}

  var out = [];
  try {
    var count = trackApi.getcount("arrangement_clips");
    for (var i = 0; i < count; i++) {
      var clip = new LiveAPI(trackApi.unquotedpath + " arrangement_clips " + i);
      if (clip && clip.id) {
        var idNum = readLiveId(["id", clip.id]);
        if (idNum) {
          out.push(idNum);
        }
      }
    }
  } catch (e2) {}
  return out;
}

function findEmptyClipSlotIndex(trackApi) {
  var count = 0;
  try {
    count = trackApi.getcount("clip_slots");
  } catch (e) {
    return -1;
  }

  for (var i = 0; i < count; i++) {
    try {
      var slot = new LiveAPI(trackApi.unquotedpath + " clip_slots " + i);
      var hasClip = toNumber(slot.get("has_clip"), 0);
      if (!hasClip) {
        return i;
      }
    } catch (_e) {
    }
  }

  return -1;
}

function safeDeleteClipInSlot(slotApi) {
  try {
    slotApi.call("delete_clip");
  } catch (_e) {}
}

function safeSetClipMarkers(clipApi, length) {
  try {
    clipApi.set("loop_start", 0);
    clipApi.set("start_marker", 0);
    clipApi.set("loop_end", length);
    clipApi.set("end_marker", length);
  } catch (_e) {}
}

function isMidiTrack(trackApi) {
  // has_midi_input is available only on regular tracks.
  try {
    return !!toNumber(trackApi.get("has_midi_input"), 0);
  } catch (e) {
    return false;
  }
}

function isMidiClip(clipApi) {
  try {
    return !!toNumber(clipApi.get("is_midi_clip"), 0);
  } catch (e) {
    return false;
  }
}

function readClipLengthBeats(clipApi, fallbackLength) {
  var length = toNumber(clipApi.get("length"), fallbackLength);
  if (!isFinite(length) || length <= 0) {
    length = fallbackLength;
  }
  return Math.max(length, MIN_CLIP_LENGTH_BEATS);
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

function nowMs() {
  return new Date().getTime();
}

function safeErrorMessage(e) {
  try {
    if (!e) {
      return "unknown";
    }
    if (typeof e === "string") {
      return e;
    }
    if (e.message) {
      return String(e.message);
    }
    return String(e);
  } catch (_e) {
    return "unknown";
  }
}

function clampInt(v, min, max) {
  var n = Math.round(v);
  if (!isFinite(n)) {
    n = min;
  }
  if (n < min) {
    return min;
  }
  if (n > max) {
    return max;
  }
  return n;
}

function toNumber(v, fallback) {
  if (v === null || v === undefined) {
    return fallback;
  }

  if (typeof v === "number") {
    return v;
  }

  if (typeof v === "string") {
    // Some Live Object Model values arrive as fractions like "1/4".
    var m = v.match(/^\s*(\d+)\s*\/\s*(\d+)\s*$/);
    if (m) {
      var a = parseFloat(m[1]);
      var b = parseFloat(m[2]);
      if (isFinite(a) && isFinite(b) && b !== 0) {
        return (a / b) * 4;
      }
    }
    var f = parseFloat(v);
    return isNaN(f) ? fallback : f;
  }

  // LiveAPI may return [value] or [propertyName, value] arrays for scalar properties.
  if (v instanceof Array) {
    for (var i = 0; i < v.length; i++) {
      var candidate = toNumber(v[i], null);
      if (typeof candidate === "number" && isFinite(candidate)) {
        return candidate;
      }
    }
    return fallback;
  }

  return fallback;
}

function readLiveId(v) {
  // Accept id payloads from numeric, string, and tokenized LiveAPI forms.
  if (v === null || v === undefined) {
    return 0;
  }

  if (typeof v === "number") {
    return v;
  }

  if (typeof v === "string") {
    var m = v.match(/id\s+(\d+)/);
    return m ? parseInt(m[1], 10) : 0;
  }

  if (v instanceof Array) {
    for (var i = 0; i < v.length - 1; i++) {
      if (v[i] === "id") {
        return parseInt(v[i + 1], 10) || 0;
      }
    }
  }

  return 0;
}

function readLiveIds(v) {
  var ids = [];
  if (!v) {
    return ids;
  }

  if (typeof v === "string") {
    var parts = v.split(/\s+/);
    for (var i = 0; i < parts.length - 1; i++) {
      if (parts[i] === "id") {
        var n = parseInt(parts[i + 1], 10);
        if (n) {
          ids.push(n);
        }
      }
    }
    return ids;
  }

  if (v instanceof Array) {
    for (var j = 0; j < v.length - 1; j++) {
      if (v[j] === "id") {
        var nn = parseInt(v[j + 1], 10);
        if (nn) {
          ids.push(nn);
        }
      }
    }
  }

  return ids;
}

function diffIds(afterIds, beforeIds) {
  var beforeSet = {};
  for (var i = 0; i < beforeIds.length; i++) {
    beforeSet[String(beforeIds[i])] = 1;
  }

  var out = [];
  for (var j = 0; j < afterIds.length; j++) {
    var id = afterIds[j];
    if (!beforeSet[String(id)]) {
      out.push(id);
    }
  }
  return out;
}



function liveApiId(api) {
  try {
    if (!api) {
      return 0;
    }
    var id = api.id;
    if (id === null || id === undefined) {
      return 0;
    }
    if (typeof id === "number") {
      return id;
    }
    var n = parseInt(String(id), 10);
    return isFinite(n) ? n : 0;
  } catch (_e) {
    return 0;
  }
}

function isLiveApiValid(api) {
  return liveApiId(api) > 0;
}

function getLiveSetApi() {
  if (typeof LiveAPI !== "function") {
    return null;
  }

  if (isLiveApiValid(liveSetApi)) {
    return liveSetApi;
  }

  var now = nowMs();
  if (liveSetApi && now - lastLiveSetResolveAttemptMs < LIVEAPI_RESOLVE_RETRY_MS) {
    return null;
  }
  lastLiveSetResolveAttemptMs = now;

  try {
    liveSetApi = new LiveAPI("live_set");
  } catch (_e2) {
    liveSetApi = null;
    return null;
  }

  return isLiveApiValid(liveSetApi) ? liveSetApi : null;
}

function getLiveSetViewApi() {
  if (typeof LiveAPI !== "function") {
    return null;
  }

  if (isLiveApiValid(liveSetViewApi)) {
    return liveSetViewApi;
  }

  var now = nowMs();
  if (liveSetViewApi && now - lastViewResolveAttemptMs < LIVEAPI_RESOLVE_RETRY_MS) {
    return null;
  }
  lastViewResolveAttemptMs = now;

  try {
    liveSetViewApi = new LiveAPI("live_set view");
  } catch (_e3) {
    liveSetViewApi = null;
    return null;
  }

  return isLiveApiValid(liveSetViewApi) ? liveSetViewApi : null;
}

function getLiveAppApi() {
  if (typeof LiveAPI !== "function") {
    return null;
  }

  if (liveAppApi) {
    return liveAppApi;
  }

  var now = nowMs();
  if (lastLiveAppResolveAttemptMs && now - lastLiveAppResolveAttemptMs < LIVEAPI_RESOLVE_RETRY_MS) {
    return null;
  }
  lastLiveAppResolveAttemptMs = now;

  try {
    liveAppApi = new LiveAPI("live_app");
  } catch (_e4) {
    liveAppApi = null;
    return null;
  }

  return liveAppApi;
}

function getLiveMajorVersion() {
  if (liveMajorVersion !== null) {
    return liveMajorVersion;
  }

  var app = getLiveAppApi();
  if (!app) {
    return 0;
  }

  try {
    var major = firstFiniteNumber(app.call("get_major_version"), 0);
    if (major > 0) {
      liveMajorVersion = major;
    }
    return major;
  } catch (_e5) {
    return 0;
  }
}

function firstFiniteNumber(v, fallback) {
  var direct = toNumber(v, null);
  if (typeof direct === "number" && isFinite(direct)) {
    return direct;
  }

  if (v instanceof Array) {
    for (var i = 0; i < v.length; i++) {
      var candidate = firstFiniteNumber(v[i], null);
      if (typeof candidate === "number" && isFinite(candidate)) {
        return candidate;
      }
    }
  }

  return fallback;
}

function roundBeat(v) {
  return Math.round(v * 1000) / 1000;
}
