import { readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  parseFrontmatter,
  type ExtensionAPI,
  type ExtensionContext,
  type SlashCommandInfo,
  type SourceInfo,
  type Theme,
  type ToolInfo,
} from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

interface Row {
  readonly name: string;
  readonly tokens: number;
}

interface Section {
  readonly title: string;
  /** False when the rows cost tokens only when the agent or the user loads them. */
  readonly upfront: boolean;
  readonly rows: ReadonlyArray<Row>;
}

/**
 * The token cost of the resources of a session.
 */
export interface Header {
  readonly sections: ReadonlyArray<Section>;
  /** The tokens of the system prompt and the tool declarations. */
  readonly total: number;
  /** The tokens of the pi system prompt that no section includes. */
  readonly base: number;
}

const MAX_WIDTH = 60;

const estimate = (text: string) => Math.ceil(text.length / 4);
const format = (tokens: number) =>
  tokens < 1000 ? String(tokens) : `${(tokens / 1000).toFixed(1)}k`;
const sum = (rows: ReadonlyArray<Row>) => rows.reduce((total, row) => total + row.tokens, 0);
const byTokens = (a: Row, b: Row) => b.tokens - a.tokens;

const displayPath = (cwd: string, file: string) => {
  const relative = path.relative(cwd, file);
  return relative.startsWith("..") ? file.replace(os.homedir(), "~") : relative;
};

const contextRows = (systemPrompt: string, cwd: string): Array<Row> =>
  Array.from(
    systemPrompt.matchAll(/<project_instructions path="([^"]*)">[\s\S]*?<\/project_instructions>/g),
    ([block, file = ""]) => ({ name: displayPath(cwd, file), tokens: estimate(block) }),
  );

const readSkill = (command: SlashCommandInfo) => {
  const file = command.sourceInfo.path;
  const { frontmatter, body } = parseFrontmatter(readFileSync(file, "utf8"));
  const manual = frontmatter["disable-model-invocation"] === true;
  const listing = `<skill><name>${command.name}</name><description>${command.description ?? ""}</description><location>${file}</location></skill>`;
  const row = {
    name: command.name.replace(/^skill:/, ""),
    tokens: estimate(manual ? body : listing),
  };
  return { manual, row };
};

const ownerKey = (info: SourceInfo) => {
  if (info.source === "builtin" || info.origin === "package") return info.source;
  return info.path;
};

const ownerName = (key: string) =>
  path.parse(
    key
      .replace(/^(npm|git):/, "")
      .replace(/(.)@[^/]*$/, "$1")
      .replace(/\/index\.[jt]s$/, ""),
  ).name;

const toolTokens = (tool: ToolInfo) =>
  estimate(JSON.stringify([tool.name, tool.description, tool.parameters, tool.promptGuidelines]));

const extensionRows = (pi: ExtensionAPI): Array<Row> => {
  const active = new Set(pi.getActiveTools());
  const packages = (pi.getSettings().packages ?? []).map((p) =>
    typeof p === "string" ? p : p.source,
  );
  const totals = new Map(packages.map((key) => [key, 0]));
  for (const tool of pi.getAllTools().filter((t) => active.has(t.name))) {
    const key = ownerKey(tool.sourceInfo);
    totals.set(key, (totals.get(key) ?? 0) + toolTokens(tool));
  }
  return Array.from(totals, ([key, tokens]) => ({ name: ownerName(key), tokens }));
};

/**
 * Gets the token cost of the context files, skills, and extensions of the session.
 */
export const collectHeader = (pi: ExtensionAPI, ctx: ExtensionContext): Header => {
  const systemPrompt = ctx.getSystemPrompt();
  const context = contextRows(systemPrompt, ctx.cwd);
  const skills = pi
    .getCommands()
    .filter((c) => c.source === "skill")
    .map(readSkill);
  const modelSkills = skills.filter((s) => !s.manual).map((s) => s.row);
  const extensions = extensionRows(pi);
  return {
    sections: [
      { title: "context", upfront: true, rows: context.toSorted(byTokens) },
      { title: "skills · model", upfront: true, rows: modelSkills.toSorted(byTokens) },
      {
        title: "skills · manual",
        upfront: false,
        rows: skills
          .filter((s) => s.manual)
          .map((s) => s.row)
          .toSorted(byTokens),
      },
      { title: "extensions", upfront: true, rows: extensions.toSorted(byTokens) },
    ],
    total: estimate(systemPrompt) + sum(extensions),
    base: estimate(systemPrompt) - sum(context) - sum(modelSkills),
  };
};

const line = (width: number, left: string, right: string) => {
  const room = Math.max(0, width - 1 - visibleWidth(right));
  const cut = truncateToWidth(left, room, "…");
  return ` ${cut}${" ".repeat(room - visibleWidth(cut))}${right}`;
};

const sectionLines = (theme: Theme, width: number, section: Section) => [
  line(
    width,
    theme.fg("accent", section.title) + (section.upfront ? "" : theme.fg("dim", " · on use")),
    theme.fg("text", format(sum(section.rows))),
  ),
  ...section.rows.map((row) => line(width, `  ${row.name}`, theme.fg("muted", format(row.tokens)))),
  ...(section.rows.length === 0 ? [line(width, theme.fg("dim", "  none"), "")] : []),
];

/**
 * Renders the header as terminal lines.
 */
export const renderHeader = (
  header: Header,
  theme: Theme,
  terminalWidth: number,
): Array<string> => {
  const width = Math.min(terminalWidth, MAX_WIDTH);
  return [
    "",
    ...header.sections.flatMap((section) => sectionLines(theme, width, section)),
    ` ${theme.fg("borderMuted", "─".repeat(Math.max(0, width - 1)))}`,
    ` ${theme.fg("text", `~${format(header.total)}`)}${theme.fg("dim", ` tokens at session start · ~${format(header.base)} is pi's own`)}`,
  ].map((text) => truncateToWidth(text, terminalWidth, ""));
};
