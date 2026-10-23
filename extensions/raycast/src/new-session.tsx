/** New Agent Session: the form, its first Turn prefilled from the command's argument. */
import type { LaunchProps } from "@raycast/api";
import { NewSessionForm } from "./components/NewSessionForm.tsx";
import { withPolaris } from "./polaris.tsx";

type Props = LaunchProps<{ arguments: { readonly prompt?: string } }>;

const NewSession = (props: Props) => <NewSessionForm prompt={props.arguments.prompt ?? ""} />;

export default withPolaris(NewSession);
