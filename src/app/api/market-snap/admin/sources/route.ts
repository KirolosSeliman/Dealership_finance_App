import { adminList } from "@/lib/server/market-snap-api";

export function GET(request: Request) {
  return adminList(request, "market_sources");
}
