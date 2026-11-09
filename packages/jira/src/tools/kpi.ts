import { Effect, Schema } from "effect";
import { Tool, Toolkit } from "effect/ai";
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
import { DESTROYS, jiraTool, READS, WRITES } from "./define.ts";

const NullableString = Schema.NullOr(Schema.String);

const Due = Schema.NullOr(Schema.String.annotate({ description: "YYYY-MM-DD" }));

const KpiWeek = Schema.Struct({
  key: Schema.String,
  url: Schema.String,
  number: Schema.Int,
  summary: Schema.String,
  due: Due,
  status: Schema.NullOr(Schema.String.annotate({ description: "For example Open, Yes, or No" })),
  result: Schema.NullOr(Schema.Literals(["Yes", "No"])).annotate({
    description: "Null when the week has no result yet",
  }),
});

const PlannedWeek = Schema.Struct({ number: Schema.Int, summary: Schema.String, due: Due });

const KpiInfo = jiraTool("kpi_info", {
  description:
    "Get the source of new KPIs (the newest KPI of the user), its project, and the weeks that a new KPI made today gets.",
  hints: READS,
  parameters: Tool.EmptyParams,
  success: Schema.Struct({
    source: Schema.Struct({ key: Schema.String, url: Schema.String, summary: Schema.String }),
    project: Schema.String,
    weeks: Schema.Array(PlannedWeek),
  }),
});

const KpiRocks = jiraTool("kpi_rocks", {
  description:
    "List the open issues that can be the parent of a KPI (the KPI epics under the quarterly rocks), with their parents.",
  hints: READS,
  parameters: Tool.EmptyParams,
  success: Schema.Struct({
    rocks: Schema.Array(
      Schema.Struct({
        key: Schema.String,
        url: Schema.String,
        summary: NullableString,
        status: NullableString,
        owner: NullableString,
        initiative: Schema.NullOr(
          Schema.String.annotate({ description: "The summary of the parent" }),
        ),
      }),
    ),
  }),
});

const KpiList = jiraTool("kpi_list", {
  description:
    "List the KPIs of the user and the result of each week. grid has one character for each week: Y (Yes), N (No), ! (a past week without a result), and . (not due yet). missing lists the past weeks without a result.",
  hints: READS,
  parameters: Schema.Struct({
    all: Schema.optionalKey(
      Schema.Boolean.annotate({ description: "Also give KPIs in the Done category" }),
    ),
  }),
  success: Schema.Struct({
    kpis: Schema.Array(
      Schema.Struct({
        key: Schema.String,
        url: Schema.String,
        summary: NullableString,
        status: NullableString,
        rock: Schema.NullOr(Schema.String.annotate({ description: "The key of the parent" })),
        thisWeek: Schema.NullOr(KpiWeek),
        missing: Schema.Array(Schema.Int),
        grid: Schema.String,
        weeks: Schema.Array(KpiWeek),
      }),
    ),
  }),
});

const KpiCreate = jiraTool("kpi_create", {
  description:
    'Create a KPI under a parent: one Sub-task for each week ("Week <n> - <summary>"), all assigned to the user, and the KPI moved to In Progress. Use dryRun first and show the plan, with the due dates, to the user.',
  hints: WRITES,
  parameters: Schema.Struct({
    rock: Schema.String.annotate({ description: "The key of the parent (from kpi_rocks)" }),
    summary: Schema.String.annotate({ description: "The KPI text from the user" }),
    firstDue: Schema.optionalKey(
      Schema.String.annotate({
        description:
          "The due date of week 1 (YYYY-MM-DD). Default: the first Friday of this quarter",
      }),
    ),
    dryRun: Schema.optionalKey(Schema.Boolean.annotate({ description: "Only give the plan" })),
  }),
  success: Schema.Struct({
    dryRun: Schema.Boolean,
    source: Schema.String.annotate({ description: "The KPI that the new KPI copies" }),
    project: Schema.String,
    rock: Schema.String,
    summary: Schema.String,
    key: NullableString,
    url: NullableString,
    status: NullableString,
    weeks: Schema.Array(
      Schema.Struct({
        number: Schema.Int,
        summary: Schema.String,
        due: NullableString,
        key: NullableString,
      }),
    ),
  }),
});

const KpiUpdate = jiraTool("kpi_update", {
  description:
    'Set the result of one week of a KPI ("Yes" or "No") and add notes. It refuses to change a week that already has the other result.',
  hints: DESTROYS,
  parameters: Schema.Struct({
    kpi: Schema.String.annotate({ description: "The KPI key" }),
    result: Schema.Literals(["Yes", "No"]),
    week: Schema.optionalKey(
      Schema.Union([
        Schema.Int.check(Schema.isGreaterThanOrEqualTo(1)),
        Schema.Literals(["current", "previous"]),
      ]).annotate({
        description:
          "A week number, current (the first week due on or after today), or previous (the last week due before today). Default: current",
      }),
    ),
    comment: Schema.optionalKey(Schema.String),
  }),
  success: Schema.Struct({
    kpi: Schema.String,
    week: KpiWeek,
    changed: Schema.Boolean.annotate({
      description: "False when the week already had the result",
    }),
    commented: Schema.Boolean,
  }),
});

/** The tools for weekly KPIs. */
export const KpiTools = Toolkit.make(KpiInfo, KpiRocks, KpiList, KpiCreate, KpiUpdate);

/** The handlers of {@link KpiTools}. */
export const KpiHandlers = KpiTools.toLayer({
  kpi_info: () =>
    Effect.map(Effect.all([loadSource, site, localToday]), ([kpi, url, today]) => ({
      source: { key: kpi.key, url: issueUrl(url, kpi.key), summary: kpi.summary },
      project: kpi.project,
      weeks: planWeeks(kpi, "<KPI>", today),
    })),
  kpi_rocks: () => Effect.map(Effect.flatMap(loadSource, findRocks), (rocks) => ({ rocks })),
  kpi_list: (params) =>
    Effect.map(
      Effect.flatMap(localToday, (today) => listKpis(params.all === true, today)),
      (kpis) => ({ kpis }),
    ),
  kpi_create: (params) =>
    Effect.flatMap(Effect.all([loadSource, localToday]), ([kpi, today]) =>
      createKpi(kpi, params, today),
    ),
  kpi_update: (params) =>
    Effect.flatMap(localToday, (today) =>
      setWeek({ ...params, week: params.week ?? "current", today }),
    ),
});
