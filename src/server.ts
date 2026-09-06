import { buildApp } from "./app.js";
import { loadConfig } from "./config.js";
import { createPool } from "./db.js";
import { HealthRepository } from "./repository.js";
const config=loadConfig();const db=createPool(config);const app=buildApp(config,new HealthRepository(db));const shutdown=async()=>{await app.close();await db.end();};process.on("SIGINT",shutdown);process.on("SIGTERM",shutdown);await app.listen({port:config.PORT,host:config.HOST});
