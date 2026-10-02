import { initBotId } from "botid/client/core";

initBotId({ protect: [{ path: "/api/email", method: "POST" }] });
