import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { open, writeFile } from 'node:fs/promises';

const MAGIC = Buffer.from('GOL-BACKUP-1\n');
const IV_BYTES = 12;
const TAG_BYTES = 16;
const HEADER_BYTES = MAGIC.length + IV_BYTES;
export const MAX_BACKUP_BYTES = 64 * 1024 * 1024;

function checkKey(key: Buffer): void {
  if (key.length !== 32) throw new Error('A 32-byte backup key is required.');
}

/** Random IV plus authenticated version header; this is an encrypted file, not a database export. */
export function encryptBackup(plaintext: Buffer, key: Buffer): Buffer {
  checkKey(key);
  if (plaintext.length > MAX_BACKUP_BYTES)
    throw new Error('Backup exceeds the 64 MiB archive limit.');
  const iv = randomBytes(IV_BYTES);
  const header = Buffer.concat([MAGIC, iv]);
  const cipher = createCipheriv('aes-256-gcm', key, iv, {
    authTagLength: TAG_BYTES,
  });
  cipher.setAAD(header);
  const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return Buffer.concat([header, cipher.getAuthTag(), encrypted]);
}

/** Do not release plaintext until GCM authentication has succeeded. */
export function decryptBackup(archive: Buffer, key: Buffer): Buffer {
  checkKey(key);
  if (
    archive.length < HEADER_BYTES + TAG_BYTES ||
    archive.length > MAX_BACKUP_BYTES + HEADER_BYTES + TAG_BYTES ||
    !archive.subarray(0, MAGIC.length).equals(MAGIC)
  ) {
    throw new Error('Invalid or unsupported backup archive.');
  }
  const header = archive.subarray(0, HEADER_BYTES);
  const decipher = createDecipheriv(
    'aes-256-gcm',
    key,
    header.subarray(MAGIC.length),
    { authTagLength: TAG_BYTES },
  );
  decipher.setAAD(header);
  decipher.setAuthTag(archive.subarray(HEADER_BYTES, HEADER_BYTES + TAG_BYTES));
  const pending = decipher.update(archive.subarray(HEADER_BYTES + TAG_BYTES));
  try {
    const final = decipher.final();
    return Buffer.concat([pending, final]);
  } catch {
    throw new Error('Backup authentication failed. Check the key and archive.');
  } finally {
    pending.fill(0);
  }
}

export async function readBackupFile(
  path: string,
  maxBytes: number,
): Promise<Buffer> {
  const handle = await open(path, 'r');
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size > maxBytes)
      throw new Error('Input is not a regular file within the size limit.');
    // Read at most the limit plus one byte even if the input grows after stat.
    const chunks: Buffer[] = [];
    let bytes = 0;
    for await (const chunk of handle.createReadStream({
      autoClose: false,
      end: maxBytes,
    })) {
      const buffer = Buffer.from(chunk);
      bytes += buffer.length;
      if (bytes > maxBytes)
        throw new Error('Input exceeded the size limit while reading.');
      chunks.push(buffer);
    }
    return Buffer.concat(chunks);
  } finally {
    await handle.close();
  }
}

export async function openBackupFile(
  input: string,
  output: string,
  key: Buffer,
): Promise<void> {
  const archive = await readBackupFile(
    input,
    MAX_BACKUP_BYTES + HEADER_BYTES + TAG_BYTES,
  );
  const plaintext = decryptBackup(archive, key);
  try {
    await writeFile(output, plaintext, { flag: 'wx', mode: 0o600 });
  } finally {
    plaintext.fill(0);
  }
}

export async function sealBackupFile(
  input: string,
  output: string,
  key: Buffer,
): Promise<void> {
  const plaintext = await readBackupFile(input, MAX_BACKUP_BYTES);
  try {
    await writeFile(output, encryptBackup(plaintext, key), {
      flag: 'wx',
      mode: 0o600,
    });
  } finally {
    plaintext.fill(0);
  }
}
