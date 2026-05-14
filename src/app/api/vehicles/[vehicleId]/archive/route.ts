import { forwardDomainMutation } from "@/lib/server/mutation-route-bridge";

export function POST(request: Request, context: { params: Promise<{ vehicleId: string }> }) {
  return context.params.then(({ vehicleId }) =>
    forwardDomainMutation(request, "deleteVehicle", {
      bucket: "vehicles-archive",
      limit: 15,
      fields: { vehicleId },
    }),
  );
}
