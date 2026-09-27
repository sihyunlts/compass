inlets = 2;
outlets = 2;

var service = null;
var serviceReady = false;
var serviceError = '';
var requests = {};

function start(scriptPath) {
  if (service) return;
  // Start from the extracted physical file, not an unnamed frozen project.
  try {
    service = this.patcher.newdefault(1050, 580, 'node.script', String(scriptPath), '@autostart', 0, '@defer', 1);
    if (!service) throw new Error('Could not create the Max file service.');
    // Older node.script versions do not expose the restart attribute.
    if (service.getattrnames().indexOf('restart') !== -1) service.setattr('restart', 0);
    this.patcher.connect(this.box, 1, service, 0);
    this.patcher.connect(service, 0, this.box, 1);
    service.message('script', 'start');
  } catch (error) {
    reportServiceError(error.message);
  }
}

function status() {
  if (serviceReady) outlet(0, 'compass_files_status', 1);
  else if (serviceError) outlet(0, 'compass_files_status', 0, serviceError);
}

function service_ready() {
  if (inlet !== 1) return;
  serviceReady = true;
  serviceError = '';
  status();
}

function service_error(message) {
  if (inlet !== 1) return;
  reportServiceError(message);
}

function reportServiceError(message) {
  serviceReady = false;
  serviceError = String(message);
  for (var id in requests) {
    requests[id].running = false;
    outlet(0, 'compass_files_error', id, serviceError);
    release(id);
  }
  status();
}

function prepare(requestId) {
  var id = String(requestId);
  if (!serviceReady) {
    outlet(0, 'compass_files_error', id, serviceError || 'The file service is not ready.');
    return;
  }
  if (requests[id]) return;
  var dictionary = new Dict();
  requests[id] = { dictionary: dictionary, running: false, cancelled: false };
  outlet(0, 'compass_files_prepared', id, dictionary.name);
}

function request(requestId) {
  var id = String(requestId);
  var pending = requests[id];
  if (!pending || pending.running || pending.cancelled) return;
  pending.running = true;
  outlet(1, 'request', pending.dictionary.name, id);
}

function response(requestId) {
  if (inlet !== 1) return;
  var id = String(requestId);
  var pending = requests[id];
  if (!pending) return;
  pending.running = false;
  if (pending.cancelled) release(id);
  else outlet(0, 'compass_files_result', id, pending.dictionary.name);
}

function request_error(requestId, message) {
  if (inlet !== 1) return;
  var id = String(requestId);
  if (!requests[id]) return;
  requests[id].running = false;
  outlet(0, 'compass_files_error', id, String(message));
  release(id);
}

function release(requestId) {
  var id = String(requestId);
  var pending = requests[id];
  if (!pending) return;
  if (pending.running) {
    pending.cancelled = true;
    outlet(1, 'cancel_request', id);
    return;
  }
  pending.dictionary.freepeer();
  delete requests[id];
}

function changed() {
  if (inlet !== 1) return;
  outlet(0, 'compass_files_changed');
}

function dialog_state(requestId, open) {
  if (inlet !== 1) return;
  var id = String(requestId);
  if (requests[id]) outlet(0, 'compass_files_dialog', id, Number(open) === 1 ? 1 : 0);
}

// Internal helpers are not callable by messages arriving from jweb.
reportServiceError.local = 1;

function notifydeleted() {
  if (service) service.message('script', 'stop');
  for (var id in requests) requests[id].dictionary.freepeer();
  requests = {};
}
