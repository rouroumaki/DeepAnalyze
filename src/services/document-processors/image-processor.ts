// =============================================================================
// DeepAnalyze - Image Processor
// Uses Sharp for metadata/EXIF extraction and thumbnail generation,
// VLM (vision language model) for image description, and Docling for
// optional OCR text extraction. Combines all outputs into ParsedContent.
// =============================================================================

import { readFileSync, mkdirSync } from "node:fs";
import { extname, join } from "node:path";
import sharp from "sharp";
import type { DocumentProcessor, ParsedContent } from "./types.js";
import type { ImageRawData } from "./modality-types.js";
import { DocTagsFormatters } from "./modality-types.js";
import { ModelRouter } from "../../models/router.js";

export class ImageProcessor implements DocumentProcessor {
  private static readonly HANDLED_TYPES = new Set([
    "png", "jpg", "jpeg", "gif", "bmp", "tiff", "tif", "webp", "svg", "image",
  ]);

  canHandle(fileType: string): boolean {
    return ImageProcessor.HANDLED_TYPES.has(fileType);
  }

  getStepLabel(): string {
    return "image_understanding";
  }

  async parse(filePath: string, options?: Record<string, unknown>): Promise<ParsedContent> {
    // ---- Read image buffer ----
    let imageBuffer: Buffer;
    try {
      imageBuffer = readFileSync(filePath);
    } catch (err) {
      return {
        text: "",
        metadata: { sourceType: "image" },
        success: false,
        error: `Failed to read image: ${err instanceof Error ? err.message : String(err)}`,
      };
    }

    const ext = extname(filePath).slice(1).toLowerCase();
    const mimeTypeMap: Record<string, string> = {
      png: "image/png",
      jpg: "image/jpeg",
      jpeg: "image/jpeg",
      gif: "image/gif",
      bmp: "image/bmp",
      tiff: "image/tiff",
      tif: "image/tiff",
      webp: "image/webp",
      svg: "image/svg+xml",
    };
    const mimeType = mimeTypeMap[ext] ?? "image/png";
    const base64 = imageBuffer.toString("base64");

    // ---- Sharp metadata + EXIF extraction ----
    let width: number | undefined;
    let height: number | undefined;
    let format: string | undefined;
    let exif: ImageRawData["exif"];

    try {
      const meta = await sharp(imageBuffer).metadata();
      width = meta.width;
      height = meta.height;
      format = meta.format ?? ext;

      // Parse EXIF from the raw buffer that Sharp provides
      if (meta.exif && Buffer.isBuffer(meta.exif)) {
        exif = this.parseExifBuffer(meta.exif);
      }
    } catch (err) {
      // Sharp can fail on SVG or corrupted files -- continue without metadata
      console.warn(
        `[ImageProcessor] Sharp metadata extraction failed for ${filePath}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      format = ext;
    }

    // ---- Thumbnail generation ----
    const kbId = options?.kbId as string | undefined;
    const docId = options?.docId as string | undefined;
    const wikiDir = options?.wikiDir as string | undefined;
    let thumbnailPath: string | undefined;

    if (wikiDir && kbId && docId) {
      try {
        const thumbDir = join(wikiDir, kbId, "documents", docId);
        mkdirSync(thumbDir, { recursive: true });
        const thumbFilePath = join(thumbDir, "thumb.webp");
        await sharp(imageBuffer)
          .resize(400, undefined, { withoutEnlargement: true })
          .webp({ quality: 80 })
          .toFile(thumbFilePath);
        thumbnailPath = thumbFilePath;
      } catch (err) {
        // Best-effort: thumbnail generation failure is non-blocking
        console.warn(
          `[ImageProcessor] Thumbnail generation failed: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }
    }

    // ---- VLM description ----
    let description = "";

    try {
      const router = new ModelRouter();
      await router.initialize();

      const vlmModel = router.getDefaultModel("vlm");

      if (vlmModel) {
        const result = await router.chat(
          [
            {
              role: "user",
              content: [
                {
                  type: "text",
                  text: "详细描述这张图片的内容，包括：场景、人物、文字、数据、关键元素。",
                },
                {
                  type: "image_url",
                  image_url: { url: `data:${mimeType};base64,${base64}` },
                },
              ],
            },
          ],
          { model: vlmModel },
        );
        description = result.content;
      } else {
        description = "[未配置VLM模型，跳过图像描述]";
      }
    } catch (err) {
      description = `[VLM不可用: ${err instanceof Error ? err.message : String(err)}]`;
    }

    // ---- OCR via Docling (best-effort, non-blocking) ----
    let ocrText = "";
    try {
      const { parseDocumentFile } = await import(
        "../../server/routes/knowledge.js"
      );
      ocrText = await parseDocumentFile(filePath, "image");
    } catch {
      ocrText = "";
    }

    // ---- Build combined text output ----
    const combinedText = `## 图像内容描述\n${description}\n\n## OCR提取文字\n${
      ocrText || "[无OCR文字]"
    }`;

    // ---- Build ImageRawData ----
    const imageRaw: ImageRawData = {
      description,
      ocrText: ocrText || undefined,
      width,
      height,
      format,
      exif,
      thumbnailPath,
    };

    return {
      text: combinedText,
      metadata: {
        sourceType: "image",
        hasOcrText: ocrText.length > 0,
        ...(width ? { width } : {}),
        ...(height ? { height } : {}),
        ...(format ? { format } : {}),
      },
      success: true,
      raw: imageRaw as unknown as Record<string, unknown>,
      doctags: DocTagsFormatters.image(imageRaw),
      modality: "image",
    };
  }

  // -----------------------------------------------------------------------
  // Internal - EXIF parsing from raw buffer
  // -----------------------------------------------------------------------

  /**
   * Parse a raw EXIF buffer (as returned by Sharp metadata.exif) and
   * extract common fields into our typed ImageRawData.exif structure.
   *
   * The buffer starts with "Exif\x00\x00" followed by TIFF data.
   * We do a lightweight parse of IFD0 and EXIF-IFD entries.
   */
  private parseExifBuffer(buf: Buffer): ImageRawData["exif"] | undefined {
    try {
      // Validate EXIF header: "Exif\x00\x00"
      if (buf.length < 14) return undefined;
      const header = buf.toString("ascii", 0, 4);
      if (header !== "Exif") return undefined;

      const tiffOffset = 6;
      // Read byte order
      const byteOrder = buf.toString("ascii", tiffOffset, tiffOffset + 2);
      const littleEndian = byteOrder === "II";

      const read16 = (offset: number): number =>
        littleEndian ? buf.readUInt16LE(offset) : buf.readUInt16BE(offset);
      const read32 = (offset: number): number =>
        littleEndian ? buf.readUInt32LE(offset) : buf.readUInt32BE(offset);

      // TIFF magic number
      if (read16(tiffOffset + 2) !== 0x002a) return undefined;

      // Offset to first IFD
      const ifd0Offset = tiffOffset + read32(tiffOffset + 4);

      const result: NonNullable<ImageRawData["exif"]> = {};

      // ---- Parse IFD0 ----
      const ifd0Entries = read16(ifd0Offset);
      let exifIfdOffset = 0;
      let gpsIfdOffset = 0;

      for (let i = 0; i < ifd0Entries; i++) {
        const entryOffset = ifd0Offset + 2 + i * 12;
        if (entryOffset + 12 > buf.length) break;
        const tag = read16(entryOffset);

        switch (tag) {
          case 0x010f: // Make
            result.make = this.readExifString(buf, entryOffset, read32, littleEndian);
            break;
          case 0x0110: // Model
            result.model = this.readExifString(buf, entryOffset, read32, littleEndian);
            break;
          case 0x0112: // Orientation
            result.orientation = this.readExifShort(buf, entryOffset, read16);
            break;
          case 0x8769: // EXIF IFD pointer
            exifIfdOffset = tiffOffset + read32(entryOffset + 8);
            break;
          case 0x8825: // GPS IFD pointer
            gpsIfdOffset = tiffOffset + read32(entryOffset + 8);
            break;
        }
      }

      // ---- Parse EXIF IFD ----
      if (exifIfdOffset > 0 && exifIfdOffset < buf.length) {
        const exifEntries = read16(exifIfdOffset);
        for (let i = 0; i < exifEntries; i++) {
          const entryOffset = exifIfdOffset + 2 + i * 12;
          if (entryOffset + 12 > buf.length) break;
          const tag = read16(entryOffset);

          switch (tag) {
            case 0x9003: // DateTimeOriginal
              result.dateTime = this.readExifString(buf, entryOffset, read32, littleEndian);
              break;
            case 0x8827: // ISOSpeedRatings
              result.iso = this.readExifShort(buf, entryOffset, read16);
              break;
            case 0x829a: // ExposureTime (rational)
              result.exposureTime = this.readExifRational(buf, entryOffset, read32);
              break;
            case 0x920a: // FocalLength (rational)
              result.focalLength = this.readExifRational(buf, entryOffset, read32);
              break;
          }
        }
      }

      // ---- Parse GPS IFD ----
      if (gpsIfdOffset > 0 && gpsIfdOffset < buf.length) {
        const gpsEntries = read16(gpsIfdOffset);
        let gpsLat: number[] | undefined;
        let gpsLatRef: string | undefined;
        let gpsLng: number[] | undefined;
        let gpsLngRef: string | undefined;

        for (let i = 0; i < gpsEntries; i++) {
          const entryOffset = gpsIfdOffset + 2 + i * 12;
          if (entryOffset + 12 > buf.length) break;
          const tag = read16(entryOffset);

          switch (tag) {
            case 0x0001: // GPSLatitude
              gpsLat = this.readExifRationalArray(buf, entryOffset, read32);
              break;
            case 0x0002: // GPSLongitude
              gpsLng = this.readExifRationalArray(buf, entryOffset, read32);
              break;
            case 0x0003: // GPSLatitudeRef
              gpsLatRef = this.readExifString(buf, entryOffset, read32, littleEndian);
              break;
            case 0x0004: // GPSLongitudeRef
              gpsLngRef = this.readExifString(buf, entryOffset, read32, littleEndian);
              break;
          }
        }

        if (gpsLat && gpsLng && gpsLat.length >= 3 && gpsLng.length >= 3) {
          const lat = this.dmsToDecimal(gpsLat, gpsLatRef === "S");
          const lng = this.dmsToDecimal(gpsLng, gpsLngRef === "W");
          if (lat !== null && lng !== null) {
            result.gps = { lat, lng };
          }
        }
      }

      // Only return if we extracted at least one field
      if (Object.keys(result).length > 0) return result;
      return undefined;
    } catch {
      return undefined;
    }
  }

  // -----------------------------------------------------------------------
  // EXIF value readers
  // -----------------------------------------------------------------------

  /** Read a short value from an EXIF IFD entry. */
  private readExifShort(buf: Buffer, entryOffset: number, read16: (o: number) => number): number {
    // Format type 3 = SHORT, count usually 1, value stored in bytes 8-9
    return read16(entryOffset + 8);
  }

  /** Read a string value from an EXIF IFD entry. */
  private readExifString(
    buf: Buffer,
    entryOffset: number,
    read32: (o: number) => number,
    _littleEndian: boolean,
  ): string {
    const count = read32(entryOffset + 4);
    // If count <= 4, the string is stored inline in the value offset field
    if (count <= 4) {
      return buf.toString("ascii", entryOffset + 8, entryOffset + 8 + count).replace(/\0+$/, "");
    }
    // Otherwise, the value offset points to the actual data
    const valueOffset = read32(entryOffset + 8);
    if (valueOffset + count > buf.length) return "";
    return buf.toString("ascii", valueOffset, valueOffset + count).replace(/\0+$/, "");
  }

  /** Read a rational value (numerator/denominator) as a string like "1/100". */
  private readExifRational(
    buf: Buffer,
    entryOffset: number,
    read32: (o: number) => number,
  ): string {
    const valueOffset = read32(entryOffset + 8);
    if (valueOffset + 8 > buf.length) return "";
    const num = read32(valueOffset);
    const den = read32(valueOffset + 4);
    if (den === 0) return "";
    // For exposure time, show as fraction if < 1, otherwise as decimal
    const val = num / den;
    if (val < 1 && val > 0) {
      return `${num}/${den}`;
    }
    return val.toFixed(1);
  }

  /** Read an array of rational values (e.g., GPS DMS coordinates). */
  private readExifRationalArray(
    buf: Buffer,
    entryOffset: number,
    read32: (o: number) => number,
  ): number[] {
    const count = read32(entryOffset + 4);
    const valueOffset = read32(entryOffset + 8);
    const result: number[] = [];
    for (let i = 0; i < count; i++) {
      const offset = valueOffset + i * 8;
      if (offset + 8 > buf.length) break;
      const num = read32(offset);
      const den = read32(offset + 4);
      result.push(den === 0 ? 0 : num / den);
    }
    return result;
  }

  /**
   * Convert DMS (degrees/minutes/seconds) array to decimal degrees.
   */
  private dmsToDecimal(dms: number[], negate: boolean): number | null {
    if (!dms || dms.length < 3) return null;
    const decimal = Math.abs(dms[0]) + dms[1] / 60 + dms[2] / 3600;
    return negate ? -decimal : decimal;
  }
}
