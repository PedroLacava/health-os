import "dotenv/config";
import { z } from "zod";
const schema = z.object({NODE_ENV:z.enum(["development","test","production"]).default("development"),PORT:z.coerce.number().int().positive().default(3000),HOST:z.string().default("0.0.0.0"),DATABASE_URL:z.string().min(1),DATABASE_SSL:z.enum(["true","false"]).default("false").transform(v=>v==="true"),GARMIN_WEBHOOK_SECRET:z.string().optional()});
export type Config=z.infer<typeof schema>;
export const loadConfig=(environment=process.env):Config=>schema.parse(environment);
