import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseGarminExport } from "../src/integrations/garmin-export.js";

describe("Garmin export parser", () => {
  it("normalizes daily and sleep summaries without personal identifiers", async () => {
    const root = await mkdtemp(join(tmpdir(), "health-os-garmin-"));
    await mkdir(join(root, "DI-Connect-Aggregator"));
    await mkdir(join(root, "DI-Connect-Wellness"));
    await writeFile(join(root, "DI-Connect-Aggregator", "UDSFile_1.json"), JSON.stringify([{
      userProfilePK: 123,
      calendarDate: "2026-09-20",
      totalSteps: 12000,
      restingHeartRate: 48,
      bodyBattery: { chargedValue: 70, bodyBatteryStatList: [{ bodyBatteryStatType: "HIGHEST", statsValue: 82 }] },
    }]));
    await writeFile(join(root, "DI-Connect-Wellness", "x_sleepData.json"), JSON.stringify([{
      calendarDate: "2026-09-20",
      sleepStartTimestampGMT: "2026-09-20T02:00:00.0",
      sleepEndTimestampGMT: "2026-09-20T10:00:00.0",
      deepSleepSeconds: 3600,
      lightSleepSeconds: 14400,
      sleepScores: { overallScore: 86 },
      spo2SleepSummary: { averageSPO2: 95, lowestSPO2: 87, averageHR: 52 },
    }]));

    const events = await parseGarminExport(root);
    expect(events).toHaveLength(2);
    expect(events.find((event) => event.eventType === "daily_summary")?.metrics).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: "daily.steps", value: 12000 }),
      expect.objectContaining({ type: "daily.body_battery.highest", value: 82 }),
    ]));
    expect(events.find((event) => event.eventType === "sleep_summary")?.metrics).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: "sleep.duration", value: 28800 }),
      expect.objectContaining({ type: "sleep.score", value: 86 }),
      expect.objectContaining({ type: "sleep.spo2.average", value: 95 }),
    ]));
    expect(JSON.stringify(events)).not.toContain("userProfilePK");
  });
});
