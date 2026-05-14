import { forwardDomainMutation } from "@/lib/server/mutation-route-bridge";

export function POST(request: Request, context: { params: Promise<{ vehicleId: string }> }) {
  return context.params.then(({ vehicleId }) =>
    forwardDomainMutation(request, "recordSale", {
      bucket: "vehicle-sale-record",
      limit: 20,
      fields: { vehicleId },
    }),
  );
}
