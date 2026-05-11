import dayjsBase from "dayjs";
import timezone from "dayjs/plugin/timezone";
import utc from "dayjs/plugin/utc";
import { APP_TIMEZONE } from "./constants";

dayjsBase.extend(utc);
dayjsBase.extend(timezone);
dayjsBase.tz.setDefault(APP_TIMEZONE);

export const dayjs = dayjsBase;

export function nowInAppTimezone(): dayjsBase.Dayjs {
  return dayjsBase().tz(APP_TIMEZONE);
}
