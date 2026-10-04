// The build prepends shared/clip-engine.js so this script is self-contained.

inlets = 1;
outlets = 3;

var embeddedLiveReady = false;
var embeddedRequestId = '';
var embeddedPayload = null;
var embeddedApplying = false;
var embeddedCompletionTask = null;
var embeddedTempo = 120;

function live_ready() {
  embeddedLiveReady = true;
}

function compass_open_external(url) {
  var destination = String(url);
  if (!/^https?:\/\/[^\s]+$/i.test(destination)) return;
  max.launchbrowser(destination);
}

function tempo(value) {
  embeddedTempo = Number(value);
  if (isFinite(embeddedTempo) && embeddedTempo > 0) outlet(2, 'compass_tempo', embeddedTempo);
}

function compass_request_tempo() {
  if (!embeddedLiveReady) return;
  var song = getLiveSetApi();
  if (song) tempo(toNumber(song.get('tempo'), embeddedTempo));
}

function finishEmbeddedRequest(success, message) {
  clearEmbeddedCompletionTask();
  if (!embeddedRequestId) return;
  var id = embeddedRequestId;
  embeddedRequestId = '';
  embeddedApplying = false;
  if (embeddedPayload) embeddedPayload.freepeer();
  embeddedPayload = null;
  outlet(2, 'compass_result', id, success ? 1 : 0, message || '');
}

function clearEmbeddedCompletionTask() {
  if (!embeddedCompletionTask) return;
  embeddedCompletionTask.cancel();
  embeddedCompletionTask.freepeer();
  embeddedCompletionTask = null;
}

function status() {
  var args = arrayfromargs(arguments);
  if (!embeddedRequestId || (args[0] !== 'applied' && args[0] !== 'empty_notes')) return;
  if (embeddedCompletionTask) return;
  // Wait until the current Live API operation (including Arrangement duplication)
  // has returned; a later error in that operation must win over this success.
  embeddedCompletionTask = new Task(function () { finishEmbeddedRequest(true); }, this);
  embeddedCompletionTask.schedule(0);
}

function errorOut(code, message) {
  finishEmbeddedRequest(false, code + ': ' + message);
}

function compass_prepare(requestId) {
  var id = String(requestId);
  if (embeddedRequestId) {
    outlet(2, 'compass_result', id, 0, 'Another transfer is in progress.');
    return;
  }
  embeddedRequestId = id;
  try {
    if (!embeddedLiveReady || !getLiveSetApi() || !getLiveSetViewApi()) {
      throw new Error('Live API is not ready. Load this device on a MIDI track in Live.');
    }
    // Keep the native dictionary alive across asynchronous jweb messages.
    // The browser writes only after receiving the name of this owned dictionary.
    embeddedPayload = new Dict();
    outlet(2, 'compass_transfer_ready', id, embeddedPayload.name);
  } catch (error) {
    finishEmbeddedRequest(false, safeErrorMessage(error));
  }
}

function compass_send(requestId) {
  var id = String(requestId);
  if (id !== embeddedRequestId || !embeddedPayload || embeddedApplying) return;
  try {
    // Reassemble bounded symbols in JS, never in a Max symbol or Dict.stringify().
    var chunks = embeddedPayload.get('chunks');
    if (typeof chunks === 'string') chunks = [chunks];
    if (!Array.isArray(chunks) || !chunks.length || chunks.some(function (chunk) { return typeof chunk !== 'string'; })) {
      throw new Error('Max received an invalid clip transfer.');
    }
    var payload = JSON.parse(chunks.join(''));
    if (!payload || payload.requestId !== id) throw new Error('Max received a different transfer request ID.');
    if (!payload.envelope || payload.envelope.event !== 'clip_notes.replace' || !Array.isArray(payload.envelope.notes)) {
      throw new Error('Max received incomplete clip data.');
    }
    embeddedApplying = true;
    applyClipNotesEnvelope(payload.envelope);
  } catch (error) {
    finishEmbeddedRequest(false, safeErrorMessage(error));
  }
}

function compass_cancel(requestId) {
  if (String(requestId) !== embeddedRequestId) return;
  clearSelectionRetryTask();
  finishEmbeddedRequest(false, 'Transfer cancelled.');
}

function notifydeleted() {
  clearEmbeddedCompletionTask();
  clearSelectionRetryTask();
  if (embeddedPayload) embeddedPayload.freepeer();
  embeddedPayload = null;
}
