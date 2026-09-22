import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { createClient } from "@supabase/supabase-js";
import Fastify, { type FastifyReply, type FastifyRequest } from "fastify";
import { z } from "zod";
import type { Config } from "./config.js";
import { providers } from "./domain.js";
import { garminAdapter } from "./integrations/garmin.js";
import type { HealthRepository } from "./repository.js";

const publicFile = (name: string) => readFile(join(process.cwd(), "public", name), "utf8");

export const buildApp = (config: Config, repository: HealthRepository) => {
  const app = Fastify({ logger: config.NODE_ENV !== "test" });
  const supabase = config.SUPABASE_URL && config.SUPABASE_PUBLISHABLE_KEY
    ? createClient(config.SUPABASE_URL, config.SUPABASE_PUBLISHABLE_KEY, { auth: { persistSession: false } })
    : null;

  const authenticatedUser = async (request: FastifyRequest, reply: FastifyReply) => {
    const authorization = request.headers.authorization;
    if (!supabase || !authorization?.startsWith("Bearer ")) {
      await reply.code(401).send({ error: "unauthorized" });
      return null;
    }
    const { data: { user }, error } = await supabase.auth.getUser(authorization.slice(7));
    if (error || !user) {
      await reply.code(401).send({ error: "unauthorized" });
      return null;
    }
    return user;
  };

  app.get("/", async (_request, reply) => reply.type("text/html; charset=utf-8").send(await publicFile("index.html")));
  app.get("/app.js", async (_request, reply) => reply.type("application/javascript; charset=utf-8").send(await publicFile("app.js")));
  app.get("/styles.css", async (_request, reply) => reply.type("text/css; charset=utf-8").send(await publicFile("styles.css")));
  app.get("/v1/client-config", async (_request, reply) => {
    if (!config.SUPABASE_URL || !config.SUPABASE_PUBLISHABLE_KEY) {
      return reply.code(503).send({ error: "supabase_client_not_configured" });
    }
    return { supabaseUrl: config.SUPABASE_URL, supabasePublishableKey: config.SUPABASE_PUBLISHABLE_KEY };
  });

  app.get("/health", async (_request, reply) => {
    try {
      await repository.ping();
      return { status: "ok", database: "connected" };
    } catch {
      return reply.code(503).send({ status: "degraded", database: "unavailable" });
    }
  });

  app.post("/v1/integrations/garmin/webhooks", async (request, reply) => {
    if (config.GARMIN_WEBHOOK_SECRET && request.headers["x-webhook-secret"] !== config.GARMIN_WEBHOOK_SECRET) {
      return reply.code(401).send({ error: "invalid webhook secret" });
    }
    const owner = config.HEALTH_OS_USER_ID;
    if (!owner) return reply.code(503).send({ error: "health_os_user_not_configured" });
    const events = garminAdapter.identifyEvents(request.body);
    let accepted = 0;
    for (const event of events) {
      const id = await repository.saveEvent({ userId: owner, provider: "garmin", ...event });
      if (!id) continue;
      for (const metric of garminAdapter.normalize(event.eventType, event.payload)) {
        await repository.saveMetric(owner, "garmin", metric, id);
      }
      accepted += 1;
    }
    return reply.code(202).send({ received: events.length, accepted });
  });

  app.post("/v1/integrations/:provider/sync", async (request, reply) => {
    const user = await authenticatedUser(request, reply);
    if (!user) return;
    const parsed = z.object({ provider: z.enum(providers) }).safeParse(request.params);
    if (!parsed.success) return reply.code(400).send({ error: "unsupported provider" });
    return reply.code(202).send(await repository.requestSync(user.id, parsed.data.provider));
  });

  app.get("/v1/metrics", async (request, reply) => {
    const user = await authenticatedUser(request, reply);
    if (!user) return;
    const parsed = z.object({
      from: z.coerce.date().optional(),
      to: z.coerce.date().optional(),
      type: z.string().optional(),
    }).safeParse(request.query);
    if (!parsed.success) return reply.code(400).send({ error: "invalid filters" });
    return repository.listMetrics(user.id, parsed.data);
  });

  return app;
};
