#!/usr/bin/env bun
/**
 * Sends a question to Michael as a Microsoft Teams chat message. The script uses the Teams web app
 * in Michael's running Chrome. It does not use the Teams API.
 *
 * Usage:
 *   bun ask-michael.ts <message...>
 *
 * Do these steps in Chrome before you use this script:
 *
 * 1. Go to chrome://inspect/#remote-debugging and enable remote debugging. This lets the script
 *    connect to your running Chrome. You must do this step one time only.
 * 2. Go to https://teams.cloud.microsoft and sign in to Teams. If Teams asks how to open the link,
 *    click "Use the web app instead". The script uses the session of this sign-in. If the session
 *    is not valid, the script stops with an error.
 * 3. When the script connects, Chrome can ask you to allow remote debugging. Click "Allow".
 *
 * The script opens a new tab, sends the message, and closes the tab. It does not close Chrome.
 * Set CHROME_DATA_DIR if your Chrome data is not in the default macOS location. The first run
 * installs puppeteer-core into `~/.cache/ask-michael-skill/`.
 */
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { parseArgs } from "node:util";

import type { Browser, Page, PuppeteerNode } from "puppeteer-core";

const RECIPIENT = "michael.helvey@transport4.com";

const DEPENDENCIES = { "puppeteer-core": "25.12.0" } as const;

const CHROME_DATA_DIR =
  process.env["CHROME_DATA_DIR"] ??
  join(homedir(), "Library", "Application Support", "Google", "Chrome");

const TEAMS_URL = "https://teams.cloud.microsoft/";
const LOGIN_HOSTS = ["login.microsoftonline.com", "login.live.com", "login.microsoft.com"];

const CHAT_TITLE_SELECTOR = '[data-tid="chat-title"]';
const COMPOSE_SELECTOR = '[data-tid="ckeditor"]';
const SEND_BUTTON_SELECTOR = 'button[data-tid="sendMessageCommands-send"]';
const MESSAGE_SELECTOR = '[data-tid="chat-pane-message"]';

const TIMEOUT_MS = 60_000;

/** Tells that the browser has no valid Teams session. */
export class NotLoggedInError extends Error {
  constructor() {
    super(`Not logged in to Teams web. Log in at ${TEAMS_URL} in Chrome.`);
  }
}

async function loadPuppeteer(): Promise<PuppeteerNode> {
  const hash = createHash("sha256").update(JSON.stringify(DEPENDENCIES)).digest("hex").slice(0, 12);
  const root = process.env["XDG_CACHE_HOME"] || join(homedir(), ".cache");
  const dir = join(root, "ask-michael-skill", hash);
  const marker = join(dir, ".installed");

  if (!existsSync(marker)) {
    console.error(`Installing puppeteer-core into ${dir} (first run only)...`);
    await mkdir(dir, { recursive: true });

    const manifest = { private: true, type: "module", dependencies: DEPENDENCIES };

    await writeFile(join(dir, "package.json"), JSON.stringify(manifest, null, 2));

    const proc = Bun.spawn([process.execPath, "install"], {
      cwd: dir,
      stdio: ["ignore", "inherit", "inherit"],
    });

    if ((await proc.exited) !== 0) throw new Error(`bun install failed in ${dir}`);

    await writeFile(marker, "");
  }

  const module = (await import(Bun.resolveSync("puppeteer-core", dir))) as {
    default: PuppeteerNode;
  };

  return module.default;
}

async function connect(): Promise<Browser> {
  const portFile = Bun.file(join(CHROME_DATA_DIR, "DevToolsActivePort"));
  if (!(await portFile.exists())) {
    throw new Error(
      "Chrome remote debugging is off. Enable it at chrome://inspect/#remote-debugging.",
    );
  }

  const [port, path] = (await portFile.text()).trim().split("\n");
  const puppeteer = await loadPuppeteer();

  return puppeteer.connect({
    browserWSEndpoint: `ws://127.0.0.1:${port}${path}`,
    defaultViewport: null,
  });
}

/** Opens the 1:1 chat with `email` and returns the chat title that Teams shows. */
async function openChat(page: Page, email: string): Promise<string> {
  await page.goto(`${TEAMS_URL}#/l/chat/0/0?users=${encodeURIComponent(email)}`);

  const loginRedirect = page
    .waitForFunction((hosts: string[]) => hosts.includes(location.hostname), {}, LOGIN_HOSTS)
    .then(() => null);
  const chatTitle = page.waitForSelector(CHAT_TITLE_SELECTOR);

  const title = await Promise.race([loginRedirect, chatTitle]).catch(() => null);
  if (!title) {
    throw new NotLoggedInError();
  }

  return title.evaluate((element) => element.textContent?.trim() ?? email);
}

function countMessages(page: Page, message: string): Promise<number> {
  return page.$$eval(
    MESSAGE_SELECTOR,
    (elements, text) => elements.filter((element) => element.textContent?.includes(text)).length,
    message,
  );
}

async function sendMessage(page: Page, message: string): Promise<void> {
  const compose = await page.waitForSelector(COMPOSE_SELECTOR, { visible: true });
  if (!compose) {
    throw new Error("Could not find the message compose box.");
  }

  const before = await countMessages(page, message);

  await compose.click();
  await page.keyboard.type(message);
  await page.click(SEND_BUTTON_SELECTOR);

  await page.waitForFunction(
    (selector, text, count) =>
      [...document.querySelectorAll(selector)].filter((element) =>
        element.textContent?.includes(text),
      ).length > count,
    {},
    MESSAGE_SELECTOR,
    message,
    before,
  );
}

async function send(email: string, message: string): Promise<void> {
  const browser = await connect();
  const page = await browser.newPage();
  page.setDefaultTimeout(TIMEOUT_MS);

  try {
    const title = await openChat(page, email);
    await sendMessage(page, message);
    console.log(`Sent message to ${title} (${email}).`);
  } finally {
    await page.close();
    // Disconnect only. A call to browser.close() stops the user's Chrome.
    await browser.disconnect();
  }
}

async function main(): Promise<void> {
  const { positionals } = parseArgs({ args: Bun.argv.slice(2), allowPositionals: true });

  if (positionals.length === 0) {
    throw new Error("Usage: bun ask-michael.ts <message...>");
  }

  return send(RECIPIENT, positionals.join(" "));
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
