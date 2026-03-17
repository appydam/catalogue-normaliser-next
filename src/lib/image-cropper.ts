import sharp from "sharp";
import { GetObjectCommand } from "@aws-sdk/client-s3";
import { getS3Client } from "./s3";

const BUCKET = process.env.S3_BUCKET_NAME ?? "catalogai-product-images";

export interface BoundingBox {
  x: number; // 0-1 from left
  y: number; // 0-1 from top
  w: number; // 0-1 width
  h: number; // 0-1 height
}

/**
 * Fetch a page PNG from S3 and return as a Buffer.
 */
export async function fetchPageFromS3(s3Key: string): Promise<Buffer> {
  const s3 = getS3Client();
  const response = await s3.send(
    new GetObjectCommand({ Bucket: BUCKET, Key: s3Key })
  );
  const chunks: Uint8Array[] = [];
  for await (const chunk of response.Body as AsyncIterable<Uint8Array>) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

/**
 * Extract the S3 key from a full S3 URL.
 */
export function s3UrlToKey(url: string): string {
  // https://bucket.s3.region.amazonaws.com/key/path
  const match = url.match(/amazonaws\.com\/(.+)$/);
  if (!match) throw new Error(`Cannot parse S3 key from URL: ${url}`);
  return match[1];
}

/**
 * Crop a region from an image buffer using bounding box percentages.
 * Adds 5% padding on each side (clamped to image bounds).
 */
export async function cropProduct(
  pageBuffer: Buffer,
  bbox: BoundingBox
): Promise<Buffer> {
  const meta = await sharp(pageBuffer).metadata();
  const imgW = meta.width ?? 1200;
  const imgH = meta.height ?? 1600;

  // Add 3% padding
  const pad = 0.03;
  const x = Math.max(0, bbox.x - pad);
  const y = Math.max(0, bbox.y - pad);
  const w = Math.min(1 - x, bbox.w + pad * 2);
  const h = Math.min(1 - y, bbox.h + pad * 2);

  const left = Math.round(x * imgW);
  const top = Math.round(y * imgH);
  const width = Math.max(10, Math.round(w * imgW));
  const height = Math.max(10, Math.round(h * imgH));

  return sharp(pageBuffer)
    .extract({ left, top, width, height })
    .jpeg({ quality: 85 })
    .toBuffer();
}

/**
 * Convert a Buffer to base64 string.
 */
export function bufferToBase64(buf: Buffer): string {
  return buf.toString("base64");
}
