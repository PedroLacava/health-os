import { createHash } from "node:crypto";
import type { IntegrationAdapter, NormalizedMetric } from "../domain.js";

type JsonRecord=Record<string,unknown>;
const isRecord=(v:unknown):v is JsonRecord=>Boolean(v)&&typeof v==="object"&&!Array.isArray(v);
const stableId=(p:unknown)=>createHash("sha256").update(JSON.stringify(p)).digest("hex");
const asDate=(v:unknown):Date|undefined=>{
  if(typeof v!=="string"&&typeof v!=="number")return undefined;
  const d=new Date(v);
  return Number.isNaN(d.valueOf())?undefined:d;
};

const aliases:Record<string,{type:string;unit?:string}>={
  HKQuantityTypeIdentifierHeartRate:{type:"heart_rate",unit:"bpm"},
  HKQuantityTypeIdentifierRestingHeartRate:{type:"resting_heart_rate",unit:"bpm"},
  HKQuantityTypeIdentifierHeartRateVariabilitySDNN:{type:"hrv",unit:"ms"},
  HKQuantityTypeIdentifierStepCount:{type:"steps",unit:"count"},
  HKQuantityTypeIdentifierActiveEnergyBurned:{type:"active_energy",unit:"kcal"},
  HKQuantityTypeIdentifierBodyMass:{type:"weight",unit:"kg"},
  HKQuantityTypeIdentifierVO2Max:{type:"vo2_max",unit:"ml/kg/min"},
  HKCategoryTypeIdentifierSleepAnalysis:{type:"sleep"}
};

const normalizeSample=(p:JsonRecord):NormalizedMetric|undefined=>{
  const identifier=String(p.identifier??p.type??"");
  const mapped=aliases[identifier]??(identifier?{type:identifier}:undefined);
  const recordedAt=asDate(p.startDate??p.start_at??p.recordedAt);
  if(!mapped||!recordedAt)return undefined;
  const value=typeof p.value==="number"?p.value:undefined;
  const externalId=String(p.uuid??p.externalId??stableId(p));
  return {
    externalId,
    type:mapped.type,
    recordedAt,
    endedAt:asDate(p.endDate??p.end_at),
    value,
    unit:typeof p.unit==="string"?p.unit:mapped.unit,
    provenance:"measured",
    data:p
  };
};

export const appleHealthAdapter:IntegrationAdapter={
  provider:"apple_health",
  identifyEvents(payload){
    const samples=Array.isArray(payload)?payload:isRecord(payload)&&Array.isArray(payload.samples)?payload.samples:[];
    return samples.filter(isRecord).map(sample=>({
      externalId:String(sample.uuid??sample.externalId??stableId(sample)),
      eventType:"samples",
      payload:sample
    }));
  },
  normalize(eventType,payload){
    if(eventType!=="samples"||!isRecord(payload))return[];
    const metric=normalizeSample(payload);
    return metric?[metric]:[];
  }
};
