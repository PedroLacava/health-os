import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parseGarminExport } from "../src/integrations/garmin-export.js";

const arg = (name: string): string | undefined => {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
};

const source = arg("--source");
const userId = arg("--user-id");
const output = resolve(arg("--output") ?? ".garmin-import");
const batchSize = Number(arg("--batch-size") ?? "500");
const onlyEventType = arg("--event-type");

if (!source || !userId || !/^[0-9a-f-]{36}$/i.test(userId)) {
  throw new Error("Usage: npm run garmin:prepare -- --source <extracted-directory> --user-id <uuid> [--output <directory>] [--batch-size 500]");
}
if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 1000) {
  throw new Error("batch-size must be an integer between 1 and 1000");
}

const parsedEvents = await parseGarminExport(resolve(source));
const events = onlyEventType
  ? parsedEvents.filter((event) => event.eventType === onlyEventType)
  : parsedEvents;
await mkdir(output, { recursive: true });

for (let offset = 0; offset < events.length; offset += batchSize) {
  const batch = events.slice(offset, offset + batchSize).map((event) => ({
    external_id: event.externalId,
    event_type: event.eventType,
    recorded_at: event.recordedAt,
    ended_at: event.endedAt ?? null,
    payload: event.payload,
    metrics: event.metrics.map((item) => ({
      type: item.type,
      value: item.value ?? null,
      unit: item.unit ?? null,
      data: item.data ?? {},
    })),
  }));
  const json = JSON.stringify(batch).replaceAll("$healthos$", "healthos");
  const sql = `with event_input as (\n` +
    `  select * from jsonb_to_recordset($healthos$${json}$healthos$::jsonb) as x(\n` +
    `    external_id text, event_type text, recorded_at timestamptz, ended_at timestamptz, payload jsonb, metrics jsonb\n` +
    `  )\n` +
    `), upserted_events as (\n` +
    `  insert into public.raw_events(user_id, provider, external_id, event_type, payload, processed_at)\n` +
    `  select '${userId}'::uuid, 'garmin', external_id, event_type, payload, now() from event_input\n` +
    `  on conflict (user_id, provider, external_id, event_type) do update\n` +
    `    set payload = excluded.payload, processed_at = excluded.processed_at\n` +
    `  returning id, external_id, event_type\n` +
    `), metric_input as (\n` +
    `  select e.external_id, e.event_type, e.recorded_at, e.ended_at, m.type, m.value, m.unit, m.data\n` +
    `  from event_input e\n` +
    `  cross join lateral jsonb_to_recordset(e.metrics) as m(type text, value double precision, unit text, data jsonb)\n` +
    `)\n` +
    `insert into public.metrics(user_id, provider, external_id, type, recorded_at, ended_at, value, unit, data, raw_event_id)\n` +
    `select '${userId}'::uuid, 'garmin', m.external_id, m.type, m.recorded_at, m.ended_at, m.value, m.unit, m.data, r.id\n` +
    `from metric_input m join upserted_events r using (external_id, event_type)\n` +
    `on conflict (user_id, provider, external_id, type) do update set\n` +
    `  recorded_at = excluded.recorded_at, ended_at = excluded.ended_at, value = excluded.value,\n` +
    `  unit = excluded.unit, data = excluded.data, raw_event_id = excluded.raw_event_id, updated_at = now();\n`;
  const number = String(offset / batchSize + 1).padStart(3, "0");
  await writeFile(resolve(output, `batch-${number}.sql`), sql);
}

const metricCount = events.reduce((sum, event) => sum + event.metrics.length, 0);
await writeFile(resolve(output, "manifest.json"), JSON.stringify({
  userId,
  events: events.length,
  metrics: metricCount,
  batches: Math.ceil(events.length / batchSize),
}, null, 2));
console.log(JSON.stringify({ output, events: events.length, metrics: metricCount, batches: Math.ceil(events.length / batchSize) }));
