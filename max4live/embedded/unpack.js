// Payload strings contain UTF-8 bytes as character codes 0..255. The builder
// verifies reconstruction before embedding; no frozen-collective reads are needed.
inlets = 1;
outlets = 2;

var resources = __COMPASS_RESOURCES__;
var resourceFile = null;
var outputFolder = '';
var resourceIndex = 0;
var copyTask = null;
var copiedBytes = 0;
var nextChunk = 0;
var checkingExistingFile = false;
var coordinator = null;
var ownsCoordinator = false;

function closeFile() {
  if (resourceFile) resourceFile.close();
  resourceFile = null;
}

function writeResource() {
  closeFile();
  resourceFile = new File(outputFolder + '/' + resources[resourceIndex].name, 'write');
  if (!resourceFile.isopen) throw new Error('Cannot write the Max temporary app resource.');
  resourceFile.eof = 0;
  copiedBytes = 0;
  nextChunk = 0;
  checkingExistingFile = false;
}

function openResource() {
  var resource = resources[resourceIndex];
  resourceFile = new File(outputFolder + '/' + resource.name, 'read');
  copiedBytes = 0;
  nextChunk = 0;
  // Verify existing bytes before reuse, including a partial file from a failed load.
  checkingExistingFile = resourceFile.isopen && resourceFile.eof === resource.size;
  if (!checkingExistingFile) writeResource();
}

function load_page(folder) {
  if (copyTask) return;
  outputFolder = String(folder).replace(/\/$/, '');
  resourceIndex = 0;
  copyTask = new Task(copyResourceChunk, this);
  copyTask.schedule(0);
}

function releaseResource() {
  if (ownsCoordinator) coordinator.writer = null;
  ownsCoordinator = false;
  coordinator = null;
}

function releaseCopyTask() {
  releaseResource();
  if (copyTask) {
    copyTask.cancel();
    copyTask.freepeer();
  }
  copyTask = null;
}

function copyResourceChunk() {
  try {
    if (!ownsCoordinator) {
      // Coordinate each physical file, including service bundles shared by
      // different UI versions. Reloading a script invalidates its owning Task.
      if (!coordinator) coordinator = new Global('compass_resource_' + outputFolder + '/' + resources[resourceIndex].name);
      if (coordinator.writer && coordinator.writer.valid) {
        copyTask.schedule(10);
        return;
      }
      coordinator.writer = copyTask;
      ownsCoordinator = true;
      openResource();
    }
    var resource = resources[resourceIndex];
    // Yield between batches so extraction or verification does not monopolize Max's UI.
    for (var batch = 0; batch < 8 && nextChunk < resource.chunks.length; batch += 1) {
      var chunk = resource.chunks[nextChunk];
      var bytes;
      if (checkingExistingFile) {
        bytes = resourceFile.readbytes(chunk.length);
        var matches = bytes.length === chunk.length;
        for (var j = 0; matches && j < chunk.length; j += 1) matches = bytes[j] === chunk.charCodeAt(j);
        if (!matches) {
          writeResource();
          continue;
        }
      } else {
        bytes = new Array(chunk.length);
        for (var i = 0; i < chunk.length; i += 1) bytes[i] = chunk.charCodeAt(i);
        resourceFile.writebytes(bytes);
      }
      copiedBytes += bytes.length;
      nextChunk += 1;
      if (resourceFile.position !== copiedBytes) throw new Error('Could not process the complete resource chunk.');
    }
    if (nextChunk < resource.chunks.length) {
      copyTask.schedule(1);
      return;
    }
    if (copiedBytes !== resource.size || resourceFile.eof !== resource.size) throw new Error('Incomplete temporary app resource.');
    closeFile();
    releaseResource();
    resourceIndex += 1;
    if (resourceIndex < resources.length) {
      copyTask.schedule(1);
      return;
    }
    releaseCopyTask();
    outlet(1, 'files_start', outputFolder + '/' + resources[1].name);
    outlet(0, 'readfile', outputFolder + '/' + resources[0].name);
  } catch (error) {
    failCopy(error);
  }
}

function failCopy(error) {
  closeFile();
  releaseCopyTask();
  post('Compass loading failed: ' + error.message + '\n');
}

function notifydeleted() {
  closeFile();
  releaseCopyTask();
}
