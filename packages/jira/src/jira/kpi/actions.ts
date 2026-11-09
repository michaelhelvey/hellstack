import { Config, DateTime, Effect, Option, Schema } from "effect";
import { AtlassianError, call, get } from "../../atlassian.ts";
import {
  addComment,
  myself,
  projectIssueTypes,
  transitions,
  transitionToCategory,
} from "../issues.ts";
import { Issue, IssueType } from "../schemas.ts";
import { issueUrl, keyOf, nameOf, orNull, search, site } from "../search.ts";
import {
  describeSelector,
  parseWeeks,
  pickWeek,
  quarterFirstFriday,
  weekGrid,
  weeklyDueDates,
  type Outcome,
  type Week,
  type WeekSelector,
} from "./weeks.ts";

const fail = (message: string) => Effect.fail(new AtlassianError({ message }));

/** The default text that finds the KPI template issue by its summary. */
export const DEFAULT_TEMPLATE_SUMMARY = "Template Individual KPI";

/** Tells the KPI functions how to find the KPI template. */
export interface TemplateOptions {
  /** The key of the template issue. If it is not set, the functions search by summary. */
  readonly key?: string | undefined;
  /** Text in the summary of the template issue. */
  readonly summary: string;
}

/**
 * Reads the template options from `JIRA_KPI_TEMPLATE` (an issue key) and
 * `JIRA_KPI_TEMPLATE_SUMMARY` (default: {@link DEFAULT_TEMPLATE_SUMMARY}).
 */
export const templateOptions = Effect.gen(function* () {
  const key = yield* Config.option(Config.String("JIRA_KPI_TEMPLATE"));
  const summary = yield* Config.String("JIRA_KPI_TEMPLATE_SUMMARY").pipe(
    Config.withDefault(DEFAULT_TEMPLATE_SUMMARY),
  );
  const options: TemplateOptions = { key: Option.getOrUndefined(key), summary };
  return options;
}).pipe(Effect.catchTag("ConfigError", (error) => fail(`bad KPI config: ${error.message}`)));

const Template = Schema.Struct({
  key: Schema.String,
  fields: Schema.Struct({
    summary: Schema.String,
    project: Schema.Struct({ key: Schema.String }),
    issuetype: IssueType,
    description: Schema.optional(Schema.Unknown),
  }),
});

const getTemplate = (key: string) => get(Template, `/rest/api/3/issue/${key}`);

const templateList = (matches: ReadonlyArray<Issue>) =>
  matches.map((issue) => `${issue.key} (${issue.fields.summary})`).join(", ");

const isTemplate = (phrase: string) => (issue: Issue) =>
  (issue.fields.summary ?? "").toLowerCase().includes(phrase.toLowerCase()) &&
  issue.fields.issuetype?.subtask !== true;

const onlyMatch = (phrase: string, matches: ReadonlyArray<Issue>) => {
  const [only, ...others] = matches;
  if (only === undefined) {
    return fail(
      `no open issue has "${phrase}" in its summary. Set JIRA_KPI_TEMPLATE to the template key.`,
    );
  }
  return others.length === 0
    ? Effect.succeed(only.key)
    : fail(
        `more than one KPI template found: ${templateList(matches)}. Set JIRA_KPI_TEMPLATE to one of the keys.`,
      );
};

/** Finds the KPI template issue from its key, or from text in its summary. */
export const findTemplate = Effect.fnUntraced(function* (options: TemplateOptions) {
  if (options.key !== undefined) return yield* getTemplate(options.key);
  const phrase = options.summary.replaceAll('"', "");
  const found = yield* search(`summary ~ "\\"${phrase}\\"" AND statusCategory != Done`, [
    "summary",
    "issuetype",
    "project",
  ]);
  return yield* getTemplate(yield* onlyMatch(phrase, found.filter(isTemplate(phrase))));
});

const KPI_FIELDS = ["summary", "status", "parent", "issuetype", "project", "created"];

/**
 * Finds the KPIs of the user, newest first, without a template: the parents of the "Week 1"
 * sub-tasks that are assigned to the user. Without `all`, it skips KPIs in the Done category.
 */
export const findMyKpis = Effect.fnUntraced(function* (all: boolean) {
  const firstWeeks = yield* search(
    'assignee = currentUser() AND issuetype in subTaskIssueTypes() AND summary ~ "\\"Week 1\\""',
    ["parent"],
  );
  const keys = [...new Set(firstWeeks.flatMap((week) => keyOf(week.fields.parent) ?? []))];
  if (keys.length === 0) return [];
  const open = all ? "" : " AND statusCategory != Done";
  return yield* search(`key in (${keys.join(",")})${open} ORDER BY created DESC`, KPI_FIELDS);
});

/**
 * What a new KPI is made from: the KPI template, or else the newest KPI of the user. The project,
 * the issue types, and the number of weeks come from it.
 */
export interface KpiSource {
  /** `template`: the KPI template. `kpi`: the newest KPI of the user, because no template was found. */
  readonly kind: "template" | "kpi";
  readonly key: string;
  readonly summary: string;
  readonly project: string;
  /** The issue type of KPIs. */
  readonly type: IssueType;
  /** The ID of the Sub-task issue type of the weeks. */
  readonly subtaskTypeId: string;
  /** The description to copy. Only a template has one to copy. */
  readonly description: unknown;
  /** The weekly sub-tasks of the source. */
  readonly weeks: ReadonlyArray<Week>;
  /** Why the template was not used, or null. */
  readonly note: string | null;
}

const subtaskTypeOf = (subtasks: ReadonlyArray<Issue>) => subtasks[0]?.fields.issuetype?.id;

const sourceWeeks = Effect.fnUntraced(function* (key: string) {
  const subtasks = yield* search(`parent = ${key} ORDER BY key`, [
    "summary",
    "status",
    "duedate",
    "issuetype",
  ]);
  const weeks = parseWeeks(subtasks);
  const subtaskTypeId = subtaskTypeOf(subtasks);
  if (weeks.length === 0 || subtaskTypeId === undefined) {
    return yield* fail(`${key} has no "Week <n>" sub-tasks`);
  }
  return { weeks, subtaskTypeId };
});

const fromTemplate = Effect.fnUntraced(function* (options: TemplateOptions) {
  const template = yield* findTemplate(options);
  const { weeks, subtaskTypeId } = yield* sourceWeeks(template.key);
  const source: KpiSource = {
    kind: "template",
    key: template.key,
    summary: template.fields.summary,
    project: template.fields.project.key,
    type: template.fields.issuetype,
    subtaskTypeId,
    description: template.fields.description,
    weeks,
    note: null,
  };
  return source;
});

const NewestKpi = Schema.Struct({
  key: Schema.String,
  fields: Schema.Struct({
    summary: Schema.String,
    project: Schema.Struct({ key: Schema.String }),
    issuetype: IssueType,
  }),
});

const newestKpi = (note: string) =>
  Effect.flatMap(findMyKpis(true), ([newest]) =>
    Schema.decodeUnknownEffect(NewestKpi)(newest).pipe(
      Effect.mapError(
        () =>
          new AtlassianError({
            message: `${note}. You also have no KPI to copy the project and the weeks from.`,
          }),
      ),
    ),
  );

const fromNewestKpi = Effect.fnUntraced(function* (note: string) {
  const newest = yield* newestKpi(note);
  const { weeks, subtaskTypeId } = yield* sourceWeeks(newest.key);
  const source: KpiSource = {
    kind: "kpi",
    key: newest.key,
    summary: newest.fields.summary,
    project: newest.fields.project.key,
    type: newest.fields.issuetype,
    subtaskTypeId,
    description: undefined,
    weeks,
    note: `${note}. The project and the weeks come from your newest KPI, ${newest.key}.`,
  };
  return source;
});

/**
 * Finds the source of new KPIs: the KPI template if there is one, or else the newest KPI of the
 * user.
 */
export const loadSource = (options: TemplateOptions) =>
  fromTemplate(options).pipe(
    Effect.catchTag("AtlassianError", (error) =>
      fromNewestKpi(`The KPI template was not found (${error.message})`),
    ),
  );

/** A quarterly rock: an issue that can be the parent of a KPI. */
export interface Rock {
  readonly key: string;
  readonly url: string;
  readonly summary: string | null;
  readonly status: string | null;
  readonly owner: string | null;
  /** The summary of the parent of the rock (the initiative). */
  readonly initiative: string | null;
}

/**
 * Finds the open issues that can be the parent of a KPI. These are the issues in the KPI project
 * with the issue type one level above the KPI type.
 */
export const findRocks = Effect.fnUntraced(function* (source: KpiSource) {
  const level = source.type.hierarchyLevel + 1;
  const parentType = (yield* projectIssueTypes(source.project)).find(
    (type) => type.hierarchyLevel === level,
  );
  if (parentType === undefined) {
    return yield* fail(`project ${source.project} has no issue type at level ${level}`);
  }
  const issues = yield* search(
    `project = ${source.project} AND issuetype = "${parentType.name}" AND statusCategory != Done ORDER BY key`,
    ["summary", "status", "assignee", "parent"],
  );
  const url = yield* site;
  return issues.map((issue): Rock => ({
    key: issue.key,
    url: issueUrl(url, issue.key),
    summary: orNull(issue.fields.summary),
    status: nameOf(issue.fields.status),
    owner: orNull(issue.fields.assignee?.displayName),
    initiative: orNull(issue.fields.parent?.fields?.summary),
  }));
});

/** A week of a KPI, with its URL. */
export interface KpiWeek extends Week {
  readonly url: string;
}

/** A KPI of the user, with the result of each week. */
export interface Kpi {
  readonly key: string;
  readonly url: string;
  readonly summary: string | null;
  readonly status: string | null;
  /** The key of the parent of the KPI. */
  readonly rock: string | null;
  /** The week that is due next, or null after the last week. */
  readonly thisWeek: KpiWeek | null;
  /** Past weeks without a result. */
  readonly missing: ReadonlyArray<number>;
  /** One character for each week: `Y` (Yes), `N` (No), `!` (past, no result), `.` (not due). */
  readonly grid: string;
  readonly weeks: ReadonlyArray<KpiWeek>;
}

/** Gives today's date in the local time zone as `YYYY-MM-DD`. */
export const localToday = Effect.map(DateTime.now, (now) =>
  DateTime.formatIsoDate(DateTime.setZone(now, DateTime.zoneMakeLocal())),
);

const withUrl = (url: string, week: Week): KpiWeek =>
  Object.assign({ url: issueUrl(url, week.key) }, week);

const toKpi = (url: string, today: string, issue: Issue, subtasks: ReadonlyArray<Issue>): Kpi => {
  const weeks = parseWeeks(subtasks).map((week) => withUrl(url, week));
  return {
    key: issue.key,
    url: issueUrl(url, issue.key),
    summary: orNull(issue.fields.summary),
    status: nameOf(issue.fields.status),
    rock: keyOf(issue.fields.parent),
    thisWeek: orNull(pickWeek(weeks, "current", today)),
    missing: weeks
      .filter((week) => week.result === null && week.due !== null && week.due < today)
      .map((week) => week.number),
    grid: weekGrid(weeks, today),
    weeks,
  };
};

/** Lists the KPIs of the user with their weeks. Without `all`, it skips KPIs in the Done category. */
export const listKpis = Effect.fnUntraced(function* (all: boolean, today: string) {
  const issues = yield* findMyKpis(all);
  if (issues.length === 0) return [];
  const keys = issues.map((issue) => issue.key).join(",");
  const subtasks = yield* search(`parent in (${keys})`, ["summary", "status", "duedate", "parent"]);
  const url = yield* site;
  return issues.map((issue) =>
    toKpi(
      url,
      today,
      issue,
      subtasks.filter((task) => keyOf(task.fields.parent) === issue.key),
    ),
  );
});

/** A week that {@link createKpi} makes. */
export interface PlannedWeek {
  readonly number: number;
  readonly summary: string;
  readonly due: string | null;
}

/**
 * Plans the weeks of a new KPI. The summaries are `Week <n> - <KPI summary>`. The due dates are
 * weekly from `firstDue`, or else the due dates of the template, or else weekly from the first
 * Friday of the quarter of `today`.
 */
export const planWeeks = (
  source: KpiSource,
  summary: string,
  today: string,
  firstDue?: string,
): ReadonlyArray<PlannedWeek> => {
  const count = source.weeks.length;
  const dues =
    firstDue === undefined && source.kind === "template"
      ? source.weeks.map((week) => week.due)
      : weeklyDueDates(firstDue ?? quarterFirstFriday(today), count);
  return source.weeks.map((week, index) => ({
    number: week.number,
    summary: `Week ${week.number} - ${summary}`,
    due: dues[index] ?? null,
  }));
};

/** The plan or the result of {@link createKpi}. */
export interface CreatedKpi {
  readonly dryRun: boolean;
  /** The template or the KPI that the new KPI copies. */
  readonly source: string;
  readonly project: string;
  readonly rock: string;
  readonly summary: string;
  /** The key of the new KPI, or null in a dry run. */
  readonly key: string | null;
  readonly url: string | null;
  /** The status of the KPI after the create, or null if it did not move. */
  readonly status: string | null;
  readonly weeks: ReadonlyArray<PlannedWeek & { readonly key: string | null }>;
}

const Created = Schema.Struct({ key: Schema.String });
const Bulk = Schema.Struct({
  issues: Schema.Array(Created),
  errors: Schema.Array(Schema.Unknown).pipe(Schema.withDecodingDefault(Effect.succeed([]))),
});

/** The input of {@link createKpi}. */
export interface NewKpi {
  readonly summary: string;
  readonly rock: string;
  /** The due date of week 1 as `YYYY-MM-DD`. The other weeks are one week apart. */
  readonly firstDue?: string | undefined;
  /** Only give the plan. Do not create issues. */
  readonly dryRun?: boolean | undefined;
}

const plan = (source: KpiSource, input: NewKpi, weeks: ReadonlyArray<PlannedWeek>): CreatedKpi => ({
  dryRun: true,
  source: source.key,
  project: source.project,
  rock: input.rock,
  summary: input.summary,
  key: null,
  url: null,
  status: null,
  weeks: weeks.map((week) => Object.assign({ key: null }, week)),
});

const weekFields =
  (source: KpiSource, parent: string, assignee: unknown) => (week: PlannedWeek) => ({
    fields: {
      project: { key: source.project },
      issuetype: { id: source.subtaskTypeId },
      parent: { key: parent },
      summary: week.summary,
      assignee,
      ...(week.due === null ? {} : { duedate: week.due }),
    },
  });

/**
 * Creates a KPI: an issue with the KPI type and the given summary, under the given rock, assigned
 * to the user, with one Sub-task for each week (see {@link planWeeks}). Then it moves the KPI to
 * In Progress. It copies the description of a template, but not a "clones" link.
 */
export const createKpi = Effect.fnUntraced(function* (
  source: KpiSource,
  input: NewKpi,
  today: string,
) {
  const weeks = planWeeks(source, input.summary, today, input.firstDue);
  if (input.dryRun === true) return plan(source, input, weeks);
  const assignee = { accountId: (yield* myself).accountId };
  const description = source.description ? { description: source.description } : {};
  const { key } = yield* call(Created, {
    method: "POST",
    path: "/rest/api/3/issue",
    body: {
      fields: {
        project: { key: source.project },
        issuetype: { id: source.type.id },
        summary: input.summary,
        parent: { key: input.rock },
        assignee,
        ...description,
      },
    },
  });
  const bulk = yield* call(Bulk, {
    method: "POST",
    path: "/rest/api/3/issue/bulk",
    body: { issueUpdates: weeks.map(weekFields(source, key, assignee)) },
  });
  if (bulk.errors.length > 0) {
    return yield* fail(
      `created ${key}, but some weekly sub-tasks failed: ${JSON.stringify(bulk.errors)}`,
    );
  }
  const status = yield* transitionToCategory(key, "indeterminate");
  const result: CreatedKpi = {
    ...plan(source, input, weeks),
    dryRun: false,
    key,
    url: issueUrl(yield* site, key),
    status,
    weeks: weeks.map((week, index) =>
      Object.assign({ key: bulk.issues[index]?.key ?? null }, week),
    ),
  };
  return result;
});

/** The input of {@link setWeek}. */
export interface WeekUpdate {
  readonly kpi: string;
  readonly week: WeekSelector;
  /** "Yes" when the KPI target was achieved, else "No". */
  readonly result: Outcome;
  readonly comment?: string | undefined;
  /** Today's date as `YYYY-MM-DD`. It selects the current and the previous week. */
  readonly today: string;
}

/** The result of {@link setWeek}. */
export interface WeekChange {
  readonly kpi: string;
  readonly week: KpiWeek;
  /** True when the status changed. False when the week already had that result. */
  readonly changed: boolean;
  readonly commented: boolean;
}

const moveTo = Effect.fnUntraced(function* (week: Week, result: Outcome) {
  const available = yield* transitions(week.key);
  const transition = available.find((t) => t.to.name.toLowerCase() === result.toLowerCase());
  if (transition === undefined) {
    const names = available.map((t) => t.to.name).join(", ");
    return yield* fail(`${week.key} has no transition to "${result}". Available: ${names}`);
  }
  yield* call(Schema.Unknown, {
    method: "POST",
    path: `/rest/api/3/issue/${week.key}/transitions`,
    body: { transition: { id: transition.id } },
  });
  return transition.to.name;
});

/** Moves the week to the result. Gives the new status name, or null when nothing changed. */
const changeResult = (week: Week, result: Outcome) => {
  if (week.result === result) return Effect.succeed(null);
  return week.result === null
    ? moveTo(week, result)
    : fail(
        `${week.key} (${week.summary}) is already ${week.result}. To change it, move it back to Open with jira_transition first.`,
      );
};

/**
 * Sets the result of one week of a KPI: "Yes" when the KPI target was achieved, else "No". It can
 * also add a comment to the week. It does not change a week that already has the other result.
 */
export const setWeek = Effect.fnUntraced(function* (update: WeekUpdate) {
  const subtasks = yield* search(`parent = ${update.kpi}`, ["summary", "status", "duedate"]);
  const weeks = parseWeeks(subtasks);
  const week = pickWeek(weeks, update.week, update.today);
  if (week === undefined) {
    return yield* fail(
      `no ${describeSelector(update.week)} in the ${weeks.length} weekly sub-tasks of ${update.kpi}`,
    );
  }
  const status = yield* changeResult(week, update.result);
  if (update.comment !== undefined) yield* addComment(week.key, update.comment);
  const result: WeekChange = {
    kpi: update.kpi,
    week: Object.assign(withUrl(yield* site, week), {
      result: update.result,
      status: status ?? week.status,
    }),
    changed: status !== null,
    commented: update.comment !== undefined,
  };
  return result;
});
