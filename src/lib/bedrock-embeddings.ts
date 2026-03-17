import {
  BedrockRuntimeClient,
  InvokeModelCommand,
} from "@aws-sdk/client-bedrock-runtime";

const REGION = process.env.AWS_REGION ?? "us-east-1";
const MODEL_ID = "amazon.titan-embed-image-v1";

let _client: BedrockRuntimeClient | null = null;

function getBedrockClient(): BedrockRuntimeClient {
  if (!_client) {
    _client = new BedrockRuntimeClient({
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
 * Generate a 1024-dim multimodal embedding from an image (+ optional text annotation).
 * Uses Amazon Titan Multimodal Embeddings G1 via AWS Bedrock.
 *
 * @param imageBase64 - Base64-encoded JPEG or PNG
 * @param textAnnotation - Optional text to combine with image (e.g. product name + cat_no)
 * @returns 1024-dimensional float vector
 */
export async function generateImageEmbedding(
  imageBase64: string,
  textAnnotation?: string
): Promise<number[]> {
  const client = getBedrockClient();

  const body: Record<string, unknown> = {
    embeddingConfig: { outputEmbeddingLength: 1024 },
    inputImage: imageBase64,
  };

  if (textAnnotation?.trim()) {
    // Titan supports up to 128 tokens of text — keep it concise
    body.inputText = textAnnotation.slice(0, 512);
  }

  const command = new InvokeModelCommand({
    modelId: MODEL_ID,
    contentType: "application/json",
    accept: "application/json",
    body: JSON.stringify(body),
  });

  const response = await client.send(command);
  const result = JSON.parse(Buffer.from(response.body).toString("utf-8"));

  if (!result.embedding || !Array.isArray(result.embedding)) {
    throw new Error("Titan embedding response missing 'embedding' field");
  }

  return result.embedding as number[];
}

/**
 * Format a float[] embedding as a PostgreSQL vector literal string.
 * e.g. "[0.1, 0.2, ...]"
 */
export function embeddingToSql(embedding: number[]): string {
  return `[${embedding.join(",")}]`;
}
