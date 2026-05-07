export interface VinDecodeResult {
  year?: number;
  make?: string;
  model?: string;
  trim?: string;
  color?: string;
}

export async function decodeVin(vin: string): Promise<VinDecodeResult> {
  const normalizedVin = vin.trim().toUpperCase();
  if (normalizedVin.length < 11) {
    return {};
  }

  const response = await fetch(
    `https://vpic.nhtsa.dot.gov/api/vehicles/DecodeVinValues/${encodeURIComponent(
      normalizedVin,
    )}?format=json`,
    { next: { revalidate: 86_400 } },
  );

  if (!response.ok) {
    return {};
  }

  const payload = (await response.json()) as {
    Results?: Array<Record<string, string>>;
  };
  const result = payload.Results?.[0];
  if (!result) {
    return {};
  }

  return {
    year: result.ModelYear ? Number(result.ModelYear) : undefined,
    make: result.Make || undefined,
    model: result.Model || undefined,
    trim: result.Trim || result.Series || undefined,
    color: undefined,
  };
}
