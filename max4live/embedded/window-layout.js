inlets = 1;
outlets = 0;

var contentHeight = Number(jsarguments[1]);
var webView = null;
var previousWidth = 0;
var trackingWidth = false;
var resizeTask = new Task(syncWindowWidth, this);

function bang() {
  if (trackingWidth) return;
  webView = this.patcher.getnamed('compass_web');
  trackingWidth = true;
  resizeTask.schedule(0);
}

function syncWindowWidth() {
  var window = this.patcher.wind;
  if (!window.visible) {
    trackingWidth = false;
    return;
  }
  var width = window.size[0];
  if (width > 0 && width !== previousWidth) {
    previousWidth = width;
    webView.message('size', width, contentHeight);
  }
  // Wind exposes size but no resize callback. Update the view only on changes,
  // and stop checking when the window closes. Opening/focusing restarts it.
  resizeTask.schedule(50);
}
syncWindowWidth.local = 1;

function notifydeleted() {
  trackingWidth = false;
  resizeTask.cancel();
  resizeTask.freepeer();
}
