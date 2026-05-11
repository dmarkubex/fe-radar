import { fetchDashboardData } from "@/lib/api/dashboard-query";

export async function GET(): Promise<Response> {
  return Response.json(await fetchDashboardData());
}
