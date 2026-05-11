import { convertDealRadarToInventory } from "@/lib/server/market-snap-api";

export function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  return context.params.then(({ id }) => convertDealRadarToInventory(request, id));
}
