#!/usr/bin/env bun
import { join } from "node:path";
import { parseArgs } from "node:util";

import {
  createKpi,
  DEFAULT_TEMPLATE_SUMMARY,
  findRocks,
  formatKpis,
  listKpis,
  loadContext,
  setWeek,
  type KpiContext,
} from "./lib/kpi/actions.ts";
import { apiClient } from "./lib/kpi/client.ts";
import { localDate, parseSelector } from "./lib/kpi/weeks.ts";

const USAGE = `Usage: kpi.ts <command> [options]

Creates, lists, and updates your weekly KPIs in JIRA.

Commands:
  info                         Show the KPI template, its project, and its weeks
  rocks                        List the open quarterly rocks (the parents of KPIs)
  list [--all]                 List your KPIs and their weekly results
  create --rock <KEY> --summary <text> [--dry-run]
                               Copy the template to a new KPI under the rock
  update <KPI-KEY> (--yes | --no) [--week <n|current|previous>] [--comment <text>]
                               Set the result of one week (default: the current week)

Environment:
  JIRA_KPI_TEMPLATE            Key of the KPI template issue
  JIRA_KPI_TEMPLATE_SUMMARY    Text in the template summary (default: "${DEFAULT_TEMPLATE_SUMMARY}")

Output is tab-separated, with one header row.`;

const { values, positionals } = parseArgs({
  args: Bun.argv.slice(2),
  allowPositionals: true,
  options: {
    rock: { type: "string" },
    summary: { type: "string" },
    week: { type: "string", default: "current" },
    comment: { type: "string" },
    yes: { type: "boolean", default: false },
    no: { type: "boolean", default: false },
    all: { type: "boolean", default: false },
    "dry-run": { type: "boolean", default: false },
    help: { type: "boolean", short: "h", default: false },
  },
});

const jira = apiClient(join(import.meta.dir, "api"));
const today = localDate();

function context(): Promise<KpiContext> {
  return loadContext(jira, {
    key: process.env["JIRA_KPI_TEMPLATE"],
    summary: process.env["JIRA_KPI_TEMPLATE_SUMMARY"] || DEFAULT_TEMPLATE_SUMMARY,
  });
}

function table(rows: string[][]): string {
  return rows.map((r) => r.join("\t")).join("\n");
}

async function info(): Promise<string> {
  const ctx = await context();
  const header = `template\t${ctx.template.key}\t${ctx.template.fields.summary}\nproject\t${ctx.project}`;
  const weeks = ctx.weeks.map((w) => [String(w.number), w.due ?? "-", w.summary]);
  return `${header}\n\n${table([["week", "due", "summary"], ...weeks])}`;
}

async function rocks(): Promise<string> {
  const issues = await findRocks(jira, await context());
  const rows = issues.map((i) => [
    i.key,
    i.fields.status?.name ?? "-",
    i.fields.assignee?.displayName ?? "-",
    i.fields.parent?.fields?.summary ?? "-",
    i.fields.summary,
  ]);
  return table([["rock", "status", "owner", "initiative", "summary"], ...rows]);
}

async function create(): Promise<string> {
  const { rock, summary } = values;
  if (!rock || !summary) throw new Error("create needs --rock and --summary");
  const ctx = await context();
  if (values["dry-run"]) {
    const weeks = ctx.weeks.map((w) => `${w.summary} (due ${w.due ?? "-"})`).join(", ");
    return `dry run: create "${summary}" in ${ctx.project} under ${rock}, assigned to you, with ${ctx.weeks.length} weeks: ${weeks}`;
  }
  const created = await createKpi(jira, ctx, { summary, rock });
  return table([
    ["kpi", "status", "weeks"],
    [created.key, created.status ?? "(not moved)", created.weeks.join(",")],
  ]);
}

async function update(kpi: string | undefined): Promise<string> {
  if (!kpi || values.yes === values.no) throw new Error("update needs a KPI key and --yes or --no");
  const result = await setWeek(jira, {
    kpi,
    week: parseSelector(values.week),
    achieved: values.yes,
    comment: values.comment,
    today,
  });
  const { week } = result;
  return table([
    ["week", "key", "due", "result", "changed"],
    [
      String(week.number),
      week.key,
      week.due ?? "-",
      week.achieved ? "Yes" : "No",
      String(result.changed),
    ],
  ]);
}

const commands: Record<string, () => Promise<string>> = {
  info,
  rocks,
  list: async () => formatKpis(await listKpis(jira, await context(), values.all), today),
  create,
  update: () => update(positionals[1]),
};

const run = commands[positionals[0] ?? ""];
if (values.help || !run) {
  console.log(USAGE);
  process.exit(values.help ? 0 : 1);
}
try {
  console.log(await run());
} catch (error) {
  console.error(`error: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
