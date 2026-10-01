const MULTILINE_DECLARATIONS = [
  "multiline-const",
  "multiline-let",
  "multiline-var",
  "multiline-using",
];

const DECLARE_FUNCTION =
  ':matches(TSDeclareFunction, ExportNamedDeclaration[declaration.type="TSDeclareFunction"])';

const DECLARE_OR_IMPLEMENT_FUNCTION =
  ':matches(TSDeclareFunction, FunctionDeclaration, ExportNamedDeclaration[declaration.type="TSDeclareFunction"], ExportNamedDeclaration[declaration.type="FunctionDeclaration"])';

/**
 * The options for `@stylistic/padding-line-between-statements`.
 *
 * These are the options of the `require-readable-spacing` rule in
 * [anti-slop](https://github.com/dmmulroy/anti-slop/blob/c44ef22ca116d0ba62a3ff663a0bd13a3f3fa40b/src/rules/require-readable-spacing.ts).
 * They add blank lines and do not remove them. Short local bindings, imports, and function overloads
 * stay together.
 */
export const PADDING_LINE_OPTIONS = [
  { blankLine: "always", prev: "import", next: "*" },
  { blankLine: "always", prev: "*", next: { selector: "Program > :not(ImportDeclaration)" } },
  { blankLine: "always", prev: { selector: "Program > :not(ImportDeclaration)" }, next: "*" },
  { blankLine: "always", prev: "*", next: ["function", "class", "interface", "type"] },
  { blankLine: "always", prev: ["function", "class", "interface", "type"], next: "*" },
  { blankLine: "always", prev: "*", next: MULTILINE_DECLARATIONS },
  { blankLine: "always", prev: MULTILINE_DECLARATIONS, next: "*" },
  { blankLine: "always", prev: "*", next: ["return", "if", "switch", "try", "for", "while", "do"] },
  { blankLine: "always", prev: "block-like", next: "*" },
  { blankLine: "any", prev: "import", next: "import" },
  {
    blankLine: "any",
    prev: { selector: DECLARE_FUNCTION },
    next: { selector: DECLARE_OR_IMPLEMENT_FUNCTION },
  },
];
