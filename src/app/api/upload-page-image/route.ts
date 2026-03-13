import { NextRequest, NextResponse } from "next/server";
import { uploadImageToS3 } from "@/lib/s3";

export const maxDuration = 30;

/**
 * POST /api/upload-page-image
 *
 * Accepts a single page image as base64 and uploads to S3.
 * Returns the public URL. This keeps the heavy base64 payload
 * on a dedicated route so schema/extract-chunk routes stay small.
 */
export async function POST(req: NextRequest) {
  try {
    const { key, image_base64, content_type } = (await req.json()) as {
      key: string;
      image_base64: string;
      content_type?: string;
    };

    if (!key || !image_base64) {
      return NextResponse.json({ error: "key and image_base64 are required" }, { status: 400 });
    }

    const url = await uploadImageToS3(key, image_base64, content_type ?? "image/png");
    return NextResponse.json({ url });
  } catch (err) {
    console.error("Upload page image error:", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
