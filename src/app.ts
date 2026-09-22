import Fastify from "fastify";
import { z } from "zod";
import type { Config } from "./config.js";
import { providers } from "./domain.js";
import { garminAdapter } from "./integrations/garmin.js";
import { appleHealthAdapter } from "./integrations/apple-health.js";
import type { HealthRepository } from "./repository.js";

const scale=z.number().int().min(1).max(5).optional();

export const buildApp=(config:Config,repository:HealthRepository)=>{
  const app=Fastify({logger:config.NODE_ENV!=="test"});

  app.get("/health",async(_q,reply)=>{
    try{await repository.ping();return{status:"ok",database:"connected"};}
    catch{return reply.code(503).send({status:"degraded",database:"unavailable"});}
  });

  const ingest=async(provider:"garmin"|"apple_health",adapter:typeof garminAdapter,body:unknown)=>{
    const events=adapter.identifyEvents(body);let accepted=0;
    for(const event of events){
      const id=await repository.saveEvent({provider,...event});
      if(!id)continue;
      for(const m of adapter.normalize(event.eventType,event.payload))await repository.saveMetric(provider,m,id);
      accepted++;
    }
    return{received:events.length,accepted};
  };

  app.post("/v1/integrations/garmin/webhooks",async(request,reply)=>{
    if(config.GARMIN_WEBHOOK_SECRET&&request.headers["x-webhook-secret"]!==config.GARMIN_WEBHOOK_SECRET)
      return reply.code(401).send({error:"invalid webhook secret"});
    return reply.code(202).send(await ingest("garmin",garminAdapter,request.body));
  });

  app.post("/v1/integrations/apple-health/import",async(request,reply)=>{
    return reply.code(202).send(await ingest("apple_health",appleHealthAdapter,request.body));
  });

  app.post("/v1/integrations/:provider/sync",async(request,reply)=>{
    const p=z.object({provider:z.enum(providers)}).safeParse(request.params);
    if(!p.success)return reply.code(400).send({error:"unsupported provider"});
    return reply.code(202).send(await repository.requestSync(p.data.provider));
  });

  app.get("/v1/metrics",async(request,reply)=>{
    const p=z.object({from:z.coerce.date().optional(),to:z.coerce.date().optional(),type:z.string().optional()}).safeParse(request.query);
    if(!p.success)return reply.code(400).send({error:"invalid filters"});
    return repository.listMetrics(p.data);
  });

  app.post("/v1/hydration",async(request,reply)=>{
    const p=z.object({recordedAt:z.coerce.date().optional(),volumeMl:z.number().int().positive().max(5000),source:z.string().max(50).optional()}).safeParse(request.body);
    if(!p.success)return reply.code(400).send({error:"invalid hydration event"});
    return reply.code(201).send(await repository.addHydration(p.data));
  });

  app.post("/v1/checkins",async(request,reply)=>{
    const p=z.object({recordedAt:z.coerce.date().optional(),energy:scale,concentration:scale,stress:scale,hunger:scale,physicalFatigue:scale,wellbeing:scale,notes:z.string().max(2000).optional()}).safeParse(request.body);
    if(!p.success)return reply.code(400).send({error:"invalid check-in"});
    return reply.code(201).send(await repository.addCheckin(p.data));
  });

  app.put("/v1/work-context/:date",async(request,reply)=>{
    const params=z.object({date:z.string().date()}).safeParse(request.params);
    const body=z.object({workload:scale,pressure:scale,interruptions:scale,senseOfControl:scale,meetingMinutes:z.number().int().nonnegative().optional(),tags:z.array(z.string().max(50)).max(20).optional(),notes:z.string().max(2000).optional()}).safeParse(request.body);
    if(!params.success||!body.success)return reply.code(400).send({error:"invalid work context"});
    return repository.upsertWorkContext({...body.data,workDate:params.data.date});
  });

  return app;
};
