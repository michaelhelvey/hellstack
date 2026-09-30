import { utimes } from "node:fs/promises";
import path from "node:path";

import { z } from "zod";

const DAY_MS = 24 * 60 * 60 * 1000;

/** The fields of a todo file that a test writes. */
export interface TodoFixture {
  title: string;
  status?: string;
  assigned_to_session?: string;
  ageDays?: number;
  body?: string;
}

const TodoFileSchema = z.object({
  id: z.string(),
  title: z.string(),
  tags: z.array(z.string()),
  status: z.string(),
  created_at: z.string(),
  assigned_to_session: z.string().optional(),
});

/** A todo file as a test reads it: the JSON front matter and the body. */
export type TodoFile = z.infer<typeof TodoFileSchema> & { body: string };

/** The files of a todo folder. */
export class TodoDir {
  constructor(readonly dir: string) {}

  /** The path of the file of a todo. */
  file(id: string): string {
    return path.join(this.dir, `${id}.md`);
  }

  /** Writes a todo file in the format of the todo extension. */
  async write(id: string, fixture: TodoFixture): Promise<void> {
    const { title, status = "open", assigned_to_session, ageDays = 0, body = "" } = fixture;
    const created_at = new Date(Date.now() - ageDays * DAY_MS).toISOString();
    const frontMatter = { id, title, tags: [], status, created_at, assigned_to_session };
    await Bun.write(this.file(id), `${JSON.stringify(frontMatter, null, 2)}\n\n${body}`);
  }

  /** Reads a todo file. */
  async read(id: string): Promise<TodoFile> {
    const content = await Bun.file(this.file(id)).text();
    const end = content.indexOf("\n}") + 2;
    const frontMatter = TodoFileSchema.parse(JSON.parse(content.slice(0, end)));
    return { ...frontMatter, body: content.slice(end).replace(/^\n+/, "") };
  }

  /** Returns true if the todo file exists. */
  exists(id: string): Promise<boolean> {
    return Bun.file(this.file(id)).exists();
  }

  /** Writes a lock file for a todo that another session made `ageMs` milliseconds ago. */
  async writeLock(id: string, ageMs: number): Promise<string> {
    const lockPath = path.join(this.dir, `${id}.lock`);
    await Bun.write(lockPath, JSON.stringify({ id, pid: 1, session: "other.jsonl" }));
    const time = new Date(Date.now() - ageMs);
    await utimes(lockPath, time, time);
    return lockPath;
  }
}
