import { forwardDomainMutation } from "@/lib/server/mutation-route-bridge";

export function PATCH(request: Request, context: { params: Promise<{ vehicleId: string }> }) {
  return context.params.then(({ vehicleId }) =>
    forwardDomainMutation(request, "updateVehicle", {
      bucket: "vehicles-update",
      limit: 45,
      fields: { vehicleId },
    }),
  );
}
