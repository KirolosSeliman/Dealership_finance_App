import { latestVehicleValuation } from "@/lib/server/market-snap-api";

export function GET(request: Request, context: { params: Promise<{ vehicleId: string }> }) {
  return context.params.then(({ vehicleId }) => latestVehicleValuation(request, vehicleId));
}
