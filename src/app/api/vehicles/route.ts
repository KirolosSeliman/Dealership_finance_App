import { forwardDomainMutation } from "@/lib/server/mutation-route-bridge";

export function POST(request: Request) {
  return forwardDomainMutation(request, "createVehicle", { bucket: "vehicles-create", limit: 30 });
}
