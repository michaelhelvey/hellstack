import { Effect } from "effect";
import { Type } from "typebox";
import {
  createKpi,
  findRocks,
  listKpis,
  loadSource,
  localToday,
  planWeeks,
  setWeek,
} from "../jira/kpi/actions.ts";
import { issueUrl, site } from "../jira/search.ts";
import { jiraTool, Nullable } from "./define.ts";

const Outcome = Type.Union([Type.Literal("Yes"), Type.Literal("No")]);

const KpiWeek = Type.Object({
  key: Type.String(),
  url: Type.String(),
  number: Type.Integer(),
  summary: Type.String(),
  due: Nullable(Type.String({ description: "YYYY-MM-DD" })),
  status: Nullable(Type.String({ description: "For example Open, Yes, or No" })),
  result: Type.Union([Type.Literal("Yes"), Type.Literal("No"), Type.Null()], {
    description: "Null when the week has no result yet",
  }),
});

const PlannedWeek = Type.Object({
  number: Type.Integer(),
  summary: Type.String(),
  due: Nullable(Type.String({ description: "YYYY-MM-DD" })),
});

const kpiInfo = jiraTool({
  name: "jira_kpi_info",
  label: "Jira: KPI source",
  description:
    "Get the source of new KPIs (the newest KPI of the user), its project, and the weeks that a new KPI made today gets.",
  readOnly: true,
  parameters: Type.Object({}),
  output: Type.Object({
    source: Type.Object({
      key: Type.String(),
      url: Type.String(),
      summary: Type.String(),
    }),
    project: Type.String(),
    weeks: Type.Array(PlannedWeek),
  }),
  run: () =>
    Effect.map(Effect.all([loadSource, site, localToday]), ([kpi, url, today]) => ({
      source: { key: kpi.key, url: issueUrl(url, kpi.key), summary: kpi.summary },
      project: kpi.project,
      weeks: planWeeks(kpi, "<KPI>", today),
    })),
});

const kpiRocks = jiraTool({
  name: "jira_kpi_rocks",
  label: "Jira: KPI parents",
  description:
    "List the open issues that can be the parent of a KPI (the KPI epics under the quarterly rocks), with their parents.",
  readOnly: true,
  parameters: Type.Object({}),
  output: Type.Object({
    rocks: Type.Array(
      Type.Object({
        key: Type.String(),
        url: Type.String(),
        summary: Nullable(Type.String()),
        status: Nullable(Type.String()),
        owner: Nullable(Type.String()),
        initiative: Nullable(Type.String({ description: "The summary of the parent" })),
      }),
    ),
  }),
  run: () => Effect.map(Effect.flatMap(loadSource, findRocks), (rocks) => ({ rocks })),
});

const kpiList = jiraTool({
  name: "jira_kpi_list",
  label: "Jira: my KPIs",
  description:
    "List the KPIs of the user and the result of each week. grid has one character for each week: Y (Yes), N (No), ! (a past week without a result), and . (not due yet). missing lists the past weeks without a result.",
  readOnly: true,
  parameters: Type.Object({
    all: Type.Optional(Type.Boolean({ description: "Also give KPIs in the Done category" })),
  }),
  output: Type.Object({
    kpis: Type.Array(
      Type.Object({
        key: Type.String(),
        url: Type.String(),
        summary: Nullable(Type.String()),
        status: Nullable(Type.String()),
        rock: Nullable(Type.String({ description: "The key of the parent" })),
        thisWeek: Nullable(KpiWeek),
        missing: Type.Array(Type.Integer()),
        grid: Type.String(),
        weeks: Type.Array(KpiWeek),
      }),
    ),
  }),
  run: (params) =>
    Effect.map(
      Effect.flatMap(localToday, (today) => listKpis(params.all === true, today)),
      (kpis) => ({ kpis }),
    ),
});

const kpiCreate = jiraTool({
  name: "jira_kpi_create",
  label: "Jira: create KPI",
  description:
    'Create a KPI under a parent: one Sub-task for each week ("Week <n> - <summary>"), all assigned to the user, and the KPI moved to In Progress. Use dryRun first and show the plan, with the due dates, to the user.',
  readOnly: false,
  parameters: Type.Object({
    rock: Type.String({ description: "The key of the parent (from jira_kpi_rocks)" }),
    summary: Type.String({ description: "The KPI text from the user" }),
    firstDue: Type.Optional(
      Type.String({
        description:
          "The due date of week 1 (YYYY-MM-DD). Default: the first Friday of this quarter",
      }),
    ),
    dryRun: Type.Optional(Type.Boolean({ description: "Only give the plan" })),
  }),
  output: Type.Object({
    dryRun: Type.Boolean(),
    source: Type.String({ description: "The KPI that the new KPI copies" }),
    project: Type.String(),
    rock: Type.String(),
    summary: Type.String(),
    key: Nullable(Type.String()),
    url: Nullable(Type.String()),
    status: Nullable(Type.String()),
    weeks: Type.Array(
      Type.Object({
        number: Type.Integer(),
        summary: Type.String(),
        due: Nullable(Type.String()),
        key: Nullable(Type.String()),
      }),
    ),
  }),
  run: (params) =>
    Effect.flatMap(Effect.all([loadSource, localToday]), ([kpi, today]) =>
      createKpi(kpi, params, today),
    ),
});

const kpiUpdate = jiraTool({
  name: "jira_kpi_update",
  label: "Jira: set KPI week",
  description:
    'Set the result of one week of a KPI ("Yes" or "No") and add notes. It refuses to change a week that already has the other result.',
  readOnly: false,
  destructive: true,
  parameters: Type.Object({
    kpi: Type.String({ description: "The KPI key" }),
    result: Outcome,
    week: Type.Optional(
      Type.Union(
        [Type.Integer({ minimum: 1 }), Type.Literal("current"), Type.Literal("previous")],
        {
          description:
            "A week number, current (the first week due on or after today), or previous (the last week due before today). Default: current",
        },
      ),
    ),
    comment: Type.Optional(Type.String()),
  }),
  output: Type.Object({
    kpi: Type.String(),
    week: KpiWeek,
    changed: Type.Boolean({ description: "False when the week already had the result" }),
    commented: Type.Boolean(),
  }),
  run: (params) =>
    Effect.flatMap(localToday, (today) =>
      setWeek({ ...params, week: params.week ?? "current", today }),
    ),
});

/** The tools for weekly KPIs. */
export const KPI_TOOLS = [kpiInfo, kpiRocks, kpiList, kpiCreate, kpiUpdate];
