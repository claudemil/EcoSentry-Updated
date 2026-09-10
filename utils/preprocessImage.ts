import { Detection } from "@/hooks/use-YOLOv8n";
import * as ImageManipulator from "expo-image-manipulator";
import * as pako from "pako";

const INPUT_SIZE = 640;
const PAD_VALUE = 114; // YOLO convention for padding color (mid-gray)

export type PreprocessResult = {
  tensor: Float32Array;
  scale: number;
  padX: number;
  padY: number;
  originalWidth: number;
  originalHeight: number;
};
export async function preprocessImage(
  base64: string,
  originalWidth: number,
  originalHeight: number,
): Promise<PreprocessResult>  {

  const scale = Math.min(INPUT_SIZE / originalWidth, INPUT_SIZE / originalHeight);
  const scaledWidth = Math.round(originalWidth * scale);
  const scaledHeight = Math.round(originalHeight * scale);

  const result = await ImageManipulator.manipulateAsync(
    `data:image/jpeg;base64,${base64}`,
    [{ resize: { width: scaledWidth, height: scaledHeight } }],
    { base64: true, format: ImageManipulator.SaveFormat.PNG },
  );

  if (!result.base64) throw new Error("Failed to resize image");

  const binaryStr = atob(result.base64);
  const bytes = new Uint8Array(binaryStr.length);
  for (let i = 0; i < binaryStr.length; i++) {
    bytes[i] = binaryStr.charCodeAt(i);
  }

  // Decode the SCALED (non-square) image — parsePNG needs to know its actual dimensions,
  // not INPUT_SIZE, since it's no longer forced to be square
  const { pixels: scaledPixels, width: decodedWidth, height: decodedHeight } =
    parsePNGWithDims(bytes);

  // Center the scaled image within a 640x640 canvas, filling the rest with padding color
  const padX = Math.round((INPUT_SIZE - scaledWidth) / 2);
  const padY = Math.round((INPUT_SIZE - scaledHeight) / 2);

  const totalPixels = INPUT_SIZE * INPUT_SIZE;
  const float32 = new Float32Array(totalPixels * 3).fill(PAD_VALUE / 255);


  for (let y = 0; y < decodedHeight; y++) {
    const destY = y + padY;
    if (destY < 0 || destY >= INPUT_SIZE) continue;

    for (let x = 0; x < decodedWidth; x++) {
      const destX = x + padX;
      if (destX < 0 || destX >= INPUT_SIZE) continue;

      const srcIdx = (y * decodedWidth + x) * 4; // RGBA source
      const destIdx = (destY * INPUT_SIZE + destX) * 3; // RGB dest, interleaved

      float32[destIdx + 0] = scaledPixels[srcIdx + 0] / 255.0;
      float32[destIdx + 1] = scaledPixels[srcIdx + 1] / 255.0;
      float32[destIdx + 2] = scaledPixels[srcIdx + 2] / 255.0;
    }
  }

  return { tensor: float32, scale, padX, padY, originalWidth, originalHeight };
}

//   const result = await ImageManipulator.manipulateAsync(
//     `data:image/jpeg;base64,${base64}`,
//     [{ resize: { width: INPUT_SIZE, height: INPUT_SIZE } }],
//     { base64: true, format: ImageManipulator.SaveFormat.PNG }
//   );

//   if (!result.base64) throw new Error("Failed");

//   const binaryStr = atob(result.base64);
//   const bytes = new Uint8Array(binaryStr.length);
//   for (let i = 0; i < binaryStr.length; i++) {
//     bytes[i] = binaryStr.charCodeAt(i);
//   }

//   const pixels = parsePNG(bytes);
//   const totalPixels = INPUT_SIZE * INPUT_SIZE;
//   const float32 = new Float32Array(totalPixels * 3);

//   // for (let i = 0; i < totalPixels; i++) {
//   //   float32[0 * totalPixels + i] = pixels[i * 4 + 0] / 255.0;
//   //   float32[1 * totalPixels + i] = pixels[i * 4 + 1] / 255.0;
//   //   float32[2 * totalPixels + i] = pixels[i * 4 + 2] / 255.0;
//   // }

//   for (let i = 0; i < totalPixels; i++) {
//   float32[i * 3 + 0] = pixels[i * 4 + 0] / 255.0; // R
//   float32[i * 3 + 1] = pixels[i * 4 + 1] / 255.0; // G
//   float32[i * 3 + 2] = pixels[i * 4 + 2] / 255.0; // B
// }
export function unletterboxDetection(
  detection: Detection,
  transform: Pick<PreprocessResult, "scale" | "padX" | "padY" | "originalWidth" | "originalHeight">,
): Detection {
  const { scale, padX, padY, originalWidth, originalHeight } = transform;

  const pixelX640 = detection.bbox.x * INPUT_SIZE;
  const pixelY640 = detection.bbox.y * INPUT_SIZE;
  const pixelW640 = detection.bbox.width * INPUT_SIZE;
  const pixelH640 = detection.bbox.height * INPUT_SIZE;

  const originalX = (pixelX640 - padX) / scale / originalWidth;
  const originalY = (pixelY640 - padY) / scale / originalHeight;
  const originalW = pixelW640 / scale / originalWidth;
  const originalH = pixelH640 / scale / originalHeight;

  return {
    ...detection,
    bbox: {
      x: Math.max(0, Math.min(1, originalX)),
      y: Math.max(0, Math.min(1, originalY)),
      width: Math.max(0, Math.min(1 - originalX, originalW)),
      height: Math.max(0, Math.min(1 - originalY, originalH)),
    },
  };
}
//   return float32;
// }

/**
 * Decodes a base64 JPEG into a Uint8Array of RGB pixels
 * using expo-image-manipulator's pixel extraction trick.
 *
 * YOLOv8 TFLite expects raw RGB [0–255] as float normalized.
 * We use a PNG round-trip to get predictable uncompressed pixels.
 */

function pako_inflate(data: Uint8Array): Uint8Array {
  return pako.inflate(data);
}
// async function decodeJpegToRGB(base64Jpeg: string): Promise<Uint8Array> {
//   // Convert JPEG → PNG so pixels are lossless and uncompressed
//   const png = await ImageManipulator.manipulateAsync(
//     `data:image/jpeg;base64,${base64Jpeg}`,
//     [],
//     { base64: true, format: ImageManipulator.SaveFormat.PNG }
//   );

//   if (!png.base64) throw new Error("PNG conversion failed");

//   // Decode PNG base64 to bytes
//   const binaryStr = atob(png.base64);
//   const pngBytes = new Uint8Array(binaryStr.length);
//   for (let i = 0; i < binaryStr.length; i++) {
//     pngBytes[i] = binaryStr.charCodeAt(i);
//   }

//   // Parse PNG to extract raw RGBA pixels
//   const pixels = parsePNG(pngBytes);

//   // Drop alpha channel → RGB only
//   const rgb = new Uint8Array(INPUT_SIZE * INPUT_SIZE * 3);
//   for (let i = 0; i < INPUT_SIZE * INPUT_SIZE; i++) {
//     rgb[i * 3 + 0] = pixels[i * 4 + 0]; // R
//     rgb[i * 3 + 1] = pixels[i * 4 + 1]; // G
//     rgb[i * 3 + 2] = pixels[i * 4 + 2]; // B
//   }

//   return rgb;
// }

// ─── Minimal PNG decoder ───────────────────────────────────────────────────

// function parsePNG(data: Uint8Array): Uint8Array {
//   // Verify PNG signature
//   const sig = [137, 80, 78, 71, 13, 10, 26, 10];
//   for (let i = 0; i < 8; i++) {
//     if (data[i] !== sig[i]) throw new Error("Not a PNG file");
//   }

//   let width = 0, height = 0, bitDepth = 0, colorType = 0;
//   const idatChunks: Uint8Array[] = [];
//   let pos = 8;

//   while (pos < data.length) {
//     const length = readUint32(data, pos); pos += 4;
//     const type = String.fromCharCode(data[pos], data[pos+1], data[pos+2], data[pos+3]); pos += 4;
//     const chunkData = data.slice(pos, pos + length); pos += length;
//     pos += 4; // CRC

//     if (type === "IHDR") {
//       width     = readUint32(chunkData, 0);
//       height    = readUint32(chunkData, 4);
//       bitDepth  = chunkData[8];
//       colorType = chunkData[9];
//     } else if (type === "IDAT") {
//       idatChunks.push(chunkData);
//     }
//   }

//   // Decompress all IDAT chunks together
//   const compressed = mergeUint8Arrays(idatChunks);
//   const decompressed = pako_inflate(compressed);

//   // Reconstruct pixels from filtered scanlines
//   const bytesPerPixel = colorType === 2 ? 3 : 4; // RGB or RGBA
//   const stride = width * bytesPerPixel;
//   const pixels = new Uint8Array(width * height * 4); // always output RGBA

//   let srcPos = 0;
//   const prevRow = new Uint8Array(stride);

//   for (let y = 0; y < height; y++) {
//     const filterType = decompressed[srcPos++];
//     const row = new Uint8Array(decompressed.buffer, decompressed.byteOffset + srcPos, stride);
//     srcPos += stride;

//     const recon = unfilter(filterType, row, prevRow, bytesPerPixel);
//     prevRow.set(recon);

//     for (let x = 0; x < width; x++) {
//       const pi = (y * width + x) * 4;
//       if (bytesPerPixel === 3) {
//         pixels[pi + 0] = recon[x * 3 + 0];
//         pixels[pi + 1] = recon[x * 3 + 1];
//         pixels[pi + 2] = recon[x * 3 + 2];
//         pixels[pi + 3] = 255;
//       } else {
//         pixels[pi + 0] = recon[x * 4 + 0];
//         pixels[pi + 1] = recon[x * 4 + 1];
//         pixels[pi + 2] = recon[x * 4 + 2];
//         pixels[pi + 3] = recon[x * 4 + 3];
//       }
//     }
//   }

//   return pixels;
// }

function parsePNGWithDims(data: Uint8Array): { pixels: Uint8Array; width: number; height: number } {
  const sig = [137, 80, 78, 71, 13, 10, 26, 10];
  for (let i = 0; i < 8; i++) {
    if (data[i] !== sig[i]) throw new Error("Not a PNG file");
  }

  let width = 0, height = 0, bitDepth = 0, colorType = 0;
  const idatChunks: Uint8Array[] = [];
  let pos = 8;

  while (pos < data.length) {
    const length = readUint32(data, pos); pos += 4;
    const type = String.fromCharCode(data[pos], data[pos+1], data[pos+2], data[pos+3]); pos += 4;
    const chunkData = data.slice(pos, pos + length); pos += length;
    pos += 4; // CRC

    if (type === "IHDR") {
      width     = readUint32(chunkData, 0);
      height    = readUint32(chunkData, 4);
      bitDepth  = chunkData[8];
      colorType = chunkData[9];
    } else if (type === "IDAT") {
      idatChunks.push(chunkData);
    }
  }

  const compressed = mergeUint8Arrays(idatChunks);
  const decompressed = pako.inflate(compressed);

  const bytesPerPixel = colorType === 2 ? 3 : 4;
  const stride = width * bytesPerPixel;
  const pixels = new Uint8Array(width * height * 4);

  let srcPos = 0;
  const prevRow = new Uint8Array(stride);

  for (let y = 0; y < height; y++) {
    const filterType = decompressed[srcPos++];
    const row = new Uint8Array(decompressed.buffer, decompressed.byteOffset + srcPos, stride);
    srcPos += stride;

    const recon = unfilter(filterType, row, prevRow, bytesPerPixel);
    prevRow.set(recon);

    for (let x = 0; x < width; x++) {
      const pi = (y * width + x) * 4;
      if (bytesPerPixel === 3) {
        pixels[pi + 0] = recon[x * 3 + 0];
        pixels[pi + 1] = recon[x * 3 + 1];
        pixels[pi + 2] = recon[x * 3 + 2];
        pixels[pi + 3] = 255;
      } else {
        pixels[pi + 0] = recon[x * 4 + 0];
        pixels[pi + 1] = recon[x * 4 + 1];
        pixels[pi + 2] = recon[x * 4 + 2];
        pixels[pi + 3] = recon[x * 4 + 3];
      }
    }
  }

  return { pixels, width, height };
}

function unfilter(
  type: number,
  row: Uint8Array,
  prev: Uint8Array,
  bpp: number
): Uint8Array {
  const out = new Uint8Array(row.length);
  for (let i = 0; i < row.length; i++) {
    const x    = row[i];
    const a    = i >= bpp ? out[i - bpp] : 0;
    const b    = prev[i];
    const c    = i >= bpp ? prev[i - bpp] : 0;
    switch (type) {
      case 0: out[i] = x; break;
      case 1: out[i] = (x + a) & 0xff; break;
      case 2: out[i] = (x + b) & 0xff; break;
      case 3: out[i] = (x + Math.floor((a + b) / 2)) & 0xff; break;
      case 4: out[i] = (x + paethPredictor(a, b, c)) & 0xff; break;
      default: out[i] = x;
    }
  }
  return out;
}

function paethPredictor(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}

function readUint32(data: Uint8Array, offset: number): number {
  return ((data[offset] << 24) | (data[offset+1] << 16) |
          (data[offset+2] << 8) | data[offset+3]) >>> 0;
}

function mergeUint8Arrays(arrays: Uint8Array[]): Uint8Array {
  const total = arrays.reduce((s, a) => s + a.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const a of arrays) { out.set(a, offset); offset += a.length; }
  return out;
}

