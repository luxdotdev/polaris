/** The Host's name in messages a person reads. */
import { hostname } from "node:os";

/** "workbox" for "workbox.lan": the name the user knows the machine by. */
export const shortHostName = (name = hostname()): string => name.split(".")[0] || name;
