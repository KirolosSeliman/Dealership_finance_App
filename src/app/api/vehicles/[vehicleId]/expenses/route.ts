import { forwardDomainMutation } from "@/lib/server/mutation-route-bridge";

export function POST(request: Request, context: { params: Promise<{ vehicleId: string }> }) {
  return context.params.then(({ vehicleId }) =>
    forwardDomainMutation(request, "createExpense", {
      bucket: "vehicle-expenses-create",
      limit: 45,
      fields: { vehicleId },
    }),
  );
}
