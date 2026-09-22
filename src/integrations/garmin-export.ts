import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

type JsonRecord = Record<string, unknown>;

export type GarminExportMetric = {
  type: string;
  value?: number;
  unit?: string;
  data?: JsonRecord;
};

export type GarminExportEvent = {
  externalId: string;
  eventType: string;
  recordedAt: string;
  endedAt?: string;
  payload: JsonRecord;
  metrics: GarminExportMetric[];
};

const isRecord = (value: unknown): value is JsonRecord =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

const numberValue = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isFinite(value) ? value : undefined;

const textValue = (value: unknown): string | undefined =>
  typeof value === "string" && value.length > 0 ? value : undefined;

const isoTimestamp = (value: unknown, fallbackDate?: string): string => {
  if (typeof value === "number" && Number.isFinite(value)) {
    return new Date(value > 10_000_000_000 ? value : value * 1000).toISOString();
  }
  if (typeof value === "string" && value.length > 0) {
    const normalized = /^\d{4}-\d{2}-\d{2}$/.test(value)
      ? `${value}T12:00:00Z`
      : /(?:Z|[+-]\d{2}:?\d{2})$/.test(value)
        ? value
        : `${value}Z`;
    const parsed = new Date(normalized);
    if (!Number.isNaN(parsed.valueOf())) return parsed.toISOString();
  }
  if (fallbackDate) return `${fallbackDate}T12:00:00.000Z`;
  throw new Error(`Invalid Garmin timestamp: ${String(value)}`);
};

const metric = (
  type: string,
  value: unknown,
  unit?: string,
  data?: JsonRecord,
): GarminExportMetric | undefined => {
  const numeric = numberValue(value);
  return numeric === undefined ? undefined : { type, value: numeric, unit, data };
};

const compact = (record: JsonRecord, keys: string[]): JsonRecord =>
  Object.fromEntries(keys.filter((key) => record[key] !== undefined).map((key) => [key, record[key]]));

const loadRows = async (files: string[]): Promise<JsonRecord[]> => {
  const rows: JsonRecord[] = [];
  for (const file of files) {
    const parsed: unknown = JSON.parse(await readFile(file, "utf8"));
    if (Array.isArray(parsed)) rows.push(...parsed.filter(isRecord));
  }
  return rows;
};

const walk = async (directory: string): Promise<string[]> => {
  const entries = await readdir(directory, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await walk(path));
    else files.push(path);
  }
  return files;
};

const totalStress = (row: JsonRecord): JsonRecord | undefined => {
  const stress = isRecord(row.allDayStress) ? row.allDayStress : undefined;
  const list = stress?.aggregatorList;
  return Array.isArray(list)
    ? list.find((item): item is JsonRecord => isRecord(item) && item.type === "TOTAL")
    : undefined;
};

const bodyBatteryValue = (row: JsonRecord, type: string): number | undefined => {
  const battery = isRecord(row.bodyBattery) ? row.bodyBattery : undefined;
  const list = battery?.bodyBatteryStatList;
  if (!Array.isArray(list)) return undefined;
  const found = list.find((item) => isRecord(item) && item.bodyBatteryStatType === type);
  return isRecord(found) ? numberValue(found.statsValue) : undefined;
};

const dailyEvents = (rows: JsonRecord[]): GarminExportEvent[] => rows.flatMap((row) => {
  const date = textValue(row.calendarDate);
  if (!date) return [];
  const stress = totalStress(row);
  const battery = isRecord(row.bodyBattery) ? row.bodyBattery : undefined;
  const respiration = isRecord(row.respiration) ? row.respiration : undefined;
  const hydration = isRecord(row.hydration) ? row.hydration : undefined;
  const values = [
    metric("daily.steps", row.totalSteps, "count"),
    metric("daily.step_goal", row.dailyStepGoal, "count"),
    metric("daily.calories.total", row.totalKilocalories, "kcal"),
    metric("daily.calories.active", row.activeKilocalories, "kcal"),
    metric("daily.distance", row.totalDistanceMeters, "m"),
    metric("daily.intensity.moderate", row.moderateIntensityMinutes, "min"),
    metric("daily.intensity.vigorous", row.vigorousIntensityMinutes, "min"),
    metric("daily.heart_rate.resting", row.restingHeartRate, "bpm"),
    metric("daily.heart_rate.minimum", row.minHeartRate, "bpm"),
    metric("daily.heart_rate.maximum", row.maxHeartRate, "bpm"),
    metric("daily.spo2.average", row.averageSpo2Value, "%"),
    metric("daily.spo2.lowest", row.lowestSpo2Value, "%"),
    metric("daily.stress.average", stress?.averageStressLevel, "score"),
    metric("daily.stress.maximum", stress?.maxStressLevel, "score"),
    metric("daily.body_battery.charged", battery?.chargedValue, "score"),
    metric("daily.body_battery.drained", battery?.drainedValue, "score"),
    metric("daily.body_battery.highest", bodyBatteryValue(row, "HIGHEST"), "score"),
    metric("daily.body_battery.lowest", bodyBatteryValue(row, "LOWEST"), "score"),
    metric("daily.body_battery.end", bodyBatteryValue(row, "ENDOFDAY"), "score"),
    metric("daily.respiration.average_waking", respiration?.avgWakingRespirationValue, "brpm"),
    metric("daily.hydration.intake", hydration?.valueInML, "ml"),
    metric("daily.hydration.goal", hydration?.adjustedGoalInML ?? hydration?.goalInML, "ml"),
    metric("daily.hydration.sweat_loss", hydration?.sweatLossInML, "ml"),
  ].filter((item): item is GarminExportMetric => Boolean(item));
  const payload = compact(row, [
    "calendarDate", "durationInMilliseconds", "includesWellnessData", "includesActivityData",
    "includesAllDayPulseOx", "includesSleepPulseOx", "source",
  ]);
  return [{ externalId: date, eventType: "daily_summary", recordedAt: isoTimestamp(date), payload, metrics: values }];
});

const sleepEvents = (rows: JsonRecord[]): GarminExportEvent[] => rows.flatMap((row) => {
  const date = textValue(row.calendarDate);
  if (!date) return [];
  const scores = isRecord(row.sleepScores) ? row.sleepScores : undefined;
  const spo2 = isRecord(row.spo2SleepSummary) ? row.spo2SleepSummary : undefined;
  const start = isoTimestamp(row.sleepStartTimestampGMT, date);
  const end = isoTimestamp(row.sleepEndTimestampGMT, date);
  const duration = Math.max(0, (new Date(end).valueOf() - new Date(start).valueOf()) / 1000);
  const values = [
    metric("sleep.duration", duration, "s"),
    metric("sleep.deep", row.deepSleepSeconds, "s"),
    metric("sleep.light", row.lightSleepSeconds, "s"),
    metric("sleep.rem", row.remSleepSeconds, "s"),
    metric("sleep.awake", row.awakeSleepSeconds, "s"),
    metric("sleep.score", scores?.overallScore, "score"),
    metric("sleep.stress.average", row.avgSleepStress, "score"),
    metric("sleep.respiration.average", row.averageRespiration, "brpm"),
    metric("sleep.spo2.average", spo2?.averageSPO2 ?? spo2?.averageSpO2Value ?? spo2?.averageSpo2, "%"),
    metric("sleep.spo2.lowest", spo2?.lowestSPO2, "%"),
    metric("sleep.heart_rate.average", spo2?.averageHR, "bpm"),
  ].filter((item): item is GarminExportMetric => Boolean(item));
  const payload = compact(row, [
    "calendarDate", "sleepWindowConfirmationType", "awakeCount", "restlessMomentCount",
    "breathingDisruptionSeverity", "napList", "sleepScores",
  ]);
  return [{ externalId: date, eventType: "sleep_summary", recordedAt: start, endedAt: end, payload, metrics: values }];
});

const activityEvents = (rows: JsonRecord[]): GarminExportEvent[] => rows.flatMap((row) => {
  const id = numberValue(row.activityId);
  if (id === undefined) return [];
  const start = isoTimestamp(row.startTimeGmt ?? row.beginTimestamp);
  const durationMs = numberValue(row.duration);
  const durationSeconds = durationMs === undefined ? undefined : durationMs / 1000;
  const endedAt = durationSeconds === undefined
    ? undefined
    : new Date(new Date(start).valueOf() + durationSeconds * 1000).toISOString();
  const values = [
    metric("activity.duration", durationSeconds, "s"),
    metric("activity.distance", row.distance, "m"),
    metric("activity.calories", row.calories, "kcal"),
    metric("activity.heart_rate.average", row.avgHr, "bpm"),
    metric("activity.heart_rate.maximum", row.maxHr, "bpm"),
    metric("activity.elevation.gain", row.elevationGain, "m"),
    metric("activity.training_load", row.activityTrainingLoad, "score"),
    metric("activity.training_effect.aerobic", row.aerobicTrainingEffect, "score"),
    metric("activity.training_effect.anaerobic", row.anaerobicTrainingEffect, "score"),
  ].filter((item): item is GarminExportMetric => Boolean(item));
  const payload = compact(row, [
    "activityId", "name", "activityType", "sportType", "timeZoneId", "startTimeLocal",
    "elapsedDuration", "movingDuration", "avgSpeed", "maxSpeed", "elevationGain",
    "elevationLoss", "avgRunCadence", "maxRunCadence", "avgStrideLength", "avgPower",
    "maxPower", "normPower", "vO2MaxValue", "workoutFeel", "workoutRpe", "totalSets",
    "totalReps", "differenceBodyBattery", "trainingEffectLabel",
  ]);
  return [{ externalId: String(id), eventType: "activity_summary", recordedAt: start, endedAt, payload, metrics: values }];
});

const healthStatusEvents = (rows: JsonRecord[]): GarminExportEvent[] => rows.flatMap((row) => {
  const date = textValue(row.calendarDate);
  if (!date || !Array.isArray(row.metrics)) return [];
  const values = row.metrics.filter(isRecord).flatMap((item) => {
    const kind = textValue(item.type)?.toLowerCase();
    if (!kind) return [];
    const units: Record<string, string> = { hrv: "ms", hr: "bpm", spo2: "%", skin_temp_c: "C", respiration: "brpm" };
    const normalized = metric(`health_status.${kind}`, item.value, units[kind], compact(item, [
      "baselineUpperLimit", "baselineLowerLimit", "status", "percentage", "feedbackKey",
    ]));
    return normalized ? [normalized] : [];
  });
  return [{
    externalId: date,
    eventType: "health_status",
    recordedAt: isoTimestamp(row.updateTimestampUTC ?? date, date),
    payload: compact(row, ["calendarDate", "outliersCount"]),
    metrics: values,
  }];
});

const timestampedEvents = (
  rows: JsonRecord[],
  eventType: string,
  valueMappings: Array<[string, string, string?]>,
  payloadKeys: string[],
  timestampKey = "timestamp",
): GarminExportEvent[] => rows.flatMap((row) => {
  const date = textValue(row.calendarDate) ?? (typeof row.calendarDate === "number"
    ? isoTimestamp(row.calendarDate).slice(0, 10)
    : undefined);
  if (!date) return [];
  const recordedAt = isoTimestamp(row[timestampKey] ?? row.calendarDate, date);
  const device = row.deviceId === undefined ? "device" : String(row.deviceId);
  const externalId = `${recordedAt}:${device}`;
  const metrics = valueMappings.map(([type, key, unit]) => metric(type, row[key], unit))
    .filter((item): item is GarminExportMetric => Boolean(item));
  return [{ externalId, eventType, recordedAt, payload: compact(row, ["calendarDate", ...payloadKeys]), metrics }];
});

export const parseGarminExport = async (root: string): Promise<GarminExportEvent[]> => {
  const files = (await walk(root)).filter((file) => file.endsWith(".json"));
  const named = (pattern: RegExp) => files.filter((file) => pattern.test(file));
  const events: GarminExportEvent[] = [];

  events.push(...dailyEvents(await loadRows(named(/UDSFile_.*\.json$/))));
  events.push(...sleepEvents(await loadRows(named(/_sleepData\.json$/))));

  const activityRows: JsonRecord[] = [];
  for (const file of named(/summarizedActivities\.json$/)) {
    const parsed: unknown = JSON.parse(await readFile(file, "utf8"));
    const container = Array.isArray(parsed) && isRecord(parsed[0]) ? parsed[0].summarizedActivitiesExport : undefined;
    if (Array.isArray(container)) activityRows.push(...container.filter(isRecord));
  }
  events.push(...activityEvents(activityRows));
  events.push(...healthStatusEvents(await loadRows(named(/_healthStatusData\.json$/))));
  events.push(...timestampedEvents(
    await loadRows(named(/TrainingReadinessDTO_.*\.json$/)),
    "training_readiness",
    [
      ["training.readiness", "score", "score"],
      ["training.hrv_weekly_average", "hrvWeeklyAverage", "ms"],
      ["training.acute_load", "acuteLoad", "score"],
      ["training.recovery_time", "recoveryTime", "min"],
    ],
    ["level", "feedbackLong", "feedbackShort", "sleepScore", "validSleep"],
  ));
  events.push(...timestampedEvents(
    await loadRows(named(/MetricsAcuteTrainingLoad_.*\.json$/)),
    "training_load",
    [
      ["training.load.acute", "dailyTrainingLoadAcute", "score"],
      ["training.load.chronic", "dailyTrainingLoadChronic", "score"],
      ["training.load.ratio", "dailyAcuteChronicWorkloadRatio", "ratio"],
    ],
    ["acwrPercent", "acwrStatus", "acwrStatusFeedback"],
  ));
  events.push(...timestampedEvents(
    await loadRows(named(/TrainingHistory_.*\.json$/)),
    "training_status",
    [],
    ["sport", "subSport", "trainingStatus", "fitnessLevelTrend", "trainingStatus2FeedbackPhrase"],
  ));
  events.push(...timestampedEvents(
    await loadRows(named(/MetricsMaxMetData_.*\.json$/)),
    "vo2_max",
    [["fitness.vo2_max", "vo2MaxValue", "ml/kg/min"]],
    ["sport", "subSport", "maxMet", "maxMetCategory"],
    "updateTimestamp",
  ));
  events.push(...timestampedEvents(
    await loadRows(named(/RunRacePredictions_.*\.json$/)),
    "race_prediction",
    [
      ["race_prediction.5k", "raceTime5K", "s"],
      ["race_prediction.10k", "raceTime10K", "s"],
      ["race_prediction.half", "raceTimeHalf", "s"],
      ["race_prediction.marathon", "raceTimeMarathon", "s"],
    ],
    [],
  ));

  const unique = new Map<string, GarminExportEvent>();
  for (const event of events) unique.set(`${event.eventType}:${event.externalId}`, event);
  return [...unique.values()].sort((a, b) => a.recordedAt.localeCompare(b.recordedAt));
};
