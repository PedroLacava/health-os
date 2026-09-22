import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2.95.0";

type Sample = {
  externalId?: string;
  type: string;
  startDate: string;
  endDate?: string;
  value?: number;
  unit?: string;
  source?: string;
  metadata?: Record<string, unknown>;
};

type AuthContext = { userId: string; client: SupabaseClient };

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { "content-type": "application/json" },
});

const sha256 = async (value: string) => {
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(hash)).map((byte) => byte.toString(16).padStart(2, "0")).join("");
};

const stableId = async (value: unknown) => sha256(JSON.stringify(value));

const authenticate = async (req: Request): Promise<AuthContext | null> => {
  const url = Deno.env.get("SUPABASE_URL") ?? "";
  const customToken = req.headers.get("x-health-os-token");

  if (customToken) {
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    if (!serviceKey) return null;
    const admin = createClient(url, serviceKey, { auth: { persistSession: false } });
    const tokenHash = await sha256(customToken);
    const now = new Date().toISOString();
    const { data, error } = await admin.from("ingestion_tokens")
      .select("id,user_id,expires_at")
      .eq("token_hash", tokenHash)
      .is("revoked_at", null)
      .maybeSingle();
    if (error || !data || (data.expires_at && data.expires_at <= now)) return null;
    await admin.from("ingestion_tokens").update({ last_used_at: now }).eq("id", data.id);
    return { userId: data.user_id, client: admin };
  }

  const authorization = req.headers.get("authorization");
  if (!authorization?.startsWith("Bearer ")) return null;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
  const client = createClient(url, anonKey, { global: { headers: { Authorization: authorization } } });
  const { data: { user }, error } = await client.auth.getUser(authorization.slice(7));
  return error || !user ? null : { userId: user.id, client };
};

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  const auth = await authenticate(req);
  if (!auth) return json({ error: "unauthorized" }, 401);

  let body: { samples?: Sample[] };
  try {
    body = await req.json();
  } catch {
    return json({ error: "invalid_json" }, 400);
  }
  if (!Array.isArray(body.samples) || body.samples.length === 0 || body.samples.length > 500) {
    return json({ error: "samples_must_contain_1_to_500_items" }, 400);
  }

  let accepted = 0;
  const errors: Array<{ index: number; reason: string }> = [];
  for (const [index, sample] of body.samples.entries()) {
    if (!sample || typeof sample.type !== "string" || !sample.type ||
      typeof sample.startDate !== "string" || Number.isNaN(Date.parse(sample.startDate)) ||
      (sample.endDate && Number.isNaN(Date.parse(sample.endDate))) ||
      (sample.value !== undefined && typeof sample.value !== "number")) {
      errors.push({ index, reason: "invalid_sample" });
      continue;
    }

    const externalId = sample.externalId || await stableId(sample);
    const rawPayload = { ...sample, source: sample.source || "apple_health" };
    let { data: rawEvent, error: rawError } = await auth.client.from("raw_events").upsert({
      user_id: auth.userId,
      provider: "apple_health",
      external_id: externalId,
      event_type: sample.type,
      payload: rawPayload,
      processed_at: new Date().toISOString(),
    }, { onConflict: "user_id,provider,external_id,event_type" }).select("id").single();

    if (rawError || !rawEvent) {
      errors.push({ index, reason: "raw_event_failed" });
      continue;
    }
    const { error: metricError } = await auth.client.from("metrics").upsert({
      user_id: auth.userId,
      provider: "apple_health",
      external_id: externalId,
      type: sample.type,
      recorded_at: new Date(sample.startDate).toISOString(),
      ended_at: sample.endDate ? new Date(sample.endDate).toISOString() : null,
      value: sample.value ?? null,
      unit: sample.unit ?? null,
      data: rawPayload,
      raw_event_id: rawEvent.id,
      updated_at: new Date().toISOString(),
    }, { onConflict: "user_id,provider,external_id,type" });
    if (metricError) {
      errors.push({ index, reason: "metric_failed" });
      continue;
    }
    accepted += 1;
  }

  return json({ received: body.samples.length, accepted, rejected: errors.length, errors }, errors.length ? 207 : 202);
});
