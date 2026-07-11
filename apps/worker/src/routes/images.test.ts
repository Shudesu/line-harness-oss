import { describe, expect, test, vi } from 'vitest';
import { Hono } from 'hono';
import { images } from './images.js';

function setupApp() {
  const put = vi.fn().mockResolvedValue(undefined);
  const app = new Hono();
  app.route('/', images);
  return { app, put };
}

describe('POST /api/images', () => {
  test('allows PDF and keeps the response shape and original filename', async () => {
    const { app, put } = setupApp();
    const response = await app.request('/api/images', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        data: btoa('pdf-data'),
        mimeType: 'application/pdf',
        filename: 'resume.pdf',
      }),
    }, {
      IMAGES: { put },
      WORKER_URL: 'https://worker.example.com',
    });

    expect(response.status).toBe(201);
    const body = await response.json() as {
      success: boolean;
      data: { id: string; key: string; url: string; mimeType: string; size: number };
    };
    expect(body).toEqual({
      success: true,
      data: {
        id: expect.any(String),
        key: expect.stringMatching(/^outgoing-[0-9a-f-]+\.pdf$/),
        url: expect.stringMatching(/^https:\/\/worker\.example\.com\/images\/outgoing-[0-9a-f-]+\.pdf$/),
        mimeType: 'application/pdf',
        size: 8,
      },
    });
    expect(put).toHaveBeenCalledWith(
      body.data.key,
      expect.any(ArrayBuffer),
      {
        httpMetadata: { contentType: 'application/pdf' },
        customMetadata: { originalFilename: 'resume.pdf' },
      },
    );
  });

  test('rejects a disallowed mime type', async () => {
    const { app, put } = setupApp();
    const response = await app.request('/api/images', {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: 'not-media',
    }, { IMAGES: { put } });

    expect(response.status).toBe(400);
    expect(put).not.toHaveBeenCalled();
  });

  test('uses the outgoing key format for existing image types', async () => {
    const { app, put } = setupApp();
    const response = await app.request('/api/images', {
      method: 'POST',
      headers: { 'Content-Type': 'image/jpeg' },
      body: new Uint8Array([1, 2, 3]),
    }, { IMAGES: { put } });

    expect(response.status).toBe(201);
    expect(put).toHaveBeenCalledWith(
      expect.stringMatching(/^outgoing-[0-9a-f-]+\.jpg$/),
      expect.any(ArrayBuffer),
      expect.any(Object),
    );
  });
});
