import { useTensorflowModel } from "react-native-fast-tflite";


export type Detection = {
  label: string;
  confidence: number;
  bbox: { x: number; y: number; width: number; height: number };
};

const CLASS_NAMES = [
  "Lantana Camara",  // 0
  "Water Lettuce",  // 1
  "Siam Weed",       // 2
  "Water Hyacinth", // 3
];

const CONFIDENCE_THRESHOLD = 0.50; // lowered slightly since sigmoid is now applied correctly
const IOU_THRESHOLD = 0.20;

// Converts raw logit to probability

export function useYOLOv8n() {
  const model = useTensorflowModel(
    require("../assets/yolov8n.tflite"),
    []
  );

  const runInference = async (inputTensor: Float32Array): Promise<Detection[]> => {
    if (model.state !== "loaded" || !model.model) return [];

    try {
      // Run inference — input: [1, 640, 640, 3]
      const outputs = model.model.runSync([inputTensor.buffer as ArrayBuffer]);

      // Output shape: [1, 8, 8400]
      // flat Float32Array of length 1 * 8 * 8400 = 67200
      // Row layout: 0=cx, 1=cy, 2=w, 3=h, 4=LantanaCamara, 5=Water-Lettuce, 6=siamweed, 7=water_hyacinth
      const raw = new Float32Array(outputs[0] as ArrayBuffer);


      const detections: Detection[] = [];

      const NUM_ANCHORS = 8400;
for (let a = 0; a < NUM_ANCHORS; a++) {
  const cx = raw[0 * NUM_ANCHORS + a];
  const cy = raw[1 * NUM_ANCHORS + a];
  const w  = raw[2 * NUM_ANCHORS + a];
  const h  = raw[3 * NUM_ANCHORS + a];

  let bestScore = -Infinity;
  let bestClass = 0;

  for (let c = 0; c < CLASS_NAMES.length; c++) {
    const score = raw[(4 + c) * NUM_ANCHORS + a]; // no sigmoid
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

      return applyNMS(detections, IOU_THRESHOLD);
    } catch (e) {
      console.error("Inference error:", e);
      return [];
    }
  };

  return { model, runInference };
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
  // Sort by confidence descending
  const sorted = [...detections].sort((a, b) => b.confidence - a.confidence);
  const kept: Detection[] = [];

  // Standard IoU-based NMS
  for (const det of sorted) {
    const overlaps = kept.some((k) => iou(det.bbox, k.bbox) > iouThreshold);
    if (!overlaps) kept.push(det);
  }

  // Keep only the single best detection per class
  const bestPerClass = new Map<string, Detection>();
  for (const det of kept) {
    const existing = bestPerClass.get(det.label);
    if (!existing || det.confidence > existing.confidence) {
      bestPerClass.set(det.label, det);
    }
  }

  return Array.from(bestPerClass.values());
}