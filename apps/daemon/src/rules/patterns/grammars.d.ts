// Tree-sitter grammars, imported as files (`with { type: "file" }`) for `bun build --compile` to embed.
declare module "*.so" {
  const path: string;
  export default path;
}
