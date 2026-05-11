import { importListings } from "@/lib/server/market-snap-api";

export function POST(request: Request) {
  return importListings(request, "json");
}
