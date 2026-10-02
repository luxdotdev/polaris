/**
 * The breadcrumb's symbol (DESIGN.md, Editor: breadcrumbs; Paper E1's
 * "reconnect()"): the innermost function or class around the cursor, read
 * from the grammar's syntax tree. Nothing for plain text.
 */
import { syntaxTree } from "@codemirror/language";
import type { EditorState } from "@codemirror/state";

type SyntaxNode = ReturnType<ReturnType<typeof syntaxTree>["resolveInner"]>;

/** Node types that name a scope, across the bundled grammars. */
const FUNCTIONS = new Set([
  "FunctionDeclaration",
  "MethodDeclaration",
  "FunctionDefinition",
  "FunctionItem",
  "FuncDecl",
  "MethodDecl",
  "ArrowFunction",
  "FunctionExpression",
]);

const CLASSES = new Set([
  "ClassDeclaration",
  "ClassDefinition",
  "InterfaceDeclaration",
  "StructItem",
  "ImplItem",
  "TraitItem",
  "EnumItem",
  "TypeSpec",
]);

const NAMES = new Set([
  "VariableDefinition",
  "PropertyDefinition",
  "TypeDefinition",
  "Definition",
  "BoundIdentifier",
  "Identifier",
  "VariableName",
  "TypeIdentifier",
  "FieldIdentifier",
]);

const nameOf = (state: EditorState, node: SyntaxNode): string | null => {
  for (let child = node.firstChild; child !== null; child = child.nextSibling) {
    if (NAMES.has(child.name)) return state.sliceDoc(child.from, child.to);
  }

  // `const reconnect = () => …`: the arrow's name is its declaration's.
  const declared = node.parent?.getChild("VariableDefinition") ?? null;

  return declared === null ? null : state.sliceDoc(declared.from, declared.to);
};

export const symbolAt = (state: EditorState, pos: number): string | null => {
  for (
    let node: SyntaxNode | null = syntaxTree(state).resolveInner(pos, -1);
    node !== null;
    node = node.parent
  ) {
    const isFunction = FUNCTIONS.has(node.name);

    if (!isFunction && !CLASSES.has(node.name)) continue;
    const name = nameOf(state, node);

    if (name !== null && name.length <= 80) return isFunction ? `${name}()` : name;
  }

  return null;
};
