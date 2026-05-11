import type { ImageFeatures } from "@/types/market-snap";

export interface ImageFeatureExtractionInput {
  imageUrls?: string[];
  fetchedImages?: Array<{ bytes: ArrayBuffer; contentType?: string }>;
}

export async function extractImageFeatures(input: ImageFeatureExtractionInput): Promise<ImageFeatures> {
  const fetchedImages = input.fetchedImages ?? [];
  const urls = input.imageUrls ?? [];
  const imageCount = fetchedImages.length + urls.length;

  return {
    imageCount,
    photoAnalysisStatus: imageCount > 0 ? "processed" : "unknown",
    photoQualityScore: imageCount >= 8 ? 70 : imageCount >= 4 ? 55 : imageCount > 0 ? 35 : undefined,
    missingAngleScore: imageCount >= 8 ? 15 : imageCount >= 4 ? 45 : imageCount > 0 ? 75 : undefined,
    imageProcessedAt: new Date().toISOString(),
  };
}

export async function processTemporaryListingImages(input: { imageUrls: string[]; fetchImage?: (url: string) => Promise<ArrayBuffer> }) {
  const fetchImage = input.fetchImage ?? defaultFetchImage;
  const fetchedImages: Array<{ bytes: ArrayBuffer }> = [];
  try {
    for (const url of input.imageUrls.slice(0, 24)) {
      fetchedImages.push({ bytes: await fetchImage(url) });
    }
    return extractImageFeatures({ fetchedImages });
  } finally {
    fetchedImages.length = 0;
  }
}

async function defaultFetchImage(url: string) {
  const response = await fetch(url);
  if (!response.ok) throw new Error("Could not fetch temporary listing image.");
  return response.arrayBuffer();
}
