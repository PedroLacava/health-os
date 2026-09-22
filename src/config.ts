import "dotenv/config";
import { z } from "zod";

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(3000),
  HOST: z.string().default("0.0.0.0"),
  DATABASE_URL: z.string().min(1),
  DATABASE_SSL: z.enum(["true", "false"]).default("false").transform((value) => value === "true"),
  GARMIN_WEBHOOK_SECRET: z.string().optional(),
  HEALTH_OS_USER_ID: z.string().uuid().optional(),
  SUPABASE_URL: z.string().url().optional(),
  SUPABASE_PUBLISHABLE_KEY: z.string().min(1).optional(),
});

export type Config = z.infer<typeof schema>;
export const loadConfig = (environment = process.env): Config => schema.parse(environment);
