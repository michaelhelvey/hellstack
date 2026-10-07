import { z } from "zod";

import {
  addComment,
  getIssue,
  myAccountId,
  projectIssueTypes,
  search,
  transitionTo,
  type Issue,
  type Jira,
} from "./client.ts";
import { parseWeeks, pickWeek, weekGrid, type Week, type WeekSelector } from "./weeks.ts";

/** The default text that finds the KPI template issue by its summary. */
export const DEFAULT_TEMPLATE_SUMMARY = "Template Individual KPI";

/** Tells the commands how to find the KPI template. */
export interface TemplateOptions {
  /** The key of the template issue. If it is not set, the commands search by summary. */
  key?: string | undefined;
  /** Text in the summary of the template issue. */
  summary: string;
}

/** The KPI template and the values that the commands get from it. */
export interface KpiContext {
  template: Issue;
  project: string;
  /** The weekly sub-tasks of the template. */
  weeks: Week[];
  /** The ID of the Sub-task issue type of the template weeks. */
  subtaskTypeId: string;
}

const TemplateSchema = z.object({
  key: z.string(),
  fields: z.object({
    summary: z.string(),
    project: z.object({ key: z.string() }),
    issuetype: z.object({ id: z.string(), hierarchyLevel: z.number() }),
  }),
});

/** Finds the KPI template issue from its key, or from text in its summary. */
export async function findTemplate(jira: Jira, options: TemplateOptions): Promise<Issue> {
  if (options.key) return getIssue(jira, options.key);
  const phrase = options.summary.replaceAll('"', "");
  const found = await search(jira, `summary ~ "\\"${phrase}\\"" AND statusCategory != Done`, [
    "summary",
    "issuetype",
    "project",
  ]);
  const matches = found.filter(
    (i) =>
      i.fields.summary.toLowerCase().includes(phrase.toLowerCase()) && !i.fields.issuetype?.subtask,
  );
  if (matches.length === 1 && matches[0]) return getIssue(jira, matches[0].key);
  const list = matches.map((i) => `${i.key} (${i.fields.summary})`).join(", ");
  throw new Error(
    matches.length === 0
      ? `no open issue has "${phrase}" in its summary. Set JIRA_KPI_TEMPLATE to the template key.`
      : `more than one KPI template found: ${list}. Set JIRA_KPI_TEMPLATE to one of the keys.`,
  );
}

/** Finds the KPI template, its project, and its weekly sub-tasks. */
export async function loadContext(jira: Jira, options: TemplateOptions): Promise<KpiContext> {
  const template = await findTemplate(jira, options);
  const project = TemplateSchema.parse(template).fields.project.key;
  const subtasks = await search(jira, `parent = ${template.key} ORDER BY key`, [
    "summary",
    "duedate",
    "issuetype",
  ]);
  const weeks = parseWeeks(subtasks);
  const subtaskTypeId = subtasks[0]?.fields.issuetype?.id;
  if (weeks.length === 0 || !subtaskTypeId) {
    throw new Error(`the template ${template.key} has no "Week <n>" sub-tasks`);
  }
  return { template, project, weeks, subtaskTypeId };
}

/**
 * Finds the open issues that can be the parent of a KPI (the quarterly rocks). These are the
 * issues in the template project with the issue type one level above the template type.
 */
export async function findRocks(jira: Jira, context: KpiContext): Promise<Issue[]> {
  const level = TemplateSchema.parse(context.template).fields.issuetype.hierarchyLevel + 1;
  const types = await projectIssueTypes(jira, context.project);
  const parentType = types.find((t) => t.hierarchyLevel === level);
  if (!parentType)
    throw new Error(`project ${context.project} has no issue type at level ${level}`);
  const jql = `project = ${context.project} AND issuetype = "${parentType.name}" AND statusCategory != Done ORDER BY key`;
  return search(jira, jql, ["summary", "status", "assignee", "parent"]);
}

/** A KPI of the user, with its weekly sub-tasks. */
export interface Kpi {
  issue: Issue;
  weeks: Week[];
}

/** Finds the KPIs that are assigned to the user. Without `all`, it skips KPIs in the Done category. */
export async function listKpis(jira: Jira, context: KpiContext, all: boolean): Promise<Kpi[]> {
  const type = TemplateSchema.parse(context.template).fields.issuetype.id;
  const open = all ? "" : " AND statusCategory != Done";
  const jql = `project = ${context.project} AND issuetype = ${type} AND assignee = currentUser() AND key != ${context.template.key}${open} ORDER BY key`;
  const issues = await search(jira, jql, ["summary", "status", "parent"]);
  if (issues.length === 0) return [];
  const keys = issues.map((i) => i.key).join(",");
  const subtasks = await search(jira, `parent in (${keys})`, [
    "summary",
    "status",
    "duedate",
    "parent",
  ]);
  return issues.map((issue) => ({
    issue,
    weeks: parseWeeks(subtasks.filter((s) => s.fields.parent?.key === issue.key)),
  }));
}

/** Formats KPIs as tab-separated rows, with one header row. */
export function formatKpis(kpis: Kpi[], today: string): string {
  const header = ["kpi", "status", "rock", "this_week", "weeks", "summary"];
  const rows = kpis.map(({ issue, weeks }) => {
    const current = weeks.find((w) => w.due !== null && w.due >= today);
    const thisWeek = current ? `${current.number}:${current.achieved ? "Yes" : "No"}` : "-";
    return [
      issue.key,
      issue.fields.status?.name ?? "-",
      issue.fields.parent?.key ?? "-",
      thisWeek,
      weekGrid(weeks, today),
      issue.fields.summary,
    ];
  });
  return [header, ...rows].map((r) => r.join("\t")).join("\n");
}

/** The result of {@link createKpi}. */
export interface CreatedKpi {
  key: string;
  weeks: string[];
  /** The name of the status of the KPI after the create. */
  status: string | null;
}

const CreatedSchema = z.object({ key: z.string() });
const BulkSchema = z.object({
  issues: z.array(CreatedSchema),
  errors: z.array(z.unknown()).default([]),
});

/**
 * Creates a KPI from the template, as the "Clone" flow does: a copy of the template with the given
 * summary, under the given rock, assigned to the user, with a copy of each weekly sub-task. Then it
 * moves the KPI to In Progress. The copy does not get a "clones" link to the template.
 */
export async function createKpi(
  jira: Jira,
  context: KpiContext,
  input: { summary: string; rock: string },
): Promise<CreatedKpi> {
  const { template } = context;
  const assignee = { accountId: await myAccountId(jira) };
  const fields = {
    project: { key: context.project },
    issuetype: { id: TemplateSchema.parse(template).fields.issuetype.id },
    summary: input.summary,
    parent: { key: input.rock },
    assignee,
    ...(template.fields.description ? { description: template.fields.description } : {}),
  };
  const { key } = CreatedSchema.parse(await jira.send("POST", "/rest/api/3/issue", { fields }));
  const issueUpdates = context.weeks.map((w) => ({
    fields: {
      project: { key: context.project },
      issuetype: { id: context.subtaskTypeId },
      parent: { key },
      summary: w.summary,
      assignee,
      ...(w.due ? { duedate: w.due } : {}),
    },
  }));
  const bulk = BulkSchema.parse(
    await jira.send("POST", "/rest/api/3/issue/bulk", { issueUpdates }),
  );
  if (bulk.errors.length > 0) {
    throw new Error(
      `created ${key}, but some weekly sub-tasks failed: ${JSON.stringify(bulk.errors)}`,
    );
  }
  const status = await transitionTo(jira, key, "indeterminate");
  return { key, weeks: bulk.issues.map((i) => i.key), status };
}

/** The input of {@link setWeek}. */
export interface WeekUpdate {
  kpi: string;
  week: WeekSelector;
  achieved: boolean;
  comment?: string | undefined;
  today: string;
}

/** The result of {@link setWeek}. */
export interface WeekResult {
  week: Week;
  /** True when the command changed the status. False when the week already had that status. */
  changed: boolean;
}

/**
 * Sets the result of one week of a KPI: "Yes" when the KPI target was achieved, else "No". It can
 * also add a comment to the week. The workflow has no transition from "Yes" back to "No".
 */
export async function setWeek(jira: Jira, update: WeekUpdate): Promise<WeekResult> {
  const subtasks = await search(jira, `parent = ${update.kpi}`, ["summary", "status", "duedate"]);
  const week = pickWeek(parseWeeks(subtasks), update.week, update.today);
  let changed = false;
  if (update.achieved && !week.achieved) {
    if (!(await transitionTo(jira, week.key, "done"))) {
      throw new Error(`${week.key} has no transition to a Done status`);
    }
    changed = true;
  } else if (!update.achieved && week.achieved) {
    throw new Error(
      `${week.key} (${week.summary}) is already Yes. The workflow cannot move it back to No. Ask a project manager.`,
    );
  }
  if (update.comment) await addComment(jira, week.key, update.comment);
  return { week: { ...week, achieved: update.achieved }, changed };
}
