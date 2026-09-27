import { execFile, type ChildProcess } from 'node:child_process';
import path from 'node:path';

interface MaxDialogApi {
  outlet: (...args: unknown[]) => Promise<void>;
}
type DialogResult = { canceled: true } | { canceled: false; filePath: string };

// AppKit runs in its own process, without controlling Finder or Live.
const macSaveScript = `
ObjC.import('AppKit');
function run(args) {
  var options = JSON.parse(args[0]);
  var application = $.NSApplication.sharedApplication;
  application.setActivationPolicy($.NSApplicationActivationPolicyAccessory);
  var panel = $.NSSavePanel.savePanel;
  panel.directoryURL = $.NSURL.fileURLWithPath(options.directory);
  panel.nameFieldStringValue = $(options.fileName);
  panel.allowedFileTypes = $([options.extension]);
  panel.allowsOtherFileTypes = false;
  panel.canCreateDirectories = true;
  panel.canSelectHiddenExtension = false;
  panel.extensionHidden = false;
  application.activateIgnoringOtherApps(true);
  if (panel.runModal !== $.NSModalResponseOK) return JSON.stringify({ canceled: true });
  return JSON.stringify({ canceled: false, filePath: ObjC.unwrap(panel.URL.path) });
}`;

// User paths are data in the environment, never PowerShell command text.
const windowsSaveScript = `
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
[System.Windows.Forms.Application]::EnableVisualStyles()
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$options = $env:COMPASS_SAVE_DIALOG_OPTIONS | ConvertFrom-Json
$dialog = New-Object System.Windows.Forms.SaveFileDialog
try {
  $dialog.InitialDirectory = $options.directory
  $dialog.FileName = $options.fileName
  $dialog.DefaultExt = $options.extension
  $dialog.Filter = "Compass (*.$($options.extension))|*.$($options.extension)"
  $dialog.AddExtension = $true
  $dialog.OverwritePrompt = $true
  $dialog.RestoreDirectory = $true
  if ($dialog.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) {
    @{ canceled = $false; filePath = $dialog.FileName } | ConvertTo-Json -Compress
  } else {
    @{ canceled = $true } | ConvertTo-Json -Compress
  }
} finally {
  $dialog.Dispose()
}`;

/** Only the OS chooser supplies writable external paths; web input cannot. */
export class NativeSaveDialog {
  private pending: { id: string; child: ChildProcess | null; canceled: boolean } | null = null;

  public constructor(private readonly max: MaxDialogApi) {}

  public cancel(id: string): void {
    if (this.pending?.id !== id) return;
    this.pending.canceled = true;
    this.pending.child?.kill();
  }

  public async choosePath(id: string, defaultPath: string, extension: string): Promise<DialogResult> {
    if (this.pending) throw new Error('A save dialog is already open.');
    if (!path.isAbsolute(defaultPath) || defaultPath.includes('\0') || !/^\.[a-z]+$/.test(extension)) {
      throw new Error('Invalid save dialog options.');
    }
    const pending = { id, child: null as ChildProcess | null, canceled: false };
    this.pending = pending;
    try {
      await this.max.outlet('dialog_state', id, 1);
      if (pending.canceled) return { canceled: true };
      const options = JSON.stringify({
        directory: path.dirname(defaultPath), fileName: path.basename(defaultPath), extension: extension.slice(1),
      });
      const stdout = await new Promise<string>((resolve, reject) => {
        const complete = (error: Error | null, output: string) => {
          if (pending.canceled) resolve('{"canceled":true}');
          else if (error) reject(error);
          else resolve(output);
        };
        if (process.platform === 'darwin') {
          pending.child = execFile('/usr/bin/osascript', ['-l', 'JavaScript', '-e', macSaveScript, options],
            { encoding: 'utf8', maxBuffer: 64 * 1024 }, complete);
        } else if (process.platform === 'win32') {
          pending.child = execFile('powershell.exe', ['-NoProfile', '-STA', '-Command', windowsSaveScript],
            { encoding: 'utf8', maxBuffer: 64 * 1024, windowsHide: true,
              env: { ...process.env, COMPASS_SAVE_DIALOG_OPTIONS: options } }, complete);
        } else reject(new Error('Compass for Max supports macOS and Windows.'));
      });
      if (pending.canceled) return { canceled: true };
      const result = JSON.parse(stdout) as { canceled?: unknown; filePath?: unknown };
      if (result?.canceled === true) return { canceled: true };
      if (result?.canceled !== false || typeof result.filePath !== 'string'
        || result.filePath.includes('\0') || !path.isAbsolute(result.filePath)
        || !result.filePath.toLowerCase().endsWith(extension)) {
        throw new Error('The OS save dialog did not return a valid file path.');
      }
      return { canceled: false, filePath: path.normalize(result.filePath) };
    } finally {
      this.pending = null;
      await this.max.outlet('dialog_state', id, 0);
    }
  }
}
