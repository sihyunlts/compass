// Text chunks have UTF-8 byte lengths verified by the builder. Use Max's native
// string I/O instead of converting and comparing every byte in legacy JS.
// https://docs.cycling74.com/legacy/max7/vignettes/jsfileobject
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
    // Bound work by elapsed time, not file size: fast native I/O should not incur
    // hundreds of scheduler round trips, while slow disks still yield to Max.
    var batchStarted = Date.now();
    do {
      var chunk = resource.chunks[nextChunk];
      if (checkingExistingFile) {
        if (resourceFile.readstring(chunk.size) !== chunk.text) {
          writeResource();
          continue;
        }
      } else {
        resourceFile.writestring(chunk.text);
      }
      copiedBytes += chunk.size;
      nextChunk += 1;
      if (resourceFile.position !== copiedBytes) throw new Error('Could not process the complete resource chunk.');
    } while (nextChunk < resource.chunks.length && Date.now() - batchStarted < 8);
    if (nextChunk < resource.chunks.length) {
      copyTask.schedule(1);
      return;
    }
    if (copiedBytes !== resource.size || resourceFile.eof !== resource.size) throw new Error('Incomplete temporary app resource.');
    closeFile();
    releaseResource();
    // Let CEF parse and render the page while the file service is prepared.
    if (resourceIndex === 0) outlet(0, 'readfile', outputFolder + '/' + resource.name);
    else outlet(1, 'files_start', outputFolder + '/' + resource.name);
    resourceIndex += 1;
    if (resourceIndex < resources.length) {
      copyTask.schedule(1);
      return;
    }
    releaseCopyTask();
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
