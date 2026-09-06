import pg from "pg";
import type { Config } from "./config.js";
export const createPool=(config:Config)=>new pg.Pool({connectionString:config.DATABASE_URL,ssl:config.DATABASE_SSL?{rejectUnauthorized:false}:false,max:10});
export type Database=pg.Pool;
