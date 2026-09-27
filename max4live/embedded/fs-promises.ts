import { promises, type PathLike, type RmOptions } from 'fs';

// Node 12 exposes this API through fs.promises, not the fs/promises module.
export const {
  access, copyFile, link, lstat, mkdir, open, readdir, readFile, readlink,
  realpath, rename, rmdir, stat, symlink, unlink, writeFile,
} = promises;

export async function rm(filePath: PathLike, options: RmOptions = {}): Promise<void> {
  if (typeof promises.rm === 'function') return promises.rm(filePath, options);

  try {
    // lstat keeps a symbolic link from turning into recursive target deletion.
    const entry = await promises.lstat(filePath);
    if (entry.isDirectory()) {
      await promises.rmdir(filePath, { recursive: options.recursive });
    } else {
      await promises.unlink(filePath);
    }
  } catch (error) {
    if (options.force && (error as NodeJS.ErrnoException).code === 'ENOENT') return;
    throw error;
  }
}
