import { readFeed } from "../core/feed.ts";
import { createHc, type Hc, type HcTerminal } from "../core/hc.ts";
import { listInbox } from "../core/inbox.ts";
import { listTasks } from "../core/ledger.ts";
import { ledgerPaths, type LedgerPaths } from "../core/paths.ts";
import { buildBoard, type Board } from "./model.ts";

/** The count of feed records that the board reads to find the last record of each source. */
export const BOARD_FEED_SCAN = 500;

async function liveTerminals(hc: Hc): Promise<HcTerminal[]> {
  return hc.ls().catch(() => []);
}

/**
 * Reads the ledger and `hc ls` and returns the board model. When `hc` fails, the board shows no
 * terminals.
 */
export async function loadBoard(
  paths: LedgerPaths = ledgerPaths(),
  hc: Hc = createHc(),
  now: Date = new Date(),
): Promise<Board> {
  const [{ tasks }, inbox, feed, terminals] = await Promise.all([
    listTasks(paths),
    listInbox(paths),
    readFeed(BOARD_FEED_SCAN, paths),
    liveTerminals(hc),
  ]);
  return buildBoard({ tasks, inbox: inbox.length, feed, terminals, now });
}
