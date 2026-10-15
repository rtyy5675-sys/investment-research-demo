// Runs the existing HTTP checks against fresh isolated profiles and synthetic
// upstreams. Product code and the original assertions remain unchanged.
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { join } from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const evidence = join(root, 'docs/evidence/system-acceptance-2026-10-15');
const runId = `${Date.now()}-${process.pid}`;
const profiles = join(root, 'artifacts/system-acceptance-2026-10-15/http-profile', runId);
await mkdir(evidence, { recursive: true });
const outcomes = [];
for (const name of ['runtime', 'memory', 'model-settings']) {
  const profile = join(profiles, name);
  const data = join(profile, 'artifacts'); // ENOSPC fixture matches /artifacts/tasks/.
  const memory = join(profile, 'memory');
  await Promise.all([mkdir(data, { recursive: true }), mkdir(memory, { recursive: true })]);
  const originalURL = new URL(`verify-${name}.mjs`, import.meta.url);
  let source = await readFile(originalURL, 'utf8');
  source = source.replaceAll('import.meta.url', JSON.stringify(originalURL.href));
  source = source.replaceAll("'../artifacts/", `'${pathToFileURL(`${data}/`).href}`);
  source = source.replaceAll('`../artifacts/', '`' + pathToFileURL(`${data}/`).href);
  source = source.replaceAll("'../docs/evidence/", `'${pathToFileURL(`${profile}/script-reports/`).href}`);
  source = source.replaceAll('reports = []', 'reports = (globalThis.__httpReports = [])');
  source = source.replaceAll('reports=[]', 'reports=(globalThis.__httpReports=[])');
  // These scripts otherwise delete their private temporary files on exit.
  // Retain the synthetic profiles for inspection in this acceptance run.
  if (name === 'memory') {
    source = source.replace("await mkdtemp(join(tmpdir(),'research-memory-http-'))", JSON.stringify(memory));
    source = source.replace('await rm(directory,{recursive:true,force:true});', '/* retained isolated evidence */');
  }
  if (name === 'model-settings') {
    source = source.replace("await mkdtemp(join(tmpdir(),'jianwei-api-settings-'))", JSON.stringify(profile));
    source = source.replace('await rm(directory,{recursive:true,force:true});', '/* retained synthetic settings only */');
  }
  // Redirect script-level generated settings files, in addition to inherited
  // environment paths, so no user configuration can be loaded.
  source = source.replace('`/tmp/jianwei-model-settings-fixture-${process.pid}-${port}.json`', '`' + profile + '/settings-${process.pid}-${port}.json`');
  // Preserve each server's stdout/stderr on both successful and failed cases.
  if (name !== 'model-settings') {
    source = source.replace('finally { child.kill', `finally { await writeFile(${JSON.stringify(profile)} + '/server-' + port + '.log', logs); child.kill`);
  } else {
    source = source.replace('finally{await stop();', `finally{await writeFile(${JSON.stringify(join(profile, 'server.log'))},logs);await stop();`);
  }
  const partialPath = join(evidence, `http-${name}-scenarios.json`);
  source = `import {writeFileSync as saveAcceptanceSync} from 'node:fs';\nprocess.on('exit',()=>saveAcceptanceSync(${JSON.stringify(partialPath)},JSON.stringify({runId:${JSON.stringify(runId)},reports:globalThis.__httpReports||[]},null,2)));\n` + source;
  const env = { ...process.env, NODE_ENV: 'test', PREVIEW_ACCESS_PASSWORD: '', APP_DATA_DIR: data, RESEARCH_MEMORY_DIRECTORY: memory, MODEL_SETTINGS_FILE: join(profile, 'settings.json'), RESEARCH_OWNER_ID: `http-acceptance-${runId}-${name}`, RESEARCH_STORAGE_MODE: 'local' };
  const startedAt = new Date().toISOString();
  const child = spawn(process.execPath, ['--input-type=module', '-e', source], { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = '';
  child.stdout.on('data', bytes => { log += bytes; });
  child.stderr.on('data', bytes => { log += bytes; });
  const exitCode = await new Promise(resolve => child.once('exit', resolve));
  await writeFile(join(evidence, `http-${name}.log`), log);
  const partial = JSON.parse(await readFile(partialPath, 'utf8').catch(() => '{"reports":[]}'));
  outcomes.push({ script: `scripts/verify-${name}.mjs`, startedAt, endedAt: new Date().toISOString(), exitCode, passedScenarios: partial.reports.length, status: exitCode === 0 ? 'pass' : 'fail', profile, log: `http-${name}.log` });
  console.log(JSON.stringify(outcomes.at(-1)));
}
const report = { checkedAt: new Date().toISOString(), runId, scope: 'Real isolated local HTTP, synthetic model and MCP, no external fetch. Original assertions retained. Does not verify actual financial claims or external credentials.', isolation: { profiles, userPortsUntouched: [8791, 8797], fixturePathDependency: 'Storage ENOSPC injection requires /artifacts/tasks/ in task file paths.' }, outcomes };
await writeFile(join(evidence, 'http-summary.json'), JSON.stringify(report, null, 2));
process.exitCode = outcomes.some(item => item.status !== 'pass') ? 1 : 0;
