export const providers=["garmin","strava","apple_health","manual"] as const;
export type Provider=(typeof providers)[number];
export type NormalizedMetric={externalId:string;type:string;recordedAt:Date;endedAt?:Date;value?:number;unit?:string;data:Record<string,unknown>};
export interface IntegrationAdapter{provider:Provider;identifyEvents(payload:unknown):Array<{externalId:string;eventType:string;payload:unknown}>;normalize(eventType:string,payload:unknown):NormalizedMetric[]}
