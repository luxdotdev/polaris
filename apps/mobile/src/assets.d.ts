/** Metro turns an image import into the asset's registry number, which `Image` takes as a source. */
declare module "*.png" {
  const source: number;
  export default source;
}
