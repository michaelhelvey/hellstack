/** Tracks a long-running objective in the active Pi session. */

import { randomUUID } from "node:crypto";

import { StringEnum } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

const STATE_TYPE = "goal";

const UI_MESSAGE_TYPE = "goal-ui";

const CONTINUATION_TYPE = "goal-continuation";

const MAX_OBJECTIVE_CHARS = 4_000;

type GoalStatus = "active" | "paused" | "blocked" | "usageLimited" | "budgetLimited" | "complete";

type GoalAction = "set" | "edit" | "status" | "clear" | "account";

type Goal = {
  id: string;
  objective: string;
  status: GoalStatus;
  tokenBudget?: number;
  tokensUsed: number;
  timeUsedSeconds: number;
  createdAt: number;
  updatedAt: number;
};

type StateEntry = { version: 2; action: GoalAction; goal: Goal | null };

type MessageLike = { role?: string; stopReason?: string; errorMessage?: string; usage?: Usage };

type Usage = { input?: number; output?: number; cacheRead?: number; totalTokens?: number };

type GoalResult = {
  goal: {
    threadId: string;
    objective: string;
    status: GoalStatus;
    tokenBudget: number | null;
    tokensUsed: number;
    timeUsedSeconds: number;
    createdAt: number;
    updatedAt: number;
  } | null;
  remainingTokens: number | null;
  completionBudgetReport: string | null;
};

const CreateParams = Type.Object({
  objective: Type.String({ description: "The concrete objective to pursue." }),
  token_budget: Type.Optional(
    Type.Number({ description: "Optional positive integer token budget." }),
  ),
});

const UpdateParams = Type.Object({ status: StringEnum(["complete", "blocked"] as const) });

const STATUS_LABELS: Record<GoalStatus, string> = {
  active: "active",
  paused: "paused",
  blocked: "blocked",
  usageLimited: "usage limited",
  budgetLimited: "limited by budget",
  complete: "complete",
};

function now(): number {
  return Math.floor(Date.now() / 1000);
}

function positiveInteger(value: unknown): number | undefined {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : undefined;
}

function safeInteger(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.max(0, Math.floor(value))
    : fallback;
}

function asText(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function validateObjective(value: string): string {
  const result = value.trim();

  if (!result) throw new Error("goal objective must not be empty");

  if ([...result].length > MAX_OBJECTIVE_CHARS) throw new Error("goal objective is too long");

  return result;
}

function normalizeStatus(value: unknown): GoalStatus {
  const map: Record<string, GoalStatus> = {
    active: "active",
    paused: "paused",
    blocked: "blocked",
    complete: "complete",
    usageLimited: "usageLimited",
    usage_limited: "usageLimited",
    budgetLimited: "budgetLimited",
    budget_limited: "budgetLimited",
  };

  return typeof value === "string" ? (map[value] ?? "active") : "active";
}

function createRestoredGoal(raw: Record<string, unknown>, objective: string): Goal {
  const result: Goal = {
    id: asText(raw.id) || randomUUID(),
    objective,
    status: normalizeStatus(raw.status),
    tokensUsed: safeInteger(raw.tokensUsed),
    timeUsedSeconds: safeInteger(raw.timeUsedSeconds),
    createdAt: safeInteger(raw.createdAt, now()),
    updatedAt: safeInteger(raw.updatedAt, now()),
  };

  const tokenBudget = positiveInteger(raw.tokenBudget);

  if (tokenBudget !== undefined) result.tokenBudget = tokenBudget;

  return result;
}

function restoreGoal(value: unknown): Goal | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  const objective = asText(raw.objective).trim();

  return objective ? createRestoredGoal(raw, objective) : null;
}

function compactTokens(value: number): string {
  return value >= 1_000_000
    ? `${(value / 1_000_000).toFixed(1)}M`
    : value >= 1_000
      ? `${(value / 1_000).toFixed(1)}K`
      : String(value);
}

function elapsed(value: number): string {
  const minutes = Math.floor(value / 60);

  return minutes > 0 ? `${minutes}m ${value % 60}s` : `${value}s`;
}

function usageValue(value: number | undefined): number {
  return Math.max(0, value ?? 0);
}

function usageTokens(message: MessageLike): number {
  if (message.role !== "assistant" || !message.usage) return 0;
  const input = usageValue(message.usage.input) - usageValue(message.usage.cacheRead);
  const output = usageValue(message.usage.output);

  return input + output || usageValue(message.usage.totalTokens);
}

function totalUsage(messages: unknown[]): number {
  return messages.reduce<number>(
    (total, message) =>
      message && typeof message === "object" ? total + usageTokens(message) : total,
    0,
  );
}

function lastAssistant(messages: unknown[]): MessageLike | undefined {
  return [...messages]
    .reverse()
    .find(
      (message): message is MessageLike =>
        !!message && typeof message === "object" && (message as MessageLike).role === "assistant",
    );
}

function summary(goal: Goal): string {
  const limit =
    goal.tokenBudget === undefined ? "" : `\nToken budget: ${compactTokens(goal.tokenBudget)}`;

  const command = goal.status === "active" ? "pause" : "resume";

  return [
    "Goal",
    `Status: ${STATUS_LABELS[goal.status]}`,
    `Objective: ${goal.objective}`,
    `Time used: ${elapsed(goal.timeUsedSeconds)}`,
    `Tokens used: ${compactTokens(goal.tokensUsed)}${limit}`,
    "",
    `Commands: /goal edit, /goal ${command}, /goal clear`,
  ].join("\n");
}

function continuation(goal: Goal): string {
  const remaining =
    goal.tokenBudget === undefined
      ? "unbounded"
      : String(Math.max(0, goal.tokenBudget - goal.tokensUsed));

  return [
    "Continue work toward the active goal.",
    `<untrusted_objective>\n${goal.objective}\n</untrusted_objective>`,
    `Time used: ${goal.timeUsedSeconds}s. Tokens used: ${goal.tokensUsed}. Tokens remaining: ${remaining}.`,
    "Inspect current state. Make concrete progress. Verify every requirement before marking the goal complete.",
    "Mark the goal blocked only after the same blocker repeats for three goal turns and no useful progress is possible.",
  ].join("\n\n");
}

function wireGoal(goal: Goal | null, sessionId: string): GoalResult["goal"] {
  if (!goal) return null;

  return {
    threadId: sessionId,
    objective: goal.objective,
    status: goal.status,
    tokenBudget: goal.tokenBudget ?? null,
    tokensUsed: goal.tokensUsed,
    timeUsedSeconds: goal.timeUsedSeconds,
    createdAt: goal.createdAt,
    updatedAt: goal.updatedAt,
  };
}

function result(goal: Goal | null, sessionId: string, report: boolean): GoalResult {
  const remainingTokens =
    goal?.tokenBudget === undefined ? null : Math.max(0, goal.tokenBudget - goal.tokensUsed);

  const completionBudgetReport =
    report && goal?.status === "complete"
      ? `Goal achieved. Tokens used: ${goal.tokensUsed}.`
      : null;

  return { goal: wireGoal(goal, sessionId), remainingTokens, completionBudgetReport };
}

function resultText(value: unknown): { type: "text"; text: string }[] {
  return [{ type: "text", text: JSON.stringify(value, null, 2) }];
}

class GoalExtension {
  private readonly pi: ExtensionAPI;
  private goal: Goal | null = null;
  private activeSince: number | null = null;
  private startedGoal: string | null = null;
  private continuationQueued = false;

  constructor(pi: ExtensionAPI) {
    this.pi = pi;
  }

  private snapshot(): Goal | null {
    if (!this.goal) return null;
    const copy = { ...this.goal };

    if (copy.status === "active" && this.activeSince !== null)
      copy.timeUsedSeconds += Math.floor((Date.now() - this.activeSince) / 1000);

    return copy;
  }

  private persist(action: GoalAction): void {
    this.pi.appendEntry(STATE_TYPE, {
      version: 2,
      action,
      goal: this.goal ? { ...this.goal } : null,
    } satisfies StateEntry);
  }
  private show(content: string): void {
    this.pi.sendMessage(
      { customType: UI_MESSAGE_TYPE, content, display: true },
      { triggerTurn: false },
    );
  }

  private statusText(ctx: ExtensionContext): string | undefined {
    if (!this.goal) return undefined;
    const color = this.goal.status === "active" ? "accent" : "warning";

    return ctx.ui.theme.fg(color, `Goal ${STATUS_LABELS[this.goal.status]}`);
  }

  private setStatus(ctx: ExtensionContext): void {
    if (!ctx.hasUI) return;
    ctx.ui.setStatus("goal", this.statusText(ctx));
  }

  private hasActiveClock(): boolean {
    return this.goal !== null && this.goal.status === "active" && this.activeSince !== null;
  }

  private accountTime(): boolean {
    if (!this.hasActiveClock()) return false;
    const seconds = Math.floor((Date.now() - this.activeSince!) / 1000);

    return seconds > 0 && this.addTime(seconds);
  }

  private addTime(seconds: number): boolean {
    if (!this.goal || this.activeSince === null) return false;
    this.goal.timeUsedSeconds += seconds;
    this.goal.updatedAt = now();
    this.activeSince += seconds * 1000;

    return true;
  }

  private setGoal(value: string, tokenBudgetInput?: number): Goal {
    const timestamp = now();

    const created: Goal = {
      id: randomUUID(),
      objective: validateObjective(value),
      status: "active",
      tokensUsed: 0,
      timeUsedSeconds: 0,
      createdAt: timestamp,
      updatedAt: timestamp,
    };

    const tokenBudget = positiveInteger(tokenBudgetInput);

    if (tokenBudgetInput !== undefined && tokenBudget === undefined)
      throw new Error("goal budgets must be positive integers");

    if (tokenBudget !== undefined) created.tokenBudget = tokenBudget;
    this.goal = created;
    this.activeSince = Date.now();
    this.continuationQueued = false;

    return created;
  }

  private changeStatus(next: GoalStatus): Goal {
    if (!this.goal) throw new Error("cannot update goal because no goal exists");
    const previous = this.goal.status;
    this.updateActivity(previous, next);
    this.goal.status = next;
    this.goal.updatedAt = now();

    return this.goal;
  }

  private updateActivity(previous: GoalStatus, next: GoalStatus): void {
    this.stopActivity(previous, next);
    this.startActivity(previous, next);

    if (next !== "active") this.continuationQueued = false;
  }

  private stopActivity(previous: GoalStatus, next: GoalStatus): void {
    if (previous === "active" && next !== "active") {
      this.accountTime();
      this.activeSince = null;
    }
  }

  private startActivity(previous: GoalStatus, next: GoalStatus): void {
    if (previous !== "active" && next === "active") {
      this.activeSince = Date.now();
      this.continuationQueued = false;
    }
  }

  private queue(ctx: ExtensionContext): void {
    const goal = this.snapshot();

    if (!this.canQueue(goal, ctx)) return;
    this.continuationQueued = true;

    try {
      this.sendQueue(ctx, goal);
    } catch {
      this.continuationQueued = false;
    }
  }

  private canQueue(goal: Goal | null, ctx: ExtensionContext): goal is Goal {
    return (
      goal !== null &&
      goal.status === "active" &&
      !this.continuationQueued &&
      !ctx.hasPendingMessages()
    );
  }

  private sendQueue(ctx: ExtensionContext, goal: Goal): void {
    const message = {
      customType: CONTINUATION_TYPE,
      content: continuation(goal),
      display: false,
      details: { goalId: goal.id },
    };

    const options = ctx.isIdle()
      ? { triggerTurn: true }
      : { triggerTurn: true, deliverAs: "followUp" as const };

    this.pi.sendMessage(message, options);
  }

  private restore(ctx: ExtensionContext): void {
    this.goal = this.restoreBranch(ctx);
    this.activeSince = this.goal?.status === "active" ? Date.now() : null;
    this.continuationQueued = false;
    this.setStatus(ctx);
  }

  private restoreBranch(ctx: ExtensionContext): Goal | null {
    let restored: Goal | null = null;

    for (const entry of ctx.sessionManager.getBranch()) {
      if (this.isStateEntry(entry))
        restored = restoreGoal(
          ((entry as { data?: unknown }).data as Partial<StateEntry> | undefined)?.goal,
        );
    }

    return restored;
  }

  private isStateEntry(entry: { type: string; customType?: string }): boolean {
    return entry.type === "custom" && entry.customType === STATE_TYPE;
  }

  private edit(value: string): Goal {
    if (!this.goal) throw new Error("cannot edit goal because no goal exists");
    this.accountTime();
    this.goal.objective = validateObjective(value);

    if (this.goal.status === "complete" || this.goal.status === "budgetLimited") {
      this.goal.status = "active";
      this.activeSince = Date.now();
    }

    this.goal.updatedAt = now();

    return this.goal;
  }

  private reportError(error: unknown): void {
    this.show(error instanceof Error ? error.message : String(error));
  }

  private async editValue(ctx: ExtensionContext): Promise<string | undefined> {
    if (!this.goal) {
      this.show("No goal is currently set.\n\nUsage: /goal <objective>");

      return undefined;
    }

    if (!ctx.hasUI) {
      this.show("/goal edit requires interactive mode.");

      return undefined;
    }

    return ctx.ui.editor("Edit goal objective:", this.goal.objective);
  }

  private async editCommand(ctx: ExtensionContext): Promise<void> {
    const value = await this.editValue(ctx);

    if (value === undefined) return;

    try {
      this.edit(value);
      this.persist("edit");
      this.show(summary(this.goal!));
      this.setStatus(ctx);
      this.queue(ctx);
    } catch (error) {
      this.reportError(error);
    }
  }

  private async canReplace(value: string, ctx: ExtensionContext): Promise<boolean> {
    if (!this.goal || this.goal.status === "complete") return true;

    return ctx.hasUI && ctx.ui.confirm("Replace goal?", `New objective: ${value}`);
  }

  private async createCommand(args: string, ctx: ExtensionContext): Promise<void> {
    try {
      const value = validateObjective(args);

      if (!(await this.canReplace(value, ctx))) return;
      this.setGoal(value);
      this.persist("set");
      this.show(`Goal active\n\n${summary(this.goal!)}`);
      this.setStatus(ctx);
      this.queue(ctx);
    } catch (error) {
      this.reportError(error);
    }
  }

  private async command(args: string, ctx: ExtensionContext): Promise<void> {
    const value = args.trim().toLowerCase();

    if (!value) return this.showCurrent(ctx);

    return this.routeCommand(value, args, ctx);
  }

  private showCurrent(ctx: ExtensionContext): void {
    const current = this.snapshot();
    this.show(current ? summary(current) : "Usage: /goal <objective>\n\nNo goal is currently set.");
    this.setStatus(ctx);
  }

  private async routeCommand(value: string, args: string, ctx: ExtensionContext): Promise<void> {
    if (value === "clear") return this.clearCommand(ctx);

    if (this.isStatusCommand(value)) return this.statusCommand(this.statusValue(value), ctx);

    if (value === "edit") return this.editCommand(ctx);

    return this.createCommand(args, ctx);
  }

  private isStatusCommand(value: string): boolean {
    return value === "pause" || value === "resume";
  }

  private statusValue(value: string): GoalStatus {
    return value === "resume" ? "active" : "paused";
  }

  private clearCommand(ctx: ExtensionContext): void {
    this.goal = null;
    this.activeSince = null;
    this.continuationQueued = false;
    this.persist("clear");
    this.show("Goal cleared");
    this.setStatus(ctx);
  }
  private statusCommand(status: GoalStatus, ctx: ExtensionContext): void {
    try {
      this.changeStatus(status);
      this.persist("status");
      this.show(summary(this.goal!));
      this.setStatus(ctx);

      if (status === "active") this.queue(ctx);
    } catch (error) {
      this.reportError(error);
    }
  }

  private goalTool(
    ctx: ExtensionContext,
    report: boolean,
  ): { content: { type: "text"; text: string }[]; details: GoalResult } {
    const details = result(this.snapshot(), ctx.sessionManager.getSessionId(), report);

    return { content: resultText(details), details };
  }
  private createTool(
    params: { objective: string; token_budget?: number },
    ctx: ExtensionContext,
  ): Promise<ReturnType<GoalExtension["goalTool"]>> {
    if (this.goal && this.goal.status !== "complete")
      throw new Error("an unfinished goal already exists");
    this.setGoal(params.objective, params.token_budget);
    this.persist("set");
    this.setStatus(ctx);

    return Promise.resolve(this.goalTool(ctx, false));
  }
  private updateTool(
    status: GoalStatus,
    ctx: ExtensionContext,
  ): Promise<ReturnType<GoalExtension["goalTool"]>> {
    this.changeStatus(status);
    this.persist("status");
    this.setStatus(ctx);

    return Promise.resolve(this.goalTool(ctx, status === "complete"));
  }

  private registerEvents(): void {
    this.registerSessionEvents();
    this.registerAgentEvents();
    this.registerContextEvent();
  }

  private registerSessionEvents(): void {
    this.pi.on("session_start", (_event, ctx) => this.restore(ctx));
    this.pi.on("session_tree", (_event, ctx) => this.restore(ctx));
  }

  private registerAgentEvents(): void {
    this.pi.on("before_agent_start", (event) => {
      const goal = this.snapshot();

      return goal?.status === "active"
        ? { systemPrompt: `${event.systemPrompt}\n\nActive goal: ${goal.objective}` }
        : undefined;
    });
    this.pi.on("agent_start", () => {
      this.continuationQueued = false;
      this.startedGoal = this.goal?.status === "active" ? this.goal.id : null;
    });
    this.pi.on("agent_end", (event, ctx) => this.agentEnd(event.messages, ctx));
  }

  private registerContextEvent(): void {
    this.pi.on("context", (event) => ({
      messages: event.messages.filter((message) => !this.isHiddenMessage(message)),
    }));
  }

  private isHiddenMessage(message: unknown): boolean {
    return (message as { customType?: string }).customType === UI_MESSAGE_TYPE;
  }

  private accountTokens(messages: unknown[]): void {
    if (this.goal && this.startedGoal === this.goal.id)
      this.goal.tokensUsed += totalUsage(messages);
  }

  private applyBudget(): boolean {
    if (
      !this.goal ||
      this.goal.tokenBudget === undefined ||
      this.goal.tokensUsed < this.goal.tokenBudget
    )
      return false;
    this.changeStatus("budgetLimited");
    this.show(`Goal limited by budget\n\n${summary(this.goal)}`);

    return true;
  }

  private agentEnd(messages: unknown[], ctx: ExtensionContext): void {
    if (!this.goal) return;
    this.accountTokens(messages);
    this.persistAccount(this.accountTime(), this.applyBudget());
    this.startedGoal = null;
    this.setStatus(ctx);

    if (this.handleStop(messages, ctx)) return;
    this.queueIfActive(messages, ctx);
  }

  private persistAccount(timeChanged: boolean, budgetChanged: boolean): void {
    if (timeChanged || budgetChanged || this.startedGoal !== null) this.persist("account");
  }

  private queueIfActive(messages: unknown[], ctx: ExtensionContext): void {
    if (this.goal?.status !== "active") return;

    if (lastAssistant(messages)?.stopReason === "error") return;
    this.queue(ctx);
  }

  private handleStop(messages: unknown[], ctx: ExtensionContext): boolean {
    const assistant = lastAssistant(messages);

    if (assistant?.stopReason === "error") return this.stopForError(assistant, ctx);

    if (assistant?.stopReason !== "aborted") return false;
    this.changeStatus("paused");
    this.persist("status");
    this.show(`Goal paused\n\n${summary(this.goal!)}`);
    this.setStatus(ctx);

    return true;
  }

  private stopForError(message: MessageLike, ctx: ExtensionContext): boolean {
    const status: GoalStatus = /usage|rate|quota|limit/i.test(message.errorMessage ?? "")
      ? "usageLimited"
      : "blocked";

    this.changeStatus(status);
    this.persist("status");
    this.show(`Goal ${STATUS_LABELS[status]}\n\n${summary(this.goal!)}`);
    this.setStatus(ctx);

    return true;
  }

  private registerCommands(): void {
    this.pi.registerCommand("goal", {
      description: "Set or view the goal for a long-running task",
      getArgumentCompletions: (prefix) =>
        ["clear", "edit", "pause", "resume"]
          .filter((value) => value.startsWith(prefix))
          .map((value) => ({ value, label: value })),
      handler: (args, ctx) => this.command(args, ctx),
    });
  }

  private registerTools(): void {
    this.registerGetTool();
    this.registerCreateTool();
    this.registerUpdateTool();
  }

  private registerGetTool(): void {
    this.pi.registerTool({
      name: "get_goal",
      label: "Get Goal",
      description: "Get the current goal and its usage state.",
      parameters: Type.Object({}),
      execute: (_id, _params, _signal, _update, ctx) => Promise.resolve(this.goalTool(ctx, false)),
    });
  }

  private registerCreateTool(): void {
    this.pi.registerTool({
      name: "create_goal",
      label: "Create Goal",
      description: "Create a long-running goal when explicitly requested.",
      parameters: CreateParams,
      execute: (_id, params, _signal, _update, ctx) => this.createTool(params, ctx),
    });
  }

  private registerUpdateTool(): void {
    this.pi.registerTool({
      name: "update_goal",
      label: "Update Goal",
      description: "Mark the current goal complete or blocked after verification.",
      parameters: UpdateParams,
      execute: (_id, params, _signal, _update, ctx) => this.updateTool(params.status, ctx),
    });
  }

  register(): void {
    this.registerEvents();
    this.registerCommands();
    this.registerTools();
  }
}

export default function goalExtension(pi: ExtensionAPI): void {
  new GoalExtension(pi).register();
}
