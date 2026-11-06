/**
 * File storage for attachments, product images, logos and generated PDFs.
 *
 *  - Production (Vercel): private Vercel Blob store — used automatically when
 *    BLOB_READ_WRITE_TOKEN is set (Vercel adds it when you create a Blob store).
 *  - Local development: ./storage on disk (STORAGE_LOCAL_DIR).
 *
 * Files are never public: they are served only through the authenticated
 * /api/files route.
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

const useBlob = () => !!process.env.BLOB_READ_WRITE_TOKEN;

export function storageDriverName() {
  return useBlob() ? "Vercel Blob (private)" : "Local disk";
}

function localPath(key: string) {
  if (process.env.VERCEL) throw new Error("File storage is not configured. Create a Blob store in Vercel (Storage → Blob) and redeploy.");
  return path.join(/*turbopackIgnore: true*/ path.resolve(/*turbopackIgnore: true*/ process.env.STORAGE_LOCAL_DIR || "./storage"), key);
}

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
  if (useBlob()) {
    const { put } = await import("@vercel/blob");
    await put(key, buf, { access: "private", contentType: type, addRandomSuffix: false, allowOverwrite: true });
  } else {
    const full = localPath(key);
    await fs.mkdir(/*turbopackIgnore: true*/ path.dirname(full), { recursive: true });
    await fs.writeFile(/*turbopackIgnore: true*/ full, buf);
  }
  return key;
}

export async function getFile(key: string): Promise<{ body: Buffer; contentType: string } | null> {
  safeKey(key);
  try {
    let body: Buffer;
    if (useBlob()) {
      const { get } = await import("@vercel/blob");
      const res = await get(key, { access: "private", useCache: false });
      if (!res || !res.stream) return null;
      body = Buffer.from(await new Response(res.stream).arrayBuffer());
    } else {
      body = await fs.readFile(/*turbopackIgnore: true*/ localPath(key));
    }
    return { body, contentType: sniffType(body) ?? "application/octet-stream" };
  } catch {
    return null;
  }
}
