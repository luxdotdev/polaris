/** Fills the Review header's primary action for Agent Sessions (side effect, imported by Review). */
import { fillPrimaryAction } from "../review/surface.ts";
import { AcceptAction } from "./ui/AcceptAction.tsx";

fillPrimaryAction("session", AcceptAction);
