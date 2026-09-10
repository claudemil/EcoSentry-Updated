import { useTensorflowModel } from "react-native-fast-tflite";

export type Detection = {
  label: string;
  confidence: number;
  bbox: { x: number; y: number; width: number; height: number };
};

export const CLASS_NAMES = [
  "Lantana Camara",
  "Water Lettuce",
  "Siam Weed",
  "Water Hyacinth",
];

const CONFIDENCE_THRESHOLD = 0.6;
const IOU_THRESHOLD = 0.3;

export function useYOLOv8n() {
  const model = useTensorflowModel(require("../assets/yolov8n.tflite"), []);

  const runInference = async (inputTensor: Float32Array): Promise<Detection[]> => {
    if (model.state !== "loaded" || !model.model) return [];

    try {
      const outputs = model.model.runSync([inputTensor.buffer as ArrayBuffer]);
      const raw = new Float32Array(outputs[0] as ArrayBuffer);

      const detections: Detection[] = [];
      const NUM_ANCHORS = 8400;

      for (let a = 0; a < NUM_ANCHORS; a++) {
        const cx = raw[0 * NUM_ANCHORS + a];
        const cy = raw[1 * NUM_ANCHORS + a];
        const w = raw[2 * NUM_ANCHORS + a];
        const h = raw[3 * NUM_ANCHORS + a];

        let bestScore = -Infinity;
        let bestClass = 0;

        for (let c = 0; c < CLASS_NAMES.length; c++) {
          const score = raw[(4 + c) * NUM_ANCHORS + a];
          if (score > bestScore) {
            bestScore = score;
            bestClass = c;
          }
        }

        if (bestScore < CONFIDENCE_THRESHOLD) continue;

        const x = cx - w / 2;
        const y = cy - h / 2;

        if (x < -0.1 || y < -0.1 || w <= 0 || h <= 0) continue;

        detections.push({
          label: CLASS_NAMES[bestClass],
          confidence: bestScore,
          bbox: {
            x: Math.max(0, x),
            y: Math.max(0, y),
            width: Math.min(1 - Math.max(0, x), w),
            height: Math.min(1 - Math.max(0, y), h),
          },
        });
      }

      // Returns ALL distinct detections (multiple boxes per class allowed),
      // sorted by confidence descending — index 0 is the most confident overall.
      return applyNMS(detections, IOU_THRESHOLD);
    } catch (e) {
      console.error("Inference error:", e);
      return [];
    }
  };

  return { model, runInference };
}

// Convenience helper for callers that still just want "the one best detection"
// (e.g. thumbnail selection, "Pin This" popup)
export function getBestDetection(detections: Detection[]): Detection | null {
  if (detections.length === 0) return null;
  return detections[0]; // already sorted by confidence in applyNMS
}

function iou(a: Detection["bbox"], b: Detection["bbox"]): number {
  const x1 = Math.max(a.x, b.x);
  const y1 = Math.max(a.y, b.y);
  const x2 = Math.min(a.x + a.width, b.x + b.width);
  const y2 = Math.min(a.y + a.height, b.y + b.height);

  const interW = Math.max(0, x2 - x1);
  const interH = Math.max(0, y2 - y1);
  const inter = interW * interH;

  const areaA = a.width * a.height;
  const areaB = b.width * b.height;
  const union = areaA + areaB - inter;

  return union <= 0 ? 0 : inter / union;
}

function applyNMS(detections: Detection[], iouThreshold: number): Detection[] {
  // Group detections by class — NMS should only suppress overlapping boxes
  // of the SAME class (likely the same physical plant seen twice),
  // never boxes of different classes even if they overlap.
  const byClass = new Map<string, Detection[]>();
  for (const det of detections) {
    const list = byClass.get(det.label) ?? [];
    list.push(det);
    byClass.set(det.label, list);
  }

  const kept: Detection[] = [];

  for (const classDetections of byClass.values()) {
    const sorted = [...classDetections].sort((a, b) => b.confidence - a.confidence);
    const keptForClass: Detection[] = [];

    for (const det of sorted) {
      const overlaps = keptForClass.some((k) => iou(det.bbox, k.bbox) > iouThreshold);
      if (!overlaps) keptForClass.push(det);
    }

    kept.push(...keptForClass);
  }

  // Sort the final combined list by confidence descending —
  // detections[0] is always the single most-confident detection overall
  return kept.sort((a, b) => b.confidence - a.confidence);
}