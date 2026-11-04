import { randomBytes } from 'node:crypto';
import { mkdtemp, writeFile, readFile, access, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  decryptBackup,
  encryptBackup,
  openBackupFile,
  readBackupFile,
  sealBackupFile,
} from '@/lib/backups/archive';

describe('encrypted backup archives', () => {
  it('preserves binary bytes and uses a fresh IV for every archive', () => {
    const key = randomBytes(32),
      content = Buffer.concat([Buffer.from('Ledger Δ\n'), randomBytes(1024)]);
    const first = encryptBackup(content, key),
      second = encryptBackup(content, key);
    expect(first.equals(second)).toBe(false);
    expect(decryptBackup(first, key)).toEqual(content);
    expect(decryptBackup(second, key)).toEqual(content);
  });

  it('rejects wrong keys and changes to the header, IV, tag or ciphertext', () => {
    const key = randomBytes(32),
      archive = encryptBackup(Buffer.from('private database dump'), key);
    expect(() => decryptBackup(archive, randomBytes(32))).toThrow();
    for (const index of [0, 12, 24, archive.length - 1]) {
      const changed = Buffer.from(archive);
      changed.writeUInt8(changed.readUInt8(index) ^ 1, index);
      expect(() => decryptBackup(changed, key)).toThrow();
    }
    expect(() => decryptBackup(archive.subarray(0, 20), key)).toThrow();
    expect(() => encryptBackup(Buffer.alloc(0), Buffer.alloc(31))).toThrow();
  });

  it('authenticates before writing plaintext and refuses to overwrite either output', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'ledger-backup-test-'));
    const source = join(dir, 'source'),
      sealed = join(dir, 'sealed'),
      restored = join(dir, 'restored'),
      failed = join(dir, 'failed');
    const key = randomBytes(32),
      original = Buffer.from('synthetic test bytes');
    try {
      await writeFile(source, original);
      await sealBackupFile(source, sealed, key);
      await expect(
        openBackupFile(sealed, failed, randomBytes(32)),
      ).rejects.toThrow();
      await expect(access(failed)).rejects.toThrow();
      await openBackupFile(sealed, restored, key);
      expect(await readFile(restored)).toEqual(original);
      await expect(openBackupFile(sealed, restored, key)).rejects.toThrow();
      const saved = await readFile(sealed);
      await expect(sealBackupFile(source, sealed, key)).rejects.toThrow();
      expect(await readFile(sealed)).toEqual(saved);
      await expect(readBackupFile(source, 2)).rejects.toThrow();
    } finally {
      // Only this test's fresh, fixed-prefix directory is removed.
      if (
        dirname(resolve(dir)) !== resolve(tmpdir()) ||
        !basename(dir).startsWith('ledger-backup-test-')
      )
        throw new Error('Unexpected test cleanup path.');
      await rm(dir, { recursive: true, force: true });
    }
  });
});
