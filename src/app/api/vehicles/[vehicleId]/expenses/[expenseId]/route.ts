import { forwardDomainMutation } from "@/lib/server/mutation-route-bridge";

export function PATCH(request: Request, context: { params: Promise<{ vehicleId: string; expenseId: string }> }) {
  return context.params.then(({ vehicleId, expenseId }) =>
    forwardDomainMutation(request, "updateExpense", {
      bucket: "vehicle-expenses-update",
      limit: 45,
      fields: { vehicleId, expenseId },
    }),
  );
}

export function DELETE(request: Request, context: { params: Promise<{ vehicleId: string; expenseId: string }> }) {
  return context.params.then(({ vehicleId, expenseId }) =>
    forwardDomainMutation(request, "deleteExpense", {
      bucket: "vehicle-expenses-delete",
      limit: 30,
      fields: { vehicleId, expenseId },
    }),
  );
}
