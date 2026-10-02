import { ConstellationRpcs } from "./rpc.ts";
import { ConstellationTransferRpcs } from "./transfers.ts";

export const ConstellationHostRpcs = ConstellationRpcs.merge(ConstellationTransferRpcs);
