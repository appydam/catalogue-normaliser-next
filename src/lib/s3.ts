import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";

let _client: S3Client | null = null;

const BUCKET = process.env.S3_BUCKET_NAME ?? "catalogai-product-images";
const REGION = process.env.AWS_REGION ?? "us-east-1";

export function getS3Client(): S3Client {
  if (!_client) {
    _client = new S3Client({
      region: REGION,
      credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
      },
      requestHandler: {
        requestTimeout: 15000,
        connectionTimeout: 5000,
      } as never,
    });
  }
  return _client;
}

/**
 * Upload a base64-encoded image to S3 and return the public URL.
 * P1-4: Retries once with 1s delay before throwing.
 */
export async function uploadImageToS3(
  key: string,
  base64Data: string,
  contentType = "image/png"
): Promise<string> {
  const buffer = Buffer.from(base64Data, "base64");
  const s3 = getS3Client();

  for (let attempt = 0; attempt < 2; attempt++) {
    const abortController = new AbortController();
    const timeout = setTimeout(() => abortController.abort(), 15000);

    try {
      await s3.send(
        new PutObjectCommand({
          Bucket: BUCKET,
          Key: key,
          Body: buffer,
          ContentType: contentType,
        }),
        { abortSignal: abortController.signal }
      );
      clearTimeout(timeout);
      return `https://${BUCKET}.s3.${REGION}.amazonaws.com/${key}`;
    } catch (err) {
      clearTimeout(timeout);
      if (attempt === 0) {
        await new Promise((r) => setTimeout(r, 1000));
        continue;
      }
      throw err;
    }
  }

  // Should never reach here, but TypeScript needs it
  throw new Error("S3 upload failed after retries");
}
