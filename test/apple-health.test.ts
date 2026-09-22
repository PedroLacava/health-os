import { describe,expect,it } from "vitest";
import { appleHealthAdapter } from "../src/integrations/apple-health.js";

describe("apple health adapter",()=>{
  it("normalizes HealthKit samples",()=>{
    const events=appleHealthAdapter.identifyEvents({samples:[{
      uuid:"hrv-1",
      identifier:"HKQuantityTypeIdentifierHeartRateVariabilitySDNN",
      startDate:"2026-09-21T08:00:00-03:00",
      endDate:"2026-09-21T08:01:00-03:00",
      value:52.4,
      unit:"ms"
    }]});
    expect(events).toHaveLength(1);
    expect(appleHealthAdapter.normalize(events[0]!.eventType,events[0]!.payload)).toEqual([
      expect.objectContaining({externalId:"hrv-1",type:"hrv",value:52.4,unit:"ms",provenance:"measured"})
    ]);
  });

  it("ignores unknown or malformed samples",()=>{
    expect(appleHealthAdapter.identifyEvents(null)).toEqual([]);
    const events=appleHealthAdapter.identifyEvents({samples:[{identifier:"unknown",startDate:"2026-09-21"}]});
    expect(appleHealthAdapter.normalize(events[0]!.eventType,events[0]!.payload)).toEqual([]);
  });
});
