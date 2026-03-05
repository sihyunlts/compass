/**
 * Bridges Compass OSC envelopes with Live clip and tempo operations in Max for Live.
 * Minimum supported: Ableton Live 11 + Max 8.
 */

autowatch = 1;

inlets = 1;
outlets = 3;

var DEFAULT_INCOMING_OSC_PATH = "/compass/clip-notes";
var TEMPO_OSC_PATH = "/compass/live-tempo";

var AUTO_TARGET_TTL_MS = 5000;
var TEMPO_POLL_INTERVAL_MS = 250;
var CREATE_MIDI_CLIP_SUPPORT_UNKNOWN = -1;
var CREATE_MIDI_CLIP_SUPPORT_NO = 0;
var CREATE_MIDI_CLIP_SUPPORT_YES = 1;

// Retry LiveAPI root resolution to avoid noisy failures during device boot.
var LIVEAPI_RESOLVE_RETRY_MS = 1000;

var MIN_CLIP_LENGTH_BEATS = 0.25;
var DEFAULT_AUTO_CREATE_LENGTH_BEATS = 4.0;

var expectedOscPath = DEFAULT_INCOMING_OSC_PATH;

var lastAutoTargetClipId = 0;
var lastAutoTargetTimestampMs = 0;

var lastSentTempo = null;
var tempoPollTask = null;
var createMidiClipSupport = CREATE_MIDI_CLIP_SUPPORT_UNKNOWN;

// Cache root LiveAPI objects after the first successful resolve.
var liveSetApi = null;
var liveSetViewApi = null;
var lastLiveSetResolveAttemptMs = 0;
var lastViewResolveAttemptMs = 0;

function set_path(path) {
  expectedOscPath = path || DEFAULT_INCOMING_OSC_PATH;
  status("set_path", expectedOscPath);
}

function bang() {
  status("ready", "path", expectedOscPath);
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
  var applyMode = envelope.applyMode === "append" ? "append" : "replace";

  if (!envelope.notes || !envelope.notes.length) {
    status("empty_notes");
    return;
  }

  var normalized = normalizeNotes(envelope.notes);
  if (!normalized.notes.length) {
    status("empty_notes");
    return;
  }
  var sourceLength = computeSourceLengthBeats(envelope, normalized);

  var autoCreateLength = toNumber(envelope.autoCreateLengthBeats, DEFAULT_AUTO_CREATE_LENGTH_BEATS);
  if (!isFinite(autoCreateLength) || autoCreateLength <= 0) {
    autoCreateLength = DEFAULT_AUTO_CREATE_LENGTH_BEATS;
  }
  autoCreateLength = Math.max(autoCreateLength, MIN_CLIP_LENGTH_BEATS);
  var requiredClipLength = Math.max(
    roundBeat(autoCreateLength * sourceLength),
    MIN_CLIP_LENGTH_BEATS
  );

  var targetClip = resolveTargetMidiClip(applyMode, requiredClipLength);
  if (!targetClip) {
    return;
  }

  if (applyMode === "replace") {
    var existingLength = readClipLengthBeats(targetClip, requiredClipLength);
    if (existingLength + 1e-6 < requiredClipLength) {
      safeSetClipMarkers(targetClip, requiredClipLength);
    }
  }

  var clipLength = readClipLengthBeats(targetClip, requiredClipLength);
  var scaledNotes = scaleNotesToClip(normalized.notes, sourceLength, clipLength);

  if (applyMode === "replace") {
    clearClipNotes(targetClip, clipLength);
  }

  writeNotesToClip(targetClip, scaledNotes);
  status("applied", applyMode, "notes", scaledNotes.length);
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

function computeSourceLengthBeats(envelope, normalized) {
  var explicit = toNumber(envelope.targetLengthBeats, normalized.maxEnd);
  var length = Math.max(explicit, normalized.maxEnd, MIN_CLIP_LENGTH_BEATS);
  return Math.max(length, MIN_CLIP_LENGTH_BEATS);
}

function scaleNotesToClip(notes, sourceLength, clipLength) {
  var out = [];
  var src = Math.max(sourceLength, MIN_CLIP_LENGTH_BEATS);
  var dst = Math.max(clipLength, MIN_CLIP_LENGTH_BEATS);

  var scale = dst / src;
  if (!isFinite(scale) || scale <= 0) {
    scale = 1.0;
  }

  // Skip scaling when lengths are effectively equal.
  if (Math.abs(scale - 1.0) < 1e-6) {
    return notes.slice(0);
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

function clearClipNotes(clipApi, clipLength) {
  // Live 11+: remove notes across full pitch range and clip span.
  clipApi.call("remove_notes_extended", 0, 128, 0, clipLength);
}

function writeNotesToClip(clipApi, notes) {
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

function resolveTargetMidiClip(applyMode, requiredClipLength) {
  var view = getLiveSetViewApi();
  if (!view) {
    return null;
  }
  var detailId = readLiveId(view.get("detail_clip"));
  if (detailId > 0) {
    var detailClip = new LiveAPI("id " + detailId);
    if (isMidiClip(detailClip)) {
      clearAutoTarget();
      status("target", "detail_clip", detailId);
      return detailClip;
    }

    status("detail_clip_not_midi", detailId);
    return null;
  }

  if (applyMode === "append") {
    var cached = getCachedAutoTargetClip();
    if (cached) {
      status("target", "cached_auto_clip", lastAutoTargetClipId);
      return cached;
    }
  }

  var created = createArrangementMidiClipOnSelectedTrack(requiredClipLength);
  if (created) {
    status("target", "created_arrangement_clip", created.id);
  }
  return created;
}

function getCachedAutoTargetClip() {
  if (!lastAutoTargetClipId) {
    return null;
  }

  var now = nowMs();
  if (now - lastAutoTargetTimestampMs > AUTO_TARGET_TTL_MS) {
    clearAutoTarget();
    return null;
  }

  try {
    var clip = new LiveAPI("id " + lastAutoTargetClipId);
    if (!isMidiClip(clip)) {
      clearAutoTarget();
      return null;
    }
    return clip;
  } catch (e) {
    clearAutoTarget();
    return null;
  }
}

function clearAutoTarget() {
  lastAutoTargetClipId = 0;
  lastAutoTargetTimestampMs = 0;
}

function rememberAutoTarget(clipId) {
  lastAutoTargetClipId = clipId;
  lastAutoTargetTimestampMs = nowMs();
}

function createArrangementMidiClipOnSelectedTrack(clipLength) {
  var view = getLiveSetViewApi();
  if (!view) {
    return null;
  }
  var trackId = readLiveId(view.get("selected_track"));
  if (!trackId) {
    errorOut("no_selected_track", "Select a MIDI track in Live");
    return null;
  }

  var track = new LiveAPI("id " + trackId);
  if (!isMidiTrack(track)) {
    errorOut("selected_track_not_midi", trackId);
    return null;
  }

  var song = getLiveSetApi();
  if (!song) {
    return null;
  }
  var startTime = roundBeat(Math.max(0.0, toNumber(song.get("current_song_time"), 0.0)));
  var length = roundBeat(Math.max(clipLength, MIN_CLIP_LENGTH_BEATS));

  var createdId = tryCreateArrangementClip(track, startTime, length);

  if (!createdId) {
    errorOut("create_clip_failed", "Could not resolve new arrangement clip id");
    return null;
  }

  var clip = new LiveAPI("id " + createdId);
  if (!isMidiClip(clip)) {
    errorOut("created_clip_not_midi", createdId);
    return null;
  }

  // Keep clip loop and marker boundaries aligned to the generated length.
  safeSetClipMarkers(clip, length);

  rememberAutoTarget(createdId);
  return clip;
}

function tryCreateArrangementClip(trackApi, startTime, length) {
  // Prefer direct arrangement creation, then fallback to session-clip duplication.

  var before = readArrangementClipIds(trackApi);

  if (tryCallCreateMidiClip(trackApi, startTime, length)) {
    var created = resolveNewArrangementClipId(trackApi, before, startTime);
    if (created) {
      status("created_arrangement_clip_direct", created);
      return created;
    }
  }

  var tempClipId = 0;
  var slotIndex = findEmptyClipSlotIndex(trackApi);
  if (slotIndex < 0) {
    errorOut("no_empty_clip_slot", "No empty clip slot found on selected track");
    return 0;
  }

  var slot = new LiveAPI(trackApi.unquotedpath + " clip_slots " + slotIndex);
  try {
    slot.call("create_clip", length);
    tempClipId = readLiveId(slot.get("clip"));
  } catch (e) {
    errorOut("create_session_clip_failed", safeErrorMessage(e));
    return 0;
  }

  if (!tempClipId) {
    errorOut("temp_clip_missing", "create_clip did not yield a clip id");
    return 0;
  }

  var tempClip = new LiveAPI("id " + tempClipId);
  safeSetClipMarkers(tempClip, length);

  try {
    trackApi.call("duplicate_clip_to_arrangement", "id " + tempClipId, startTime);
  } catch (e2) {
    safeDeleteClipInSlot(slot);
    errorOut("duplicate_clip_to_arrangement_failed", safeErrorMessage(e2));
    return 0;
  }

  safeDeleteClipInSlot(slot);

  var createdFallback = resolveNewArrangementClipId(trackApi, before, startTime);
  if (createdFallback) {
    status("created_arrangement_clip_fallback", createdFallback);
  }
  return createdFallback;
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
  outlet(0, arrayfromargs(arguments));
}

function errorOut(code, message) {
  var msg = code + ": " + message;
  outlet(0, "error", msg);
  outlet(1, "error", msg);
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

  // LiveAPI often returns [value] arrays for scalar properties.
  if (v instanceof Array) {
    if (v.length === 0) {
      return fallback;
    }
    return toNumber(v[0], fallback);
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
function roundBeat(v) {
  return Math.round(v * 1000) / 1000;
}
