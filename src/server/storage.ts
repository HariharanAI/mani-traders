/**
 * File storage for attachments, product images, logos and generated PDFs.
 * STORAGE_DRIVER=local (default, ./storage) or s3 (any S3-compatible service:
 * AWS S3, Cloudflare R2, MinIO, DigitalOcean Spaces...).
 */
import path from "node:path";
import fs from "node:fs/promises";

const ALLOWED: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "application/pdf": "pdf",
};
export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;

function localDir() {
  return path.resolve(process.env.STORAGE_LOCAL_DIR || "./storage");
}

let s3Client: unknown = null;
async function s3() {
  if (!s3Client) {
    const { S3Client } = await import("@aws-sdk/client-s3");
    s3Client = new S3Client({
      region: process.env.S3_REGION || "ap-south-1",
      endpoint: process.env.S3_ENDPOINT || undefined,
      forcePathStyle: process.env.S3_FORCE_PATH_STYLE === "true",
      credentials: { accessKeyId: process.env.S3_ACCESS_KEY_ID || "", secretAccessKey: process.env.S3_SECRET_ACCESS_KEY || "" },
    });
  }
  return s3Client as import("@aws-sdk/client-s3").S3Client;
}
const useS3 = () => process.env.STORAGE_DRIVER === "s3";

/** Detects the real type from magic bytes (never trust the browser's content-type). */
export function sniffType(buf: Buffer): string | null {
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "image/jpeg";
  if (buf.length >= 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (buf.length >= 12 && buf.subarray(0, 4).toString() === "RIFF" && buf.subarray(8, 12).toString() === "WEBP") return "image/webp";
  if (buf.length >= 5 && buf.subarray(0, 5).toString() === "%PDF-") return "application/pdf";
  return null;
}

function safeKey(key: string) {
  if (!/^[a-z0-9/_.-]+$/i.test(key) || key.includes("..")) throw new Error("Invalid storage key");
  return key;
}

export async function putFile(folder: string, buf: Buffer, opts: { key?: string; contentType?: string } = {}): Promise<string> {
  const type = opts.contentType ?? sniffType(buf);
  if (!type || !ALLOWED[type]) throw new Error("Only JPG, PNG, WEBP images and PDF files are allowed.");
  if (buf.length > MAX_UPLOAD_BYTES) throw new Error("File is larger than 5 MB.");
  const key = safeKey(opts.key ?? `${folder}/${new Date().toISOString().slice(0, 7)}/${crypto.randomUUID()}.${ALLOWED[type]}`);
  if (useS3()) {
    const { PutObjectCommand } = await import("@aws-sdk/client-s3");
    await (await s3()).send(new PutObjectCommand({ Bucket: process.env.S3_BUCKET!, Key: key, Body: buf, ContentType: type }));
  } else {
    const full = path.join(localDir(), key);
    await fs.mkdir(path.dirname(full), { recursive: true });
    await fs.writeFile(full, buf);
  }
  return key;
}

export async function getFile(key: string): Promise<{ body: Buffer; contentType: string } | null> {
  safeKey(key);
  try {
    let body: Buffer;
    if (useS3()) {
      const { GetObjectCommand } = await import("@aws-sdk/client-s3");
      const res = await (await s3()).send(new GetObjectCommand({ Bucket: process.env.S3_BUCKET!, Key: key }));
      body = Buffer.from(await res.Body!.transformToByteArray());
    } else {
      body = await fs.readFile(path.join(localDir(), key));
    }
    return { body, contentType: sniffType(body) ?? "application/octet-stream" };
  } catch {
    return null;
  }
}
