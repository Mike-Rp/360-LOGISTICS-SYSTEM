/** Local checks for Driver operational photos. No image leaves the browser on failure. */
export const ANALYSIS_WIDTH = 300;
export const BLUR_THRESHOLD = 45;
export const DARKNESS_THRESHOLD = 35;
export const VEHICLE_CONFIDENCE_THRESHOLD = 0.55;
export const VEHICLE_MIN_AREA_RATIO = 0.15;
export const VAN_FALLBACK_CONFIDENCE_THRESHOLD = 0.70;
export const VAN_FALLBACK_MIN_AREA_RATIO = 0.25;

export type PhotoCheckFailure = 'blurry' | 'dark' | 'no_truck' | 'detector_unavailable' | 'unreadable';
export type PhotoCheckResult = { ok: true } | { ok: false; reason: PhotoCheckFailure };

type VehiclePrediction = { class: string; score: number; bbox: [number, number, number, number] };
type VehicleDetector = { detect: (image: HTMLImageElement) => Promise<VehiclePrediction[]> };
let detectorPromise: Promise<VehicleDetector> | null = null;

/** A failed load may be retried by the next capture or reopened photo sheet. */
export function loadVehicleDetector(): Promise<VehicleDetector> {
  if (!detectorPromise) {
    detectorPromise = (async () => {
      await import('@tensorflow/tfjs');
      const cocoSsd = await import('@tensorflow-models/coco-ssd');
      return cocoSsd.load({ base: 'lite_mobilenet_v2' });
    })().catch((error: unknown) => {
      detectorPromise = null;
      throw error;
    });
  }
  return detectorPromise;
}

export function assessImagePixels(pixels: Uint8ClampedArray, width: number, height: number): 'dark' | 'blurry' | null {
  if (width < 3 || height < 3 || pixels.length < width * height * 4) return 'blurry';
  const gray = new Float32Array(width * height);
  let luminance = 0;
  for (let i = 0; i < gray.length; i++) {
    const offset = i * 4;
    const value = 0.299 * pixels[offset] + 0.587 * pixels[offset + 1] + 0.114 * pixels[offset + 2];
    gray[i] = value;
    luminance += value;
  }
  if (luminance / gray.length < DARKNESS_THRESHOLD) return 'dark';

  let sum = 0;
  let sumSquares = 0;
  let count = 0;
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const i = y * width + x;
      const edge = gray[i - width] + gray[i + width] + gray[i - 1] + gray[i + 1] - 4 * gray[i];
      sum += edge;
      sumSquares += edge * edge;
      count++;
    }
  }
  const mean = sum / count;
  return sumSquares / count - mean * mean < BLUR_THRESHOLD ? 'blurry' : null;
}

/** COCO-SSD detects a vehicle, not the identity of the assigned truck. */
export function hasVehicleDetection(predictions: VehiclePrediction[], width: number, height: number): boolean {
  const imageArea = width * height;
  if (imageArea <= 0) return false;
  return predictions.some((prediction) => {
    const areaRatio = Math.max(0, prediction.bbox[2]) * Math.max(0, prediction.bbox[3]) / imageArea;
    if (prediction.class === 'truck' || prediction.class === 'bus') {
      return prediction.score >= VEHICLE_CONFIDENCE_THRESHOLD && areaRatio >= VEHICLE_MIN_AREA_RATIO;
    }
    return prediction.class === 'car'
      && prediction.score >= VAN_FALLBACK_CONFIDENCE_THRESHOLD
      && areaRatio >= VAN_FALLBACK_MIN_AREA_RATIO;
  });
}

function decodeImage(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('Image could not be decoded'));
    image.src = dataUrl;
  });
}

export async function checkPhoto(dataUrl: string, options: { requireTruck: boolean }): Promise<PhotoCheckResult> {
  let image: HTMLImageElement;
  try {
    image = await decodeImage(dataUrl);
    const ratio = Math.min(ANALYSIS_WIDTH / image.width, ANALYSIS_WIDTH / image.height, 1);
    const width = Math.max(3, Math.round(image.width * ratio));
    const height = Math.max(3, Math.round(image.height * ratio));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    if (!context) return { ok: false, reason: 'unreadable' };
    context.drawImage(image, 0, 0, width, height);
    const problem = assessImagePixels(context.getImageData(0, 0, width, height).data, width, height);
    if (problem) return { ok: false, reason: problem };
  } catch {
    return { ok: false, reason: 'unreadable' };
  }

  if (!options.requireTruck) return { ok: true };
  let detector: VehicleDetector;
  let predictions: VehiclePrediction[];
  try {
    detector = await loadVehicleDetector();
    predictions = await detector.detect(image);
  } catch {
    return { ok: false, reason: 'detector_unavailable' };
  }
  return hasVehicleDetection(predictions, image.width, image.height)
    ? { ok: true }
    : { ok: false, reason: 'no_truck' };
}
