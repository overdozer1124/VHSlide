import { mkdir, readFile, writeFile, unlink } from "node:fs/promises";
import { join } from "node:path";
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

export function assetStorage(directory: string) {
  const names = [
    "BUCKET_ENDPOINT",
    "BUCKET_NAME",
    "BUCKET_ACCESS_KEY_ID",
    "BUCKET_SECRET_ACCESS_KEY",
  ];
  const configured = names.filter((key) => process.env[key]);
  if (configured.length && configured.length !== names.length)
    throw new Error("Bucketsの環境変数をすべて設定してください。");
  const bucket = process.env.BUCKET_NAME;
  const s3 = bucket
    ? new S3Client({
        endpoint: process.env.BUCKET_ENDPOINT,
        region: process.env.BUCKET_REGION || "auto",
        credentials: {
          accessKeyId: process.env.BUCKET_ACCESS_KEY_ID!,
          secretAccessKey: process.env.BUCKET_SECRET_ACCESS_KEY!,
        },
      })
    : undefined;
  return {
    kind: s3 ? "bucket" : "volume",
    async put(id: string, bytes: Uint8Array, mime: string) {
      if (s3)
        await s3.send(
          new PutObjectCommand({
            Bucket: bucket,
            Key: id,
            Body: bytes,
            ContentType: mime,
            CacheControl: "private, max-age=60",
          }),
        );
      else {
        await mkdir(directory, { recursive: true });
        await writeFile(join(directory, id), bytes, { flag: "wx" });
      }
    },
    async read(id: string): Promise<Uint8Array> {
      if (!s3) return readFile(join(directory, id));
      const result = await s3.send(
        new GetObjectCommand({ Bucket: bucket, Key: id }),
      );
      return (await result.Body?.transformToByteArray()) ?? new Uint8Array();
    },
    async url(id: string) {
      return s3
        ? getSignedUrl(s3, new GetObjectCommand({ Bucket: bucket, Key: id }), {
            expiresIn: 60,
          })
        : undefined;
    },
    async remove(id: string) {
      if (s3)
        await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: id }));
      else
        await unlink(join(directory, id)).catch(
          (error: NodeJS.ErrnoException) => {
            if (error.code !== "ENOENT") throw error;
          },
        );
    },
    close() {
      s3?.destroy();
    },
  };
}
