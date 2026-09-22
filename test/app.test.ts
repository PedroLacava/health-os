import { describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import type { Config } from "../src/config.js";
import type { HealthRepository } from "../src/repository.js";

const config: Config = {
  NODE_ENV: "test",
  PORT: 3000,
  HOST: "127.0.0.1",
  DATABASE_URL: "postgresql://test:test@localhost:5432/test",
  DATABASE_SSL: false,
};

const repository = {
  ping: async () => undefined,
} as unknown as HealthRepository;

describe("health os web app", () => {
  it("serves the dashboard shell", async () => {
    const app = buildApp(config, repository);
    const response = await app.inject({ method: "GET", url: "/" });
    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toContain("text/html");
    expect(response.body).toContain("Como você está hoje");
    await app.close();
  });

  it("does not expose health metrics without authentication", async () => {
    const app = buildApp(config, repository);
    const response = await app.inject({ method: "GET", url: "/v1/metrics" });
    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({ error: "unauthorized" });
    await app.close();
  });

  it("does not expose client configuration when it is missing", async () => {
    const app = buildApp(config, repository);
    const response = await app.inject({ method: "GET", url: "/v1/client-config" });
    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({ error: "supabase_client_not_configured" });
    await app.close();
  });
});
