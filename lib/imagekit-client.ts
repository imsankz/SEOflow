/**
 * ImageKit CDN upload client.
 *
 * Optional — only used when `imageKit` is set in seoflow.config.json.
 * Downloads a source image (Pexels/Unsplash URL) and re-uploads it to
 * ImageKit so posts serve from the site's own CDN instead of hotlinking.
 */
import https from 'https';
import { getImageKitConfig } from './config';

export function hasImageKit(): boolean {
  const cfg = getImageKitConfig();
  if (!cfg) return false;
  const key = process.env[cfg.privateKeyEnv || 'IMAGEKIT_PRIVATE_KEY'];
  return !!key;
}

function download(url: string): Promise<Buffer | null> {
  return new Promise((resolve) => {
    const req = https.get(url, (res) => {
      if (res.statusCode && res.statusCode >= 400) return resolve(null);
      const chunks: Buffer[] = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks)));
    });
    req.on('error', () => resolve(null));
    req.setTimeout(10000, () => { req.destroy(); resolve(null); });
  });
}

/**
 * Download `sourceUrl` and upload it to ImageKit under the configured folder.
 * Returns the ImageKit CDN URL, or null if not configured / upload failed.
 */
export async function uploadToImageKit(sourceUrl: string, fileName: string): Promise<string | null> {
  const cfg = getImageKitConfig();
  if (!cfg) return null;
  const privateKey = process.env[cfg.privateKeyEnv || 'IMAGEKIT_PRIVATE_KEY'];
  if (!privateKey) return null;

  const buffer = await download(sourceUrl);
  if (!buffer) return null;

  const boundary = `----seoflow${Date.now().toString(36)}`;
  const folder = cfg.folder || '/blog';
  const parts: Buffer[] = [];

  const field = (name: string, value: string) =>
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`);

  parts.push(field('fileName', fileName));
  parts.push(field('folder', folder));
  parts.push(field('useUniqueFileName', 'true'));
  parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${fileName}"\r\nContent-Type: application/octet-stream\r\n\r\n`));
  parts.push(buffer);
  parts.push(Buffer.from(`\r\n--${boundary}--\r\n`));

  const body = Buffer.concat(parts);
  const auth = Buffer.from(`${privateKey}:`).toString('base64');

  return new Promise((resolve) => {
    const req = https.request(
      {
        hostname: 'upload.imagekit.io',
        path: '/api/v1/files/upload',
        method: 'POST',
        headers: {
          Authorization: `Basic ${auth}`,
          'Content-Type': `multipart/form-data; boundary=${boundary}`,
          'Content-Length': body.length,
        },
      },
      (res) => {
        let data = '';
        res.on('data', (d) => (data += d));
        res.on('end', () => {
          try {
            const json = JSON.parse(data);
            resolve(json.url || null);
          } catch {
            resolve(null);
          }
        });
      }
    );
    req.on('error', () => resolve(null));
    req.setTimeout(15000, () => { req.destroy(); resolve(null); });
    req.write(body);
    req.end();
  });
}
