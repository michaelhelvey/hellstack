import { existsSync, readdirSync } from "node:fs";
import { readdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";

/**
 * The code in the installed pi bundle that renders the [Skills] section. The bundle is minified,
 * so this patch matches the exact bundle text and nothing else.
 */
const SKILLS_BLOCK = String.raw`let skills=skillsResult.skills;if(skills.length>0){let groups=this.buildScopeGroups(skills.map(skill=>({path:skill.filePath,sourceInfo:skill.sourceInfo})));addLoadedSection("Skills",()=>formatCompactList(skills.map(skill=>skill.name)),()=>this.formatScopeGroups(groups,{formatPath:item=>this.formatDisplayPath(item.path),formatPackagePath:item=>this.getShortPath(item.path,item.sourceInfo)}))}`;

/**
 * The replacement code. It renders skills that the model can invoke on one line, and skills with
 * `disable-model-invocation: true` on a second line.
 */
const SPLIT_BLOCK = String.raw`let skills=skillsResult.skills;if(skills.length>0){let modelSkills=skills.filter(skill=>!skill.disableModelInvocation),commandSkills=skills.filter(skill=>skill.disableModelInvocation),groups=this.buildScopeGroups(skills.map(skill=>({path:skill.filePath,sourceInfo:skill.sourceInfo})));addLoadedSection("Skills",()=>{let lines=[];return modelSkills.length>0&&lines.push(formatCompactList(modelSkills.map(skill=>skill.name))),commandSkills.length>0&&lines.push(theme.fg("dim","  command-only: "+commandSkills.map(skill=>skill.name).sort((a,b)=>a.localeCompare(b)).join(", "))),lines.join("\n")},()=>this.formatScopeGroups(groups,{formatPath:item=>this.formatDisplayPath(item.path),formatPackagePath:item=>this.getShortPath(item.path,item.sourceInfo)}))}`;

/** Text that only a patched bundle has. */
const PATCH_MARKER = "command-only: ";

/** The message for a pi version that changed the bundle text. */
const NOT_FOUND =
  "Cannot find the [Skills] code in the pi bundle. The pi version changed the bundle. Update this patch to the new bundle text.";

/** Returns true when `source` has the [Skills] code, patched or not. */
export function hasSkillsCode(source: string): boolean {
  return source.includes(SKILLS_BLOCK) || source.includes(PATCH_MARKER);
}

/**
 * Splits the [Skills] section of a pi bundle into model-invokable skills and command-only skills.
 * Returns `source` as it is when it is already patched.
 * @throws When the bundle text does not contain the expected code.
 */
export function applySkillSplit(source: string): string {
  if (source.includes(PATCH_MARKER)) return source;
  if (!source.includes(SKILLS_BLOCK)) throw new Error(NOT_FOUND);
  return source.replace(SKILLS_BLOCK, SPLIT_BLOCK);
}

/** Returns the pi agent folder: `PI_CODING_AGENT_DIR`, or `~/.pi/agent`. */
export function agentDir(): string {
  return process.env.PI_CODING_AGENT_DIR ?? path.join(homedir(), ".pi", "agent");
}

/** Returns the folders of the pi packages in a managed install, newest release first. */
function packageCandidates(agentDirPath: string): string[] {
  const releases = path.join(agentDirPath, "install", "releases");
  if (!existsSync(releases)) return [];
  return readdirSync(releases)
    .sort()
    .reverse()
    .map((name) => path.join(releases, name, "node_modules", "@earendil-works", "pi-coding-agent"));
}

/** Returns the folder of the installed pi package: `PI_PACKAGE_DIR`, or the managed install. */
export function installedPackageDir(agentDirPath: string = agentDir()): string {
  const override = process.env.PI_PACKAGE_DIR;
  if (override) return override;
  const found = packageCandidates(agentDirPath).find((dir) => existsSync(dir));
  if (!found)
    throw new Error("Cannot find the installed pi package. Set PI_PACKAGE_DIR to its folder.");
  return found;
}

/** Reads the code of the pi bundle files in `dir`. */
async function chunkSources(dir: string): Promise<Array<{ file: string; source: string }>> {
  const names = (await readdir(dir)).filter((name) => name.endsWith(".js"));
  return Promise.all(
    names.map(async (name) => {
      const file = path.join(dir, name);
      return { file, source: await readFile(file, "utf8") };
    }),
  );
}

/** Writes the patched code of `chunks`. Returns the paths of the changed bundles. */
async function patchChunks(chunks: Array<{ file: string; source: string }>): Promise<string[]> {
  const patched: string[] = [];
  for (const chunk of chunks) {
    const next = applySkillSplit(chunk.source);
    if (next === chunk.source) continue;
    await writeFile(chunk.file, next);
    patched.push(chunk.file);
  }
  return patched;
}

/**
 * Patches the [Skills] section of the installed pi bundle.
 * Returns the paths of the bundles that the patch changed.
 * @throws When no bundle contains the expected code.
 */
export async function patchInstalledPi(
  packageDir: string = installedPackageDir(),
): Promise<string[]> {
  const chunks = await chunkSources(path.join(packageDir, "dist", "bundle", "chunks"));
  const targets = chunks.filter((chunk) => hasSkillsCode(chunk.source));
  if (targets.length === 0) throw new Error(NOT_FOUND);
  return patchChunks(targets);
}

async function main(): Promise<void> {
  const patched = await patchInstalledPi();
  if (patched.length === 0) console.log("pi: the [Skills] patch is already applied");
  for (const file of patched) console.log(`pi: patched ${file}`);
}

if (import.meta.main) await main();
