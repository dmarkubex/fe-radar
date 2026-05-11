import { fetchAlertCount } from "@/lib/api/alerts-query";

export async function GET(): Promise<Response> {
  return Response.json(await fetchAlertCount());
}
