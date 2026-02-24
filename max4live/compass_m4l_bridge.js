autowatch = 1;
inlets = 1;
/**
 * Bridges Compass OSC envelopes into Ableton Live clip operations.
 * Receives note and tempo-request events, applies notes to target MIDI clips,
 * and reports status/errors plus tempo updates back to Compass.
 */
outlets = 3; // 0: status, 1: error, 2: tempo sync

var EXPECTED_EVENT = "clip_notes.replace";
var TEMPO_REQUEST_EVENT = "live_tempo.request";
var EXPECTED_PATH = "/compass/clip-notes";
var MIN_CLIP_LENGTH = 0.25;
var DEFAULT_AUTO_CREATE_LENGTH_BEATS = 4.0;
var TEMPO_POLL_INTERVAL_MS = 250;
var TEMPO_CHANGE_THRESHOLD = 0.01;
var CLIP_MATCH_EPSILON = 0.002;
var AUTO_TARGET_TTL_MS = 5000;
var CREATE_MIDI_CLIP_SUPPORT_UNKNOWN = -1;
var CREATE_MIDI_CLIP_SUPPORT_NO = 0;
var CREATE_MIDI_CLIP_SUPPORT_YES = 1;
var createMidiClipSupport = CREATE_MIDI_CLIP_SUPPORT_UNKNOWN;
var lastAutoTargetClipId = 0;
var lastAutoTargetAtMs = 0;
var tempoPollTask = null;
var lastSentTempo = NaN;

function loadbang() {
  ensureTempoPolling();
}

function bang() {
  ensureTempoPolling();
  emitStatus("ready", "path", EXPECTED_PATH);
}

function set_path(pathValue) {
  ensureTempoPolling();
  EXPECTED_PATH = String(pathValue || "/compass/clip-notes");
  emitStatus("set_path", EXPECTED_PATH);
}

function anything() {
  var tokens = arrayfromargs(messagename, arguments);
  processIncomingTokens(tokens);
}

function list() {
  var tokens = arrayfromargs(arguments);
  tokens.unshift("list");
  processIncomingTokens(tokens);
}

function processIncomingTokens(tokens) {
  ensureTempoPolling();
  var payload = decodePayload(tokens);
  if (!payload) {
    emitError("empty payload");
    return;
  }

  var envelope;
  try {
    envelope = JSON.parse(payload);
  } catch (error) {
    var preview = payload.slice(0, 96);
    emitError("invalid JSON: " + String(error) + " preview=" + preview);
    return;
  }

  applyEnvelope(envelope);
}

function decodePayload(tokens) {
  if (!tokens || tokens.length === 0) {
    return "";
  }

  var values = tokens.slice(0);
  if (values[0] === "list" || values[0] === "symbol") {
    values.shift();
  }

  if (values.length === 0) {
    return "";
  }

  // OSC envelope format: ["/compass/clip-notes", "{...json...}"]
  if (
    typeof values[0] === "string" &&
    values[0].charAt(0) === "/" &&
    typeof values[1] === "string"
  ) {
    return values[1];
  }

  if (typeof values[0] === "string") {
    var firstChar = values[0].charAt(0);
    if (firstChar === "{" || firstChar === "[") {
      return values[0];
    }
  }

  return values.join(" ");
}

function applyEnvelope(envelope) {
  if (!envelope || typeof envelope !== "object") {
    emitError("envelope must be an object");
    return;
  }

  if (envelope.event === TEMPO_REQUEST_EVENT) {
    applyTempoRequest(envelope);
    return;
  }

  var applyMode = envelope.applyMode === "append" ? "append" : "replace";

  if (envelope.event !== EXPECTED_EVENT) {
    emitStatus("ignored_event", String(envelope.event || "undefined"));
    return;
  }

  if (EXPECTED_PATH && envelope.path !== EXPECTED_PATH) {
    emitStatus("ignored_path", String(envelope.path || "undefined"));
    return;
  }

  var normalized = normalizeNotes(envelope.notes);
  if (normalized.notes.length === 0) {
    emitError("envelope has no valid notes");
    return;
  }

  var sourceLength = Math.max(
    toNumber(envelope.targetLengthBeats, normalized.maxEnd),
    normalized.maxEnd,
    MIN_CLIP_LENGTH
  );
  var autoCreateLength = Math.max(
    toNumber(envelope.autoCreateLengthBeats, DEFAULT_AUTO_CREATE_LENGTH_BEATS),
    MIN_CLIP_LENGTH
  );

  var clip = resolveTargetClip(autoCreateLength, applyMode);
  if (!clip) {
    return;
  }

  var clipLength = readClipLength(clip, sourceLength);
  var scaledNotes = scaleNotesToLength(normalized.notes, sourceLength, clipLength);

  if (scaledNotes.length === 0) {
    emitError("scaled notes are empty");
    return;
  }

  try {
    if (applyMode !== "append") {
      clearClipNotes(clip, clipLength);
    }

    writeClipNotes(clip, scaledNotes);
    emitStatus(
      "applied",
      applyMode,
      scaledNotes.length,
      "notes",
      "clip_length",
      clipLength
    );
  } catch (errorApply) {
    emitError("apply failed: " + String(errorApply));
  }
}

function applyTempoRequest(envelope) {
  if (EXPECTED_PATH && envelope.path !== EXPECTED_PATH) {
    emitStatus("ignored_path", String(envelope.path || "undefined"));
    return;
  }

  ensureTempoPolling();
  var sent = sendTempoUpdate(true);
  if (sent) {
    emitStatus("tempo_sync_push", lastSentTempo);
    return;
  }

  emitStatus("tempo_sync_push_skipped");
}

function normalizeNotes(sourceNotes) {
  var notes = [];
  var maxEnd = MIN_CLIP_LENGTH;

  if (!sourceNotes || !sourceNotes.length) {
    return {
      notes: notes,
      maxEnd: maxEnd
    };
  }

  for (var i = 0; i < sourceNotes.length; i++) {
    var note = sourceNotes[i];
    if (!note || typeof note !== "object") {
      continue;
    }

    var rawPitch = toNumber(note.pitch, NaN);
    var rawStart = toNumber(note.startBeat, NaN);
    var rawDuration = toNumber(note.durationBeats, NaN);

    if (
      isNaN(rawPitch) ||
      isNaN(rawStart) ||
      isNaN(rawDuration) ||
      rawPitch < 0 ||
      rawPitch > 127 ||
      rawStart < 0 ||
      rawDuration <= 0
    ) {
      continue;
    }

    var pitch = clampInt(rawPitch, 0, 127);
    var velocity = clampInt(toNumber(note.velocity, 100), 1, 127);
    var mute = note.mute ? 1 : 0;
    var endBeat = rawStart + rawDuration;

    if (endBeat > maxEnd) {
      maxEnd = endBeat;
    }

    notes.push({
      pitch: pitch,
      start_time: rawStart,
      duration: rawDuration,
      velocity: velocity,
      mute: mute
    });
  }

  return {
    notes: notes,
    maxEnd: Math.max(maxEnd, MIN_CLIP_LENGTH)
  };
}

function resolveTargetClip(autoCreateLength, applyMode) {
  try {
    var view = new LiveAPI("live_set view");
    var detailClipId = readLiveId(view.get("detail_clip"));
    if (detailClipId > 0) {
      var detailClip = new LiveAPI("id " + detailClipId);
      if (isMidiClip(detailClip)) {
        clearAutoTargetCache();
        emitStatus(
          "target",
          "detail_clip",
          detailClipId,
          "path",
          detailClip.unquotedpath
        );
        return detailClip;
      }

      emitStatus("detail_clip_not_midi", detailClipId);
    }

    var cachedClip = takeCachedAutoTargetClip(applyMode);
    if (cachedClip) {
      return cachedClip;
    }

    return createArrangementClipOnSelectedTrack(view, autoCreateLength);
  } catch (error) {
    emitError("resolveTargetClip failed: " + String(error));
    return null;
  }
}

function createArrangementClipOnSelectedTrack(view, autoCreateLength) {
  var selectedTrackId = readLiveId(view.get("selected_track"));
  if (selectedTrackId <= 0) {
    emitError("no selected_track to create midi clip");
    return null;
  }

  var track = new LiveAPI("id " + selectedTrackId);
  var hasMidiInput = toNumber(track.get("has_midi_input"), 0);
  if (hasMidiInput <= 0) {
    emitError("selected_track is not a midi track");
    return null;
  }

  var beforeIds = readArrangementClipIds(track);
  var song = new LiveAPI("live_set");
  var startTime = roundBeat(Math.max(toNumber(song.get("current_song_time"), 0), 0));
  var clipLength = roundBeat(
    Math.max(toNumber(autoCreateLength, MIN_CLIP_LENGTH), MIN_CLIP_LENGTH)
  );
  var createdId = tryCreateArrangementClip(track, beforeIds, startTime, clipLength);
  if (createdId <= 0) {
    return null;
  }

  var createdClip = new LiveAPI("id " + createdId);
  if (!isMidiClip(createdClip)) {
    emitError("created clip is not midi");
    return null;
  }
  setClipLengthMarkers(createdClip, clipLength, "created_arrangement_clip");

  rememberAutoTargetClip(createdId);
  emitStatus(
    "target",
    "created_arrangement_clip",
    createdId,
    "track",
    selectedTrackId,
    "start",
    startTime,
    "length",
    clipLength
  );
  return createdClip;
}

function tryCreateArrangementClip(track, beforeIds, startTime, clipLength) {
  var directResult = tryCreateArrangementClipDirect(
    track,
    beforeIds,
    startTime,
    clipLength
  );
  if (directResult > 0) {
    return directResult;
  }

  return tryCreateArrangementClipViaSessionFallback(
    track,
    beforeIds,
    startTime,
    clipLength
  );
}

function tryCreateArrangementClipDirect(track, beforeIds, startTime, clipLength) {
  if (!supportsCreateMidiClip()) {
    return 0;
  }

  try {
    track.call("create_midi_clip", startTime, clipLength);
  } catch (createError) {
    var message = String(createError || "");
    if (message.indexOf("no attribute") >= 0) {
      createMidiClipSupport = CREATE_MIDI_CLIP_SUPPORT_NO;
      return 0;
    }
    emitStatus(
      "create_midi_clip_failed",
      message,
      "fallback",
      "duplicate_clip_to_arrangement"
    );
    return 0;
  }

  var createdId = resolveCreatedArrangementClipId(
    track,
    beforeIds,
    startTime,
    clipLength
  );
  if (createdId <= 0) {
    emitStatus(
      "create_midi_clip_id_resolve_failed",
      "fallback",
      "duplicate_clip_to_arrangement"
    );
    return 0;
  }

  return createdId;
}

function supportsCreateMidiClip() {
  if (createMidiClipSupport === CREATE_MIDI_CLIP_SUPPORT_YES) {
    return true;
  }

  if (createMidiClipSupport === CREATE_MIDI_CLIP_SUPPORT_NO) {
    return false;
  }

  try {
    var app = new LiveAPI("live_app");
    var major = toNumber(app.get("major_version"), NaN);
    var minor = toNumber(app.get("minor_version"), NaN);
    if (!isNaN(major) && !isNaN(minor)) {
      if (major > 12 || (major === 12 && minor >= 2)) {
        createMidiClipSupport = CREATE_MIDI_CLIP_SUPPORT_YES;
        return true;
      }

      createMidiClipSupport = CREATE_MIDI_CLIP_SUPPORT_NO;
      return false;
    }
  } catch (_versionError) {
    // If version lookup fails, try the direct call path once.
  }

  createMidiClipSupport = CREATE_MIDI_CLIP_SUPPORT_YES;
  return true;
}

function tryCreateArrangementClipViaSessionFallback(
  track,
  beforeIds,
  startTime,
  clipLength
) {
  var slotTarget = findEmptyClipSlot(track);
  if (!slotTarget) {
    emitError("fallback failed: no empty clip_slot on selected track");
    return 0;
  }

  var slot = slotTarget.slot;
  try {
    slot.call("create_clip", clipLength);
  } catch (errorCreateClip) {
    emitError("fallback create_clip failed: " + String(errorCreateClip));
    return 0;
  }

  var tempClipId = readLiveId(slot.get("clip"));
  if (tempClipId <= 0) {
    emitError("fallback failed: temp clip id resolve failed");
    deleteClipInSlot(slot);
    return 0;
  }

  var tempClip = new LiveAPI("id " + tempClipId);
  setClipLengthMarkers(tempClip, clipLength, "fallback_temp_clip");

  try {
    track.call("duplicate_clip_to_arrangement", "id " + tempClipId, startTime);
  } catch (errorDuplicate) {
    emitError(
      "fallback duplicate_clip_to_arrangement failed: " + String(errorDuplicate)
    );
    deleteClipInSlot(slot);
    return 0;
  }

  deleteClipInSlot(slot);

  var createdId = resolveCreatedArrangementClipId(
    track,
    beforeIds,
    startTime,
    clipLength
  );
  if (createdId <= 0) {
    emitError("fallback duplicate succeeded but new clip id resolve failed");
    return 0;
  }

  emitStatus("fallback_created_arrangement_clip", createdId);
  return createdId;
}

function setClipLengthMarkers(clip, clipLength, label) {
  var safeLength = roundBeat(
    Math.max(toNumber(clipLength, MIN_CLIP_LENGTH), MIN_CLIP_LENGTH)
  );

  try {
    clip.set("loop_start", 0);
  } catch (_loopStartError) {}

  try {
    clip.set("start_marker", 0);
  } catch (_startMarkerError) {}

  try {
    clip.set("loop_end", safeLength);
  } catch (_loopEndError) {}

  try {
    clip.set("end_marker", safeLength);
  } catch (_endMarkerError) {}

  var actualLength = toNumber(clip.get("length"), NaN);
  emitStatus(
    "clip_length_set",
    String(label || "clip"),
    "requested",
    safeLength,
    "actual",
    isNaN(actualLength) ? "unknown" : roundBeat(actualLength)
  );
}

function resolveCreatedArrangementClipId(track, beforeIds, startTime, clipLength) {
  var afterIds = readArrangementClipIds(track);
  var createdIds = [];

  for (var i = 0; i < afterIds.length; i++) {
    var id = afterIds[i];
    if (!includesNumber(beforeIds, id)) {
      createdIds.push(id);
    }
  }

  if (createdIds.length === 1) {
    return createdIds[0];
  }

  if (createdIds.length > 1) {
    return findClipIdByPosition(createdIds, startTime, clipLength, null);
  }

  return findClipIdByPosition(afterIds, startTime, clipLength, beforeIds);
}

function findClipIdByPosition(candidateIds, startTime, clipLength, excludeIds) {
  var bestId = 0;
  var bestScore = Number.MAX_VALUE;

  for (var i = 0; i < candidateIds.length; i++) {
    var id = candidateIds[i];
    if (excludeIds && includesNumber(excludeIds, id)) {
      continue;
    }

    var clip;
    try {
      clip = new LiveAPI("id " + id);
    } catch (errorCreate) {
      continue;
    }

    if (!isMidiClip(clip)) {
      continue;
    }

    var clipStart = toNumber(clip.get("start_time"), NaN);
    if (isNaN(clipStart)) {
      continue;
    }

    var startDelta = Math.abs(clipStart - startTime);
    if (startDelta > CLIP_MATCH_EPSILON) {
      continue;
    }

    var clipLen = toNumber(clip.get("length"), clipLength);
    var lenDelta = Math.abs(clipLen - clipLength);
    var score = startDelta * 1000 + lenDelta;
    if (score < bestScore) {
      bestScore = score;
      bestId = id;
    }
  }

  return bestId;
}

function findEmptyClipSlot(track) {
  var slotCount = Math.max(0, Math.floor(toNumber(track.getcount("clip_slots"), 0)));
  for (var i = 0; i < slotCount; i++) {
    var slot;
    try {
      slot = new LiveAPI(track.unquotedpath + " clip_slots " + i);
    } catch (errorCreate) {
      continue;
    }

    if (toNumber(slot.get("has_clip"), 0) === 0) {
      return { slot: slot, index: i };
    }
  }

  return null;
}

function deleteClipInSlot(slot) {
  try {
    if (toNumber(slot.get("has_clip"), 0) === 1) {
      slot.call("delete_clip");
    }
  } catch (errorDelete) {
    emitStatus("fallback_delete_clip_warning", String(errorDelete));
  }
}

function readArrangementClipIds(track) {
  var ids = [];
  var clipCount = Math.max(
    0,
    Math.floor(toNumber(track.getcount("arrangement_clips"), 0))
  );

  for (var i = 0; i < clipCount; i++) {
    try {
      var clip = new LiveAPI(track.unquotedpath + " arrangement_clips " + i);
      var clipId = readLiveId(clip.id);
      if (clipId <= 0) {
        clipId = readLiveId(clip.get("id"));
      }
      if (clipId > 0 && !includesNumber(ids, clipId)) {
        ids.push(clipId);
      }
    } catch (errorRead) {
      // Ignore per-clip read errors and continue scanning.
    }
  }

  if (ids.length > 0) {
    return ids;
  }

  return readLiveIds(track.get("arrangement_clips"));
}

function takeCachedAutoTargetClip(applyMode) {
  if (applyMode !== "append") {
    return null;
  }

  if (lastAutoTargetClipId <= 0) {
    return null;
  }

  if (Date.now() - lastAutoTargetAtMs > AUTO_TARGET_TTL_MS) {
    clearAutoTargetCache();
    return null;
  }

  try {
    var clip = new LiveAPI("id " + lastAutoTargetClipId);
    if (!isMidiClip(clip)) {
      clearAutoTargetCache();
      return null;
    }

    emitStatus("target", "cached_auto_clip", lastAutoTargetClipId);
    return clip;
  } catch (error) {
    clearAutoTargetCache();
    return null;
  }
}

function rememberAutoTargetClip(clipId) {
  lastAutoTargetClipId = readLiveId(clipId);
  lastAutoTargetAtMs = Date.now();
}

function clearAutoTargetCache() {
  lastAutoTargetClipId = 0;
  lastAutoTargetAtMs = 0;
}

function isMidiClip(clip) {
  return toNumber(clip.get("is_midi_clip"), 0) === 1;
}

function readClipLength(clip, fallbackLength) {
  return Math.max(
    toNumber(clip.get("length"), fallbackLength),
    MIN_CLIP_LENGTH
  );
}

function clearClipNotes(clip, timeSpan) {
  clip.call("remove_notes_extended", 0, 128, 0, timeSpan);
}

function writeClipNotes(clip, notes) {
  var payload = { notes: notes };

  try {
    clip.call("add_new_notes", payload);
    return;
  } catch (objectError) {
    var jsonPayload = JSON.stringify(payload);
    try {
      clip.call("add_new_notes", jsonPayload);
      return;
    } catch (jsonError) {
      throw new Error(
        "add_new_notes failed: object=" +
          String(objectError) +
          " json=" +
          String(jsonError)
      );
    }
  }
}

function scaleNotesToLength(notes, sourceLength, targetLength) {
  var safeSource = Math.max(toNumber(sourceLength, MIN_CLIP_LENGTH), MIN_CLIP_LENGTH);
  var safeTarget = Math.max(toNumber(targetLength, MIN_CLIP_LENGTH), MIN_CLIP_LENGTH);
  var scale = safeTarget / safeSource;

  if (Math.abs(scale - 1) < 0.000001) {
    return notes.slice(0);
  }

  var scaled = [];
  for (var i = 0; i < notes.length; i++) {
    var note = notes[i];
    if (!note) {
      continue;
    }

    var startTime = Math.max(note.start_time * scale, 0);
    var duration = Math.max(note.duration * scale, 0.000001);
    var endTime = startTime + duration;

    if (startTime >= safeTarget) {
      continue;
    }

    if (endTime > safeTarget) {
      duration = Math.max(safeTarget - startTime, 0.000001);
    }

    scaled.push({
      pitch: note.pitch,
      start_time: startTime,
      duration: duration,
      velocity: note.velocity,
      mute: note.mute
    });
  }

  return scaled;
}

function toArrayLength(value) {
  return value && value.length ? value.length : 0;
}

function readLiveIds(rawValue) {
  if (rawValue === null || rawValue === undefined) {
    return [];
  }

  var text = "";
  if (typeof rawValue === "string") {
    text = rawValue;
  } else if (rawValue && typeof rawValue.length === "number") {
    var parts = [];
    for (var i = 0; i < rawValue.length; i++) {
      parts.push(String(rawValue[i]));
    }
    text = parts.join(" ");
  } else {
    text = String(rawValue);
  }

  var ids = [];
  var tokens = text.split(/\s+/);
  var inIdRun = false;

  for (var i = 0; i < tokens.length; i++) {
    var token = String(tokens[i] || "");
    if (token === "id") {
      inIdRun = true;
      continue;
    }

    var parsed = readLiveId(token);
    if (parsed > 0) {
      if (inIdRun && !includesNumber(ids, parsed)) {
        ids.push(parsed);
      }
      continue;
    }

    if (inIdRun) {
      inIdRun = false;
    }
  }

  if (ids.length > 0) {
    return ids;
  }

  for (var index = 0; index < tokens.length; index++) {
    var numeric = readLiveId(tokens[index]);
    if (numeric > 0 && !includesNumber(ids, numeric)) {
      ids.push(numeric);
    }
  }

  return ids;
}

function includesNumber(values, target) {
  for (var i = 0; i < values.length; i++) {
    if (values[i] === target) {
      return true;
    }
  }
  return false;
}

function roundBeat(value) {
  return Number(value.toFixed(6));
}

function readLiveId(rawValue) {
  var parsed = toNumber(rawValue, 0);
  if (isNaN(parsed) || parsed <= 0) {
    return 0;
  }
  return Math.floor(parsed);
}

function clampInt(value, minValue, maxValue) {
  var rounded = Math.round(value);
  if (rounded < minValue) {
    return minValue;
  }
  if (rounded > maxValue) {
    return maxValue;
  }
  return rounded;
}

function toNumber(value, fallback) {
  if (typeof value === "number") {
    return value;
  }

  if (typeof value === "string") {
    var trimmed = value.trim();
    var parsed = Number(trimmed);
    if (!isNaN(parsed)) {
      return parsed;
    }

    var fractionMatch = trimmed.match(/^(\d+)\s*\/\s*(\d+)$/);
    if (fractionMatch) {
      var numerator = Number(fractionMatch[1]);
      var denominator = Number(fractionMatch[2]);
      if (!isNaN(numerator) && !isNaN(denominator) && denominator > 0) {
        return (numerator / denominator) * 4;
      }
    }

    return fallback;
  }

  if (value && value.length) {
    for (var i = 0; i < value.length; i++) {
      var parsedItem = Number(value[i]);
      if (!isNaN(parsedItem)) {
        return parsedItem;
      }
    }
  }

  return fallback;
}

function ensureTempoPolling() {
  if (tempoPollTask || typeof Task === "undefined") {
    return;
  }

  tempoPollTask = new Task(pollTempo, this);
  tempoPollTask.interval = TEMPO_POLL_INTERVAL_MS;
  tempoPollTask.repeat();
  pollTempo();
}

function pollTempo() {
  sendTempoUpdate(false);
}

function sendTempoUpdate(forceSend) {
  try {
    var song = new LiveAPI("live_set");
    var tempo = toNumber(song.get("tempo"), NaN);
    if (!isFinite(tempo) || tempo <= 0) {
      return false;
    }

    var normalizedTempo = Number(tempo.toFixed(3));
    if (
      !forceSend &&
      isFinite(lastSentTempo) &&
      Math.abs(lastSentTempo - normalizedTempo) < TEMPO_CHANGE_THRESHOLD
    ) {
      return false;
    }

    lastSentTempo = normalizedTempo;
    var payload = JSON.stringify({
      event: "live_tempo",
      bpm: normalizedTempo
    });
    outlet(
      2,
      "/compass/live-tempo",
      payload
    );
    return true;
  } catch (_tempoError) {
    // Ignore tempo read failures so note-apply flow is not interrupted.
    return false;
  }
}

function emitStatus() {
  var args = arrayfromargs(arguments);
  outlet(0, args);
}

function emitError(message) {
  var normalized = String(message);
  outlet(0, "error", normalized);
  outlet(1, "error", normalized);
}
