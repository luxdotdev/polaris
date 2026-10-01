/** A worker session's Review gets the worker action instead of the session Accept (side effect). */
import "../../accept/install.ts";
import { fillPrimaryAction } from "../surface.ts";
import { SessionOrWorkerAction } from "./WorkerAction.tsx";

fillPrimaryAction("session", SessionOrWorkerAction);
