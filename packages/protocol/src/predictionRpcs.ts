import { RpcGroup } from "effect/rpc";
import {
  PredictionCapabilityQuery,
  PredictionContextQuery,
  PredictionComplete,
  PredictionServerQuery,
} from "./prediction.ts";
import { PredictionEdit } from "./editPrediction.ts";

export const PredictionRpcs = RpcGroup.make(
  PredictionCapabilityQuery,
  PredictionContextQuery,
  PredictionComplete,
  PredictionEdit,
  PredictionServerQuery
);
