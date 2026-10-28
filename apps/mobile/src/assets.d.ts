/** Metro bundles an imported image as an asset reference that `<Image source>` takes. */
declare module "*.png" {
  import type { ImageSourcePropType } from "react-native";

  const source: ImageSourcePropType;
  export default source;
}
