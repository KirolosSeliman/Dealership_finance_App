import { forwardDomainMutation } from "@/lib/server/mutation-route-bridge";

export function POST(request: Request, context: { params: Promise<{ account: string; transactionId: string }> }) {
  return context.params.then(({ account, transactionId }) =>
    forwardDomainMutation(request, "deleteCashTransaction", {
      bucket: `cash-${account}-reverse`,
      limit: 20,
      fields: { account, transactionId },
    }),
  );
}
