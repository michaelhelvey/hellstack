import path from "node:path";

/** The pi packages that this package uses for types. Their versions must be the same as pi. */
export const PI_PACKAGES = [
  "@earendil-works/pi-coding-agent",
  "@earendil-works/pi-ai",
  "@earendil-works/pi-tui",
];

/** The pi binary to update. Set `PI_BIN` to use a different binary. */
const PI_BIN = process.env.PI_BIN ?? "pi";

const PACKAGE_DIR = path.resolve(import.meta.dir, "..");

/** Returns the version of the installed pi. */
export async function installedPiVersion(): Promise<string> {
  const proc = Bun.spawn([PI_BIN, "--version"], { stdout: "pipe", stderr: "ignore" });
  return (await new Response(proc.stdout).text()).trim();
}

async function run(cmd: string[]): Promise<void> {
  const code = await Bun.spawn(cmd, { stdio: ["inherit", "inherit", "inherit"] }).exited;
  if (code !== 0) throw new Error(`${cmd.join(" ")} failed with exit code ${code}`);
}

/** Updates pi, then sets the pi devDependencies to the new pi version. */
async function main(args: string[]): Promise<void> {
  await run([PI_BIN, "update", ...args]);
  const version = await installedPiVersion();
  await run([
    "bun",
    "add",
    "-d",
    "--cwd",
    PACKAGE_DIR,
    ...PI_PACKAGES.map((p) => `${p}@${version}`),
  ]);
  console.log(`pi devDependencies are at ${version}`);
}

if (import.meta.main) await main(process.argv.slice(2));
