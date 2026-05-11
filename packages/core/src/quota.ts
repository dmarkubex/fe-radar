import { NotImplementedError } from "@fe-radar/shared";
import type { QuotaDecision, QuotaInput } from "./types";

export const ADMIT_LUA = `
local current = redis.call('INCR', KEYS[1])
if current == 1 then
  redis.call('EXPIRE', KEYS[1], ARGV[2])
end
if current > tonumber(ARGV[1]) then
  redis.call('DECR', KEYS[1])
  return 0
end
return current
`;

export function admitToScoring(input: QuotaInput): QuotaDecision {
  void input;
  throw new NotImplementedError("admitToScoring");
}
