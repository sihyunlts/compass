import { execFile } from 'node:child_process';
import path from 'node:path';
import { promisify } from 'node:util';

const runFile = promisify(execFile);

// Foundation moves items to the OS trash without controlling Finder.
// https://developer.apple.com/documentation/foundation/filemanager/trashitem(at:resultingitemurl:)
const macTrashScript = `
ObjC.import('Foundation');
function run(args) {
  var error = Ref();
  var url = $.NSURL.fileURLWithPath(args[0]);
  if (!$.NSFileManager.defaultManager.trashItemAtURLResultingItemURLError(url, null, error)) {
    throw new Error(ObjC.unwrap(error[0].localizedDescription));
  }
}`;

// Keep the path in the child environment rather than interpolating command text.
// https://learn.microsoft.com/dotnet/api/microsoft.visualbasic.fileio.filesystem.deletefile
const windowsTrashScript = `
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName Microsoft.VisualBasic
$itemPath = $env:COMPASS_TRASH_ITEM
$showUi = [Microsoft.VisualBasic.FileIO.UIOption]::OnlyErrorDialogs
$recycle = [Microsoft.VisualBasic.FileIO.RecycleOption]::SendToRecycleBin
$onCancel = [Microsoft.VisualBasic.FileIO.UICancelOption]::ThrowException
if ([System.IO.Directory]::Exists($itemPath)) {
  [Microsoft.VisualBasic.FileIO.FileSystem]::DeleteDirectory($itemPath, $showUi, $recycle, $onCancel)
} else {
  [Microsoft.VisualBasic.FileIO.FileSystem]::DeleteFile($itemPath, $showUi, $recycle, $onCancel)
}`;

/** Called only for entries already validated by PresetStorage. */
export const trashPresetItem = async (filePath: string): Promise<void> => {
  if (!path.isAbsolute(filePath) || filePath.includes('\0')) throw new Error('Invalid trash path.');
  if (process.platform === 'darwin') {
    await runFile('/usr/bin/osascript', ['-l', 'JavaScript', '-e', macTrashScript, filePath]);
  } else if (process.platform === 'win32') {
    await runFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', windowsTrashScript], {
      env: { ...process.env, COMPASS_TRASH_ITEM: filePath },
      windowsHide: true,
    });
  } else {
    throw new Error('Compass for Max supports macOS and Windows.');
  }
};
