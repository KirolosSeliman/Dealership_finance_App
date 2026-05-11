import { runVehicleValuationRoute } from "@/lib/server/market-snap-api";

export function POST(request: Request, context: { params: Promise<{ vehicleId: string }> }) {
  return context.params.then(({ vehicleId }) => runVehicleValuationRoute(request, vehicleId));
}
