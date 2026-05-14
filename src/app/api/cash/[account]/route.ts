import { forwardDomainMutation } from "@/lib/server/mutation-route-bridge";

export function POST(request: Request, context: { params: Promise<{ account: string }> }) {
  return context.params.then(({ account }) =>
    forwardDomainMutation(request, "createCashTransaction", {
      bucket: `cash-${account}-create`,
      limit: 30,
    }),
  );
}
