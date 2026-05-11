import { listDisabledProxies } from "@/lib/api/proxy-admin";

export async function GET(): Promise<Response> {
  return Response.json({ items: listDisabledProxies() });
}
