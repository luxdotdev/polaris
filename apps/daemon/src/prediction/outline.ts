import type { SgNode } from "@ast-grep/napi";
import { loadAstGrep } from "../rules/patterns/native.ts";

export interface Outline {
  imports: string[];
  signatures: string[];
}

function publicMember(node: SgNode) {
  return (
    node.isNamed() &&
    node.kind() !== "class_static_block" &&
    node.field("name")?.kind() !== "private_property_identifier" &&
    !node
      .children()
      .some((child) => child.kind() === "accessibility_modifier" && child.text() !== "public")
  );
}

function signature(node: SgNode): string {
  const kind = node.kind();

  if (kind === "lexical_declaration" || kind === "variable_declaration") {
    return node
      .children()
      .filter((child) => child.kind() === "variable_declarator")
      .map(variableSignature)
      .join("\n");
  }

  const body = node.field("body");

  if (kind === "class_declaration" && body !== null) {
    const head = node.text().slice(0, body.range().start.index - node.range().start.index);

    return `${head}{\n${body.children().filter(publicMember).map(signature).join("\n")}\n}`;
  }

  if (
    body !== null &&
    ["function_declaration", "generator_function_declaration", "method_definition"].includes(
      String(kind)
    )
  ) {
    return (
      node
        .text()
        .slice(0, body.range().start.index - node.range().start.index)
        .trimEnd() + ";"
    );
  }

  if (kind === "public_field_definition") {
    const value = node.field("value");

    return value === null
      ? node.text()
      : node
          .text()
          .slice(0, value.range().start.index - node.range().start.index)
          .replace(/=\s*$/, "")
          .trimEnd() + ";";
  }

  return node.text();
}

function variableSignature(node: SgNode): string {
  const name = node.field("name")?.text() ?? "";
  const type = node.field("type");
  const value = node.field("value");

  if (type !== null) return `const ${name}${type.text()};`;

  if (value !== null && ["arrow_function", "function_expression"].includes(String(value.kind()))) {
    const parameters =
      value.field("parameters")?.text() ?? value.field("parameter")?.text() ?? "()";

    const returns = value.field("return_type")?.text() ?? "";

    return `const ${name}: ${parameters}${returns};`;
  }

  return `const ${name};`;
}

/** Tree-sitter reads declarations only; no module resolution or Workspace code executes. */
export async function parseOutline(path: string, text: string): Promise<Outline> {
  if (!/\.[cm]?[jt]sx?$/.test(path) || text.length > 131072) return { imports: [], signatures: [] };
  const napi = await loadAstGrep();

  const root = napi
    .parse(/\.[jt]sx$/.test(path) ? napi.Lang.Tsx : napi.Lang.TypeScript, text)
    .root();

  const imports: string[] = [];
  const signatures: string[] = [];

  for (const node of root.children()) {
    if (node.kind() === "import_statement") {
      const source = node.field("source")?.text();

      if (source !== undefined && imports.length < 8) imports.push(source.slice(1, -1));
    }

    if (node.kind() === "export_statement" && signatures.length < 32) {
      const declaration = node.field("declaration");

      if (declaration !== null) signatures.push(`export ${signature(declaration)}`.slice(0, 2048));
    }
  }

  return { imports, signatures };
}
