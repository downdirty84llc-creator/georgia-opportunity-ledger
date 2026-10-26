import { createHash } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createBouncerScan,
  uploadBouncerFile,
  pollBouncerScan,
} from '@/lib/files/bouncer';
import {
  processBouncerTask,
  type BouncerTask,
  type BouncerStore,
} from '@/lib/files/bouncer-worker';
import {
  scannerConfigurationCheck,
  scannerReadinessChecks,
} from '../../../scripts/scanner-readiness';

const bytes = new TextEncoder().encode('Synthetic scanner fixture.');
const file = {
  size: bytes.length,
  sha256: createHash('sha256').update(bytes).digest('hex'),
};
const key = 'bnc_live_test_only';
const id = 'scan_test_123';
const api = vi.fn<typeof fetch>();
const signal = () => AbortSignal.timeout(5000);
const ticket = () => ({
  scan_id: id,
  max_file_size: 26_214_400,
  upload: {
    url: 'https://bouncer-dev-uploads-test.s3.amazonaws.com/',
    fields: { key: 'uploads/test', policy: 'secret-policy' },
  },
});
const verdict = () => ({
  scan_id: id,
  status: 'completed',
  verdict: 'clean',
  file,
  threats: [],
  engines: { signature: { result: 'clean' }, pattern: { result: 'clean' } },
});
const response = (data: unknown, status = 200) =>
  Response.json({ status: 'success', data }, { status });
let events: string[];
let store: BouncerStore;
let task: BouncerTask;
beforeEach(() => {
  events = [];
  vi.stubGlobal('fetch', api);
  api.mockReset();
  api.mockImplementation(async (url, options) => {
    if (String(url).includes('.s3.')) {
      events.push('upload');
      return new Response(null, { status: 204 });
    }
    if (options?.method === 'POST') {
      events.push('create');
      return response(ticket(), 201);
    }
    events.push('poll');
    return response(verdict());
  });
  task = {
    attachment_id: 'attachment-test',
    file_path: 'reports/test/file.pdf',
    checksum: file.sha256,
    file_size: file.size,
    phase: 'ready',
    provider_scan_id: null,
    created_at: new Date().toISOString(),
  };
  store = {
    download: vi.fn(async () => {
      events.push('download');
      return bytes;
    }),
    begin: vi.fn(async () => {
      events.push('begin');
    }),
    checkpoint: vi.fn(async () => {
      events.push('checkpoint');
    }),
    finish: vi.fn(async (action) => {
      events.push(action);
    }),
    remove: vi.fn(async () => {
      events.push('remove');
    }),
  };
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('Bouncer transport boundaries', () => {
  it('refuses a substituted upload destination even after ticket creation', async () => {
    await expect(
      uploadBouncerFile(
        { id, uploadUrl: 'https://evil.test/', fields: {} },
        bytes,
        signal(),
      ),
    ).rejects.toThrow();
    expect(api).not.toHaveBeenCalled();
  });
  it('honors cancellation without reflecting raw transport data', async () => {
    api.mockImplementation(
      async (_url, options) =>
        new Promise((_resolve, reject) => {
          options?.signal?.addEventListener(
            'abort',
            () => reject(new Error('private URL')),
            { once: true },
          );
        }),
    );
    await expect(
      pollBouncerScan(key, id, file, AbortSignal.timeout(10)),
    ).rejects.toThrow('Scanner request did not complete');
  });
  it('uses v2 and a generic filename without private metadata', async () => {
    const created = await createBouncerScan(key, file, signal());
    await uploadBouncerFile(created, bytes, signal());
    expect(api.mock.calls[0]![0]).toBe('https://api.usebouncer.dev/v2/scan');
    expect(api.mock.calls[0]![1]?.body).toBe(
      JSON.stringify({
        file_name: 'attachment.bin',
        mime_type: 'application/octet-stream',
      }),
    );
    expect(api.mock.calls[0]![1]?.headers).toMatchObject({ 'X-API-Key': key });
    const storage = api.mock.calls[1]![1]!;
    expect(storage.headers).toBeUndefined();
    expect(storage.redirect).toBe('error');
    const form = storage.body as FormData;
    expect([...form.keys()]).toEqual(['key', 'policy', 'file']);
    expect(Buffer.from(await (form.get('file') as File).arrayBuffer())).toEqual(
      Buffer.from(bytes),
    );
  });
  it.each([
    'http://bouncer-dev-uploads-test.s3.amazonaws.com/',
    'https://evil.test/',
    'https://bouncer-dev-uploads-test.s3.amazonaws.com.evil.test/',
    'https://bouncer-dev-uploads-test.s3.amazonaws.com/?credential=secret',
    'https://user:secret@bouncer-dev-uploads-test.s3.amazonaws.com/',
    'https://bouncer-dev-uploads-test.s3.amazonaws.com/not-root',
  ])('refuses an unsafe upload destination %s', async (url) => {
    const data = ticket();
    data.upload.url = url;
    api.mockResolvedValue(response(data, 201));
    await expect(createBouncerScan(key, file, signal())).rejects.toThrow();
    expect(api).toHaveBeenCalledTimes(1);
  });
  it.each([401, 403, 404, 429, 500])(
    'refuses HTTP %s without reflecting provider text',
    async (status) => {
      api.mockResolvedValue(new Response('secret provider error', { status }));
      await expect(pollBouncerScan(key, id, file, signal())).rejects.toThrow(
        /attachment|review/,
      );
    },
  );
  it('rejects oversized and malformed responses', async () => {
    api.mockResolvedValue(new Response(' '.repeat(17000)));
    await expect(pollBouncerScan(key, id, file, signal())).rejects.toThrow();
    api.mockResolvedValue(new Response('private raw parser error'));
    await expect(pollBouncerScan(key, id, file, signal())).rejects.toThrow(
      'Scanner request did not complete',
    );
  });
  it.each(['hash', 'size', 'id', 'engine', 'threats', 'verdict', 'status'])(
    'does not clear a file with inconsistent %s',
    async (kind) => {
      const data = verdict();
      if (kind === 'hash') data.file = { ...file, sha256: '0'.repeat(64) };
      if (kind === 'size') data.file = { ...file, size: 99 };
      if (kind === 'id') data.scan_id = 'scan_different';
      if (kind === 'engine') data.engines.signature.result = 'failed';
      if (kind === 'threats')
        Object.assign(data, { threats: [{ name: 'hit' }] });
      if (kind === 'verdict') data.verdict = 'unknown';
      if (kind === 'status') data.status = 'unknown';
      api.mockResolvedValue(response(data));
      await expect(pollBouncerScan(key, id, file, signal())).rejects.toThrow();
    },
  );
  it.each(['pending', 'scanning'])(
    'keeps %s results unavailable',
    async (status) => {
      api.mockResolvedValue(response({ scan_id: id, status }));
      expect((await pollBouncerScan(key, id, file, signal())).verdict).toBe(
        'pending',
      );
    },
  );
  it('holds suspicious files without deleting them as confirmed malware', async () => {
    api.mockResolvedValue(response({ ...verdict(), verdict: 'suspicious' }));
    expect((await pollBouncerScan(key, id, file, signal())).verdict).toBe(
      'failed',
    );
  });
  it('refuses invalid IDs, oversized files and credentials before network access', async () => {
    await expect(
      pollBouncerScan(key, '../usage', file, signal()),
    ).rejects.toThrow();
    await expect(
      createBouncerScan(key, { ...file, size: 26_214_401 }, signal()),
    ).rejects.toThrow();
    await expect(createBouncerScan('wrong', file, signal())).rejects.toThrow();
    expect(api).not.toHaveBeenCalled();
  });
});

describe('durable Bouncer worker', () => {
  it.each([401, 429])(
    'requires review for provider HTTP %s without resubmission',
    async (status) => {
      api.mockResolvedValue(new Response('private response', { status }));
      expect(await processBouncerTask(task, store, key, signal())).toBe(
        'failed',
      );
      expect(api).toHaveBeenCalledTimes(1);
      expect(store.finish).toHaveBeenLastCalledWith(
        'failed',
        expect.not.stringContaining('private'),
      );
    },
  );
  it('checkpoints before upload and only records a matching clean result', async () => {
    expect(await processBouncerTask(task, store, key, signal())).toBe('clean');
    expect(events).toEqual([
      'download',
      'begin',
      'create',
      'checkpoint',
      'upload',
      'poll',
      'clean',
    ]);
    expect(store.checkpoint).toHaveBeenCalledWith(id);
    expect(store.finish).toHaveBeenLastCalledWith('clean', null);
  });
  it('polls saved IDs after a restart without another upload or credit', async () => {
    task.phase = 'polling';
    task.provider_scan_id = id;
    expect(await processBouncerTask(task, store, key, signal())).toBe('clean');
    expect(events).toEqual(['poll', 'clean']);
  });
  it('does not repeat an uncertain creation', async () => {
    task.phase = 'requesting';
    expect(await processBouncerTask(task, store, key, signal())).toBe('failed');
    expect(api).not.toHaveBeenCalled();
    expect(store.finish).toHaveBeenCalledWith(
      'failed',
      expect.stringContaining('uncertain'),
    );
  });
  it('does not upload if the ID checkpoint fails', async () => {
    store.checkpoint = vi
      .fn()
      .mockRejectedValue(new Error('private database error'));
    expect(await processBouncerTask(task, store, key, signal())).toBe('failed');
    expect(api).toHaveBeenCalledTimes(1);
    expect(store.finish).toHaveBeenLastCalledWith(
      'failed',
      expect.not.stringContaining('private'),
    );
  });
  it('retains a saved ID after an upload timeout', async () => {
    api.mockImplementation(async (url, options) => {
      if (options?.method === 'POST' && String(url).includes('/v2/scan'))
        return response(ticket(), 201);
      throw new DOMException('secret upload signature', 'AbortError');
    });
    expect(await processBouncerTask(task, store, key, signal())).toBe(
      'pending',
    );
    expect(store.checkpoint).toHaveBeenCalledWith(id);
    expect(store.finish).toHaveBeenLastCalledWith(
      'pending',
      expect.not.stringContaining('secret'),
    );
  });
  it('does not spend quota when the stored bytes have changed', async () => {
    store.download = vi.fn().mockResolvedValue(new Uint8Array([1, 2]));
    expect(await processBouncerTask(task, store, key, signal())).toBe('failed');
    expect(api).not.toHaveBeenCalled();
    expect(store.begin).not.toHaveBeenCalled();
  });
  it('can retry a failed download before any provider creation', async () => {
    store.download = vi.fn().mockRejectedValue(new Error('private URL'));
    expect(await processBouncerTask(task, store, key, signal())).toBe('failed');
    expect(store.finish).toHaveBeenCalledWith('retry', expect.any(String));
    expect(api).not.toHaveBeenCalled();
  });
  it('records quarantine before deleting infected bytes', async () => {
    task.phase = 'polling';
    task.provider_scan_id = id;
    api.mockResolvedValue(response({ ...verdict(), verdict: 'malicious' }));
    expect(await processBouncerTask(task, store, key, signal())).toBe(
      'infected',
    );
    expect(events).toEqual(['infected', 'remove', 'removed']);
  });
  it('never deletes bytes when quarantine could not be recorded', async () => {
    task.phase = 'polling';
    task.provider_scan_id = id;
    api.mockResolvedValue(response({ ...verdict(), verdict: 'malicious' }));
    store.finish = vi.fn().mockRejectedValue(new Error('lease lost'));
    await expect(
      processBouncerTask(task, store, key, signal()),
    ).rejects.toThrow();
    expect(store.remove).not.toHaveBeenCalled();
  });
  it('retries quarantined object removal without a provider call', async () => {
    task.phase = 'quarantined';
    task.provider_scan_id = id;
    expect(await processBouncerTask(task, store, key, signal())).toBe(
      'infected',
    );
    expect(events).toEqual(['remove', 'removed']);
    expect(api).not.toHaveBeenCalled();
  });
  it('keeps a saved ID when polling is temporarily unavailable', async () => {
    task.phase = 'polling';
    task.provider_scan_id = id;
    api.mockResolvedValue(new Response('unavailable', { status: 500 }));
    expect(await processBouncerTask(task, store, key, signal())).toBe(
      'pending',
    );
    expect(store.finish).toHaveBeenCalledWith('pending', expect.any(String));
  });
  it('does not recreate a missing scan', async () => {
    task.phase = 'polling';
    task.provider_scan_id = id;
    api.mockResolvedValue(new Response('missing', { status: 404 }));
    expect(await processBouncerTask(task, store, key, signal())).toBe('failed');
    expect(api).toHaveBeenCalledTimes(1);
    expect(api.mock.calls[0]![1]?.method).not.toBe('POST');
  });
  it('stops expired tasks without another provider call', async () => {
    task.created_at = new Date(Date.now() - 26 * 60 * 60_000).toISOString();
    expect(await processBouncerTask(task, store, key, signal())).toBe('failed');
    expect(api).not.toHaveBeenCalled();
  });
});

describe('Bouncer readiness', () => {
  it('rejects an absent key and recognizes the asynchronous configuration', () => {
    expect(scannerConfigurationCheck('bouncer', '', true, '').status).toBe(
      'fail',
    );
    expect(scannerConfigurationCheck('bouncer', '', true, key).status).toBe(
      'pass',
    );
  });
  it('uses both controls and refuses an always-clean service', async () => {
    let uploaded: Uint8Array = bytes;
    api.mockImplementation(async (url, options) => {
      if (String(url).includes('.s3.')) {
        uploaded = new Uint8Array(
          await ((options?.body as FormData).get('file') as File).arrayBuffer(),
        );
        return new Response(null, { status: 204 });
      }
      if (options?.method === 'POST') return response(ticket(), 201);
      return response({
        ...verdict(),
        file: {
          size: uploaded.length,
          sha256: createHash('sha256').update(uploaded).digest('hex'),
        },
      });
    });
    const checks = await scannerReadinessChecks(
      scannerConfigurationCheck('bouncer', '', true, key),
      { provider: 'bouncer', url: '', apiKey: key, timeoutMs: 1000 },
    );
    expect(checks.clean.status).toBe('pass');
    expect(checks.eicar.status).toBe('fail');
    expect(
      api.mock.calls.filter(([, options]) => options?.method === 'POST'),
    ).toHaveLength(4);
  });
});
