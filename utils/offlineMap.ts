import Mapbox from "@rnmapbox/maps";

const PACK_NAME = "bacolod_city";

// Bacolod City bounding box
const BOUNDS: [GeoJSON.Position, GeoJSON.Position] = [
  [122.8700, 10.5800], // southwest
  [123.0500, 10.7800], // northeast
];

export const downloadBacolodMap = async (
  onProgress?: (percentage: number) => void
): Promise<void> => {
  try {
    // Check if already downloaded
    const existing = await Mapbox.offlineManager.getPack(PACK_NAME);
    if (existing) {
      console.log("[OFFLINE MAP] Already downloaded");
      return;
    }

    console.log("[OFFLINE MAP] Starting download...");
    await Mapbox.offlineManager.createPack(
      {
        name: PACK_NAME,
        styleURL: Mapbox.StyleURL.Street,
        minZoom: 10,
        maxZoom: 16, // 16 is enough detail without huge file size
        bounds: BOUNDS,
      },
      (region, status) => {
        const pct = Math.round(status.percentage ?? 0);
        console.log(`[OFFLINE MAP] ${pct}%`);
        onProgress?.(pct);
      },
      (region, error) => {
        console.error("[OFFLINE MAP] Error:", error);
      }
    );
  } catch (e) {
    console.error("[OFFLINE MAP] Failed:", e);
  }
};

export const isBacolodMapDownloaded = async (): Promise<boolean> => {
  try {
    const pack = await Mapbox.offlineManager.getPack(PACK_NAME);
    return !!pack;
  } catch {
    return false;
  }
};