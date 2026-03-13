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
    });
  }
  return _client;
}

/**
 * Upload a base64-encoded image to S3 and return the public URL.
 */
export async function uploadImageToS3(
  key: string,
  base64Data: string,
  contentType = "image/png"
): Promise<string> {
  const buffer = Buffer.from(base64Data, "base64");
  const s3 = getS3Client();

  await s3.send(
    new PutObjectCommand({
      Bucket: BUCKET,
      Key: key,
      Body: buffer,
      ContentType: contentType,
    })
  );

  return `https://${BUCKET}.s3.${REGION}.amazonaws.com/${key}`;
}
