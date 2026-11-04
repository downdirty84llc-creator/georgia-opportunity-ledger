import { randomBytes } from 'node:crypto';
import { writeFile, unlink } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { userInfo } from 'node:os';

import {
  openBackupFile,
  readBackupFile,
  sealBackupFile,
} from '../src/lib/backups/archive';

const [command, ...args] = process.argv.slice(2);

async function main(): Promise<void> {
  const [input, output, keyPath] = args;
  if (command === 'create-key' && args.length === 1 && input) {
    const key = randomBytes(32);
    try {
      await writeFile(input, key, { flag: 'wx', mode: 0o600 });
      if (process.platform === 'win32') {
        const account = process.env.USERDOMAIN
          ? `${process.env.USERDOMAIN}\\${userInfo().username}`
          : userInfo().username;
        const result = spawnSync(
          'icacls.exe',
          [input, '/inheritance:r', '/grant:r', `${account}:F`],
          { windowsHide: true, stdio: 'ignore' },
        );
        if (result.status !== 0) {
          await unlink(input);
          throw new Error(
            'Could not restrict the key to the current Windows account. No key was retained.',
          );
        }
      }
    } finally {
      key.fill(0);
    }
    console.log(
      'Backup key created. Keep an independent protected recovery copy.',
    );
    return;
  }
  if (
    (command !== 'seal' && command !== 'open') ||
    args.length !== 3 ||
    !input ||
    !output ||
    !keyPath
  ) {
    throw new Error(
      'Usage: backup-archive create-key <key-file> | seal|open <input> <output> <key-file>',
    );
  }
  const key = await readBackupFile(keyPath, 32);
  try {
    if (command === 'seal') await sealBackupFile(input, output, key);
    else await openBackupFile(input, output, key);
  } finally {
    key.fill(0);
  }
  console.log(
    command === 'seal'
      ? 'Encrypted archive created. Verify recovery before removing the source export.'
      : 'Archive authenticated and restored to a new file. Database restore is a separate step.',
  );
}

main().catch((error: unknown) => {
  // Do not print paths, input contents, key material or native crypto errors.
  const message = error instanceof Error ? error.message : '';
  console.error(
    message.startsWith('Usage:')
      ? message
      : 'Backup operation failed. Check input, key, size limit, permissions and that the destination does not exist.',
  );
  process.exitCode = 1;
});
