import { ServiceError } from "../services.ts";

export const storeError = (what: string) => (cause: unknown) =>
  new ServiceError({ service: "store", message: `failed to ${what}`, cause });
