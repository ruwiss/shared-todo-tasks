import { createHash, randomUUID } from 'node:crypto';

interface UploadResult {
  url: string;
  shareUrl: string;
}

const PRNTSCR_SECRET = '5CE3DF4D45AC*';
const UPLOAD_USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

export class ImageUploadService {
  public async uploadImage(dataUrl: string): Promise<UploadResult> {
    const { buffer, mimeType } = parseImageDataUrl(dataUrl);
    const timestamp = Math.floor(Date.now() / 1000);
    const hash = createHash('md5').update(`${PRNTSCR_SECRET}${timestamp}`).digest('hex');
    const appId = randomUUID();
    const dimensions = readPngDimensions(buffer);
    const formData = new FormData();

    formData.append('width', String(dimensions.width));
    formData.append('height', String(dimensions.height));
    formData.append('dpi', '1.000000');
    formData.append('app_id', appId);
    const imageBytes = new Uint8Array(buffer);
    formData.append('image', new Blob([imageBytes], { type: mimeType }), `todo-image.${extensionFromMime(mimeType)}`);

    const uploadUrl = `https://upload.prntscr.com/upload/${timestamp}/${hash}/`;
    const response = await fetch(uploadUrl, {
      method: 'POST',
      body: formData,
    });
    const responseText = await response.text();
    const statusMatch = responseText.match(/<status>(\w+)<\/status>/);
    const shareMatch = responseText.match(/<share>([^<]+)<\/share>/);

    if (statusMatch?.[1] !== 'success' || !shareMatch?.[1]) {
      const errorMatch = responseText.match(/<error>([^<]+)<\/error>/);
      throw new Error(errorMatch?.[1] ?? 'Image could not be uploaded.');
    }

    const shareUrl = shareMatch[1];

    try {
      const pageResponse = await fetch(shareUrl, {
        headers: { 'User-Agent': UPLOAD_USER_AGENT },
      });
      const html = await pageResponse.text();
      const imageUrl = extractImageUrl(html);

      return {
        url: imageUrl ?? shareUrl,
        shareUrl,
      };
    } catch {
      return {
        url: shareUrl,
        shareUrl,
      };
    }
  }
}

function parseImageDataUrl(dataUrl: string): { buffer: Buffer; mimeType: string } {
  const match = dataUrl.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/);

  if (!match) {
    throw new Error('Invalid image data.');
  }

  return {
    mimeType: match[1],
    buffer: Buffer.from(match[2], 'base64'),
  };
}

function readPngDimensions(buffer: Buffer): { width: number; height: number } {
  if (buffer.length < 24 || buffer.toString('ascii', 1, 4) !== 'PNG') {
    return { width: 1, height: 1 };
  }

  return {
    width: buffer.readUInt32BE(16),
    height: buffer.readUInt32BE(20),
  };
}

function extensionFromMime(mimeType: string): string {
  if (mimeType.includes('jpeg')) {
    return 'jpg';
  }

  if (mimeType.includes('webp')) {
    return 'webp';
  }

  return 'png';
}

function extractImageUrl(html: string): string | undefined {
  const imgMatch = html.match(/<img[^>]*class="[^"]*screenshot-image[^"]*"[^>]*src="([^"]+)"/);
  const imgMatchAlt = html.match(/<img[^>]*src="([^"]+)"[^>]*class="[^"]*screenshot-image[^"]*"/);
  const imgMatchData = html.match(/<img[^>]*class="[^"]*screenshot-image[^"]*"[^>]*data-src="([^"]+)"/);
  return imgMatch?.[1] || imgMatchAlt?.[1] || imgMatchData?.[1];
}
