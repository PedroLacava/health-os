export const providers=["garmin","strava","apple_health","manual"] as const;
export type Provider=(typeof providers)[number];

export const provenances=["measured","estimated","self_reported","inferred"] as const;
export type Provenance=(typeof provenances)[number];

export type NormalizedMetric={
  externalId:string;
  type:string;
  recordedAt:Date;
  endedAt?:Date;
  value?:number;
  unit?:string;
  provenance?:Provenance;
  confidence?:number;
  data:Record<string,unknown>;
};

export interface IntegrationAdapter{
  provider:Provider;
  identifyEvents(payload:unknown):Array<{externalId:string;eventType:string;payload:unknown}>;
  normalize(eventType:string,payload:unknown):NormalizedMetric[];
}
