import { parse } from "@babel/parser";

interface Node {
  readonly type?: string;
  readonly start?: number;
  readonly end?: number;
  readonly value?: string;
  readonly name?: string;
  readonly [key: string]: unknown;
}
export interface ModuleSpecifier {
  readonly value: string;
  readonly start: number;
  readonly end: number;
  readonly runtimeAsset: boolean;
}
const node = (value: unknown): Node | undefined =>
  value && typeof value === "object" && "type" in value ? (value as Node) : undefined;
const metaUrl = (value: unknown): boolean => {
  const member = node(value);
  return (
    member?.type === "MemberExpression" &&
    node(member.object)?.type === "MetaProperty" &&
    node(member.property)?.name === "url"
  );
};

/** Inspect syntax positions only: comments, regexes and generated consumer code are untouched. */
export const moduleSpecifiers = (source: string): readonly ModuleSpecifier[] => {
  const ast = parse(source, {
    sourceType: "module",
    plugins: ["typescript"],
    createImportExpressions: true,
  });
  const result: ModuleSpecifier[] = [];
  const add = (value: unknown, runtimeAsset = false) => {
    const literal = node(value);
    if (
      literal?.type !== "StringLiteral" ||
      literal.value === undefined ||
      literal.start === undefined ||
      literal.end === undefined
    )
      return;
    result.push({ value: literal.value, start: literal.start, end: literal.end, runtimeAsset });
  };
  const visit = (current: Node) => {
    if (
      [
        "ImportDeclaration",
        "ExportNamedDeclaration",
        "ExportAllDeclaration",
        "ImportExpression",
      ].includes(current.type ?? "")
    )
      add(current.source);
    if (current.type === "TSImportType") add(current.argument);
    if (current.type === "TSExternalModuleReference") add(current.expression);
    if (current.type === "NewExpression" && node(current.callee)?.name === "URL") {
      const args = current.arguments as unknown[];
      if (metaUrl(args[1])) add(args[0], true);
    }
    for (const value of Object.values(current)) {
      if (Array.isArray(value))
        for (const item of value) {
          const child = node(item);
          if (child) visit(child);
        }
      else {
        const child = node(value);
        if (child) visit(child);
      }
    }
  };
  visit(ast as unknown as Node);
  return result;
};
export const rewriteSpecifiers = (source: string, rewrite: (value: string) => string) => {
  let result = source;
  for (const specifier of [...moduleSpecifiers(source)].sort((a, b) => b.start - a.start)) {
    const replacement = rewrite(specifier.value);
    if (replacement !== specifier.value)
      result =
        result.slice(0, specifier.start) +
        JSON.stringify(replacement) +
        result.slice(specifier.end);
  }
  return result;
};
