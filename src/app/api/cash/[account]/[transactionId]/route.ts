import { forwardDomainMutation } from "@/lib/server/mutation-route-bridge";

export function PATCH(request: Request, context: { params: Promise<{ account: string; transactionId: string }> }) {
  return context.params.then(({ account, transactionId }) =>
    forwardDomainMutation(request, "updateCashTransaction", {
      bucket: `cash-${account}-update`,
      limit: 30,
      fields: { account, transactionId },
    }),
  );
}
