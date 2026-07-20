#!/usr/bin/env bun
/**
 * Production avatar pipeline orchestrator.
 *
 * Chains S0 (source validation) → S1 (face-rig transfer) → S2 (identity bake) →
 * S3 (coverage/motion gates) for VRoid-topology-compatible Perfect Sync transfer.
 *
 * Usage:
 *   bun scripts/avatar-pipeline/run-production.ts \
 *     --asset-id kamatte-ps-sico \
 *     --base data/avatar-models/kizuna-ai-kamatte-vrm1/Kizuna_AI_KAMATTE_v2.vrm \
 *     --donor data/avatar-models/hinzka-vroid-v110-female-perfectsync/VRoid_V110_Female_v1.1.3.vrm \
 *     --proportions data/avatar-models/kamatte-ps-sico/proportions.json \
 *     --license-notes data/avatar-models/kizuna-ai-kamatte-vrm1/LICENSE-NOTES.md \
 *     [--blender /opt/homebrew/bin/blender]
 */
import { appendFile, mkdir, readFile, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
  type AvatarPipelineManifest,
  type FileHash,
  type GateResult,
  type Provenance,
  type StageRecord,
  STAGE_NAMES,
  atomicWriteManifest,
  computeVerdict,
  decodeManifest,
  freshManifest,
  hashFile,
  hasVrmExtension,
  parseGlbJsonChunk,
  readManifest,
  validateResume,
} from './manifest.ts';
import { generateProofCard, writeProofCard } from './proof-card.ts';
import { runtimeGateResults } from './vrm-probe.ts';

const ROOT = resolve(import.meta.dir, '../..');

// ---------------------------------------------------------------------------
// CLI argument parsing
// ---------------------------------------------------------------------------

type Options = {
  assetId: string;
  base: string;
  donor: string;
  proportions: string;
  licenseNotes: string;
  blender: string;
};

function parseArgs(argv: readonly string[]): Options {
  const opts: Partial<Options> & { blender: string } = { blender: 'blender' };
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    const value = argv[i + 1];
    if (value === undefined) throw new Error(`Missing value for ${flag}`);
    if (flag === '--asset-id') opts.assetId = value;
    else if (flag === '--base') opts.base = value;
    else if (flag === '--donor') opts.donor = value;
    else if (flag === '--proportions') opts.proportions = value;
    else if (flag === '--license-notes') opts.licenseNotes = value;
    else if (flag === '--blender') opts.blender = value;
    else throw new Error(`Unknown option: ${flag}`);
    i += 1;
  }
  for (const k of ['assetId', 'base', 'donor', 'proportions', 'licenseNotes'] as const) {
    if (!opts[k]) throw new Error(`--${k.replace(/[A-Z]/g, c => `-${c.toLowerCase()}`)} is required`);
  }
  return opts as Options;
}

// ---------------------------------------------------------------------------
// Logging
// ---------------------------------------------------------------------------

async function stageLog(logPath: string, message: string): Promise<void> {
  const line = `[${new Date().toISOString()}] ${message}\n`;
  process.stderr.write(line);
  await appendFile(logPath, line);
}

// ---------------------------------------------------------------------------
// Stage runner wrapper — resume, error durability, atomic manifest writes
// ---------------------------------------------------------------------------

async function runStage(
  manifest: AvatarPipelineManifest,
  manifestPath: string,
  stageName: string,
  logPath: string,
  fn: (stage: StageRecord, log: (msg: string) => Promise<void>) => Promise<void>,
  requiredInputPaths: readonly string[] | null = [],
): Promise<void> {
  const stage = manifest.stages[stageName];
  if (!stage) throw new Error(`Unknown stage: ${stageName}`);

  // Resume only when hashes match and the stage records every current direct
  // input. `null` forces execution when a required upstream artifact is absent.
  const hasRequiredInputs = requiredInputPaths !== null
    && requiredInputPaths.every(path => stage.inputs.some(input => input.path === path));
  if (hasRequiredInputs && await validateResume(stage)) {
    await stageLog(logPath, `${stageName}: resuming — all hashes valid, skipping`);
    return;
  }

  // Reset stage for fresh run
  stage.status = 'running';
  stage.startedAt = new Date().toISOString();
  stage.completedAt = null;
  stage.inputs = [];
  stage.outputs = [];
  stage.gates = [];
  stage.error = null;
  stage.blenderManifestPath = null;
  await atomicWriteManifest(manifestPath, manifest);

  try {
    await fn(stage, (msg: string) => stageLog(logPath, `${stageName}: ${msg}`));
    stage.status = 'completed';
    stage.completedAt = new Date().toISOString();
  } catch (err) {
    stage.status = 'failed';
    stage.completedAt = new Date().toISOString();
    stage.error = err instanceof Error ? err.message : String(err);
    await stageLog(logPath, `${stageName}: FAILED — ${stage.error}`);
  }

  manifest.finalVerdict = computeVerdict(manifest);
  await atomicWriteManifest(manifestPath, manifest);
}

// ---------------------------------------------------------------------------
// S0 — Source validation
// ---------------------------------------------------------------------------

async function runS0(stage: StageRecord, log: (m: string) => Promise<void>, opts: Options): Promise<void> {
  const basePath = resolve(ROOT, opts.base);
  const donorPath = resolve(ROOT, opts.donor);
  const licenseNotesPath = resolve(ROOT, opts.licenseNotes);
  const proportionsPath = resolve(ROOT, opts.proportions);
  const reconstructionReportPath = resolve(proportionsPath, '..', 'reconstruction-report.json');

  // 1. Hash inputs
  stage.inputs.push(await hashFile(basePath));
  stage.inputs.push(await hashFile(donorPath));
  stage.inputs.push(await hashFile(licenseNotesPath));
  stage.inputs.push(await hashFile(proportionsPath));
  stage.inputs.push(await hashFile(reconstructionReportPath));

  // 2. Validate base GLB/VRM
  await log('validating base VRM...');
  const baseBuffer = Buffer.from(await readFile(basePath));
  const baseGltf = parseGlbJsonChunk(baseBuffer);
  const baseIsVrm = hasVrmExtension(baseGltf);
  stage.gates.push({
    name: 'base-vrm-parseable',
    status: baseIsVrm ? 'passed' : 'failed',
    threshold: 'GLB JSON chunk readable, VRM extension present',
    observed: baseIsVrm ? 'VRM extension found' : 'no VRM extension',
    detail: baseIsVrm ? 'ok' : 'Base file is a valid GLB but has no VRM extension',
  });
  if (!baseIsVrm) throw new Error('Base file has no VRM extension');

  // 3. Validate donor GLB/VRM
  await log('validating donor VRM...');
  const donorBuffer = Buffer.from(await readFile(donorPath));
  const donorGltf = parseGlbJsonChunk(donorBuffer);
  const donorIsVrm = hasVrmExtension(donorGltf);
  stage.gates.push({
    name: 'donor-vrm-parseable',
    status: donorIsVrm ? 'passed' : 'failed',
    threshold: 'GLB JSON chunk readable, VRM extension present',
    observed: donorIsVrm ? 'VRM extension found' : 'no VRM extension',
    detail: donorIsVrm ? 'ok' : 'Donor file is a valid GLB but has no VRM extension',
  });
  if (!donorIsVrm) throw new Error('Donor file has no VRM extension');

  // 4. License notes exist
  await stat(licenseNotesPath); // throws if missing
  stage.gates.push({
    name: 'license-notes-present',
    status: 'passed',
    threshold: 'LICENSE-NOTES.md exists',
    observed: 'present',
    detail: licenseNotesPath,
  });

  // 5. Proportions: schemaVersion 2, status ok
  await log('validating proportions.json...');
  const propsRaw: Record<string, unknown> = JSON.parse(await readFile(proportionsPath, 'utf8'));
  const propsValid = propsRaw['schemaVersion'] === 2 && propsRaw['status'] === 'ok';
  stage.gates.push({
    name: 'proportions-schema-valid',
    status: propsValid ? 'passed' : 'failed',
    threshold: 'schemaVersion=2, status=ok',
    observed: `schemaVersion=${propsRaw['schemaVersion']}, status=${propsRaw['status']}`,
    detail: propsValid ? 'ok' : 'Proportions artifact has invalid schema or status',
  });
  if (!propsValid) throw new Error('proportions.json schemaVersion must be 2 and status must be ok');

  // 6. Reconstruction report: schemaVersion 2, status ok, matching reconstructionId
  await log('validating reconstruction-report.json...');
  const reportRaw: Record<string, unknown> = JSON.parse(await readFile(reconstructionReportPath, 'utf8'));
  const reportSchemaOk = reportRaw['schemaVersion'] === 2 && reportRaw['status'] === 'ok';
  const idsMatch = typeof reportRaw['reconstructionId'] === 'string'
    && reportRaw['reconstructionId'] === propsRaw['reconstructionId'];
  const reportValid = reportSchemaOk && idsMatch;
  stage.gates.push({
    name: 'reconstruction-report-valid',
    status: reportValid ? 'passed' : 'failed',
    threshold: 'schemaVersion=2, status=ok, reconstructionId matches proportions',
    observed: `schemaVersion=${reportRaw['schemaVersion']}, status=${reportRaw['status']}, idMatch=${idsMatch}`,
    detail: reportValid ? 'ok' : `Report reconstructionId=${reportRaw['reconstructionId']}, proportions=${propsRaw['reconstructionId']}`,
  });
  if (!reportValid) throw new Error('reconstruction-report.json validation failed');

  await log('source validation passed');
}

// ---------------------------------------------------------------------------
// S1 — Face-rig transfer (via existing CLI)
// ---------------------------------------------------------------------------

async function runS1(
  stage: StageRecord,
  log: (m: string) => Promise<void>,
  opts: Options,
  pipelineDir: string,
): Promise<void> {
  const outputDir = resolve(pipelineDir, 'stages/face-rig-transfer');
  await mkdir(outputDir, { recursive: true });

  const basePath = resolve(ROOT, opts.base);
  const donorPath = resolve(ROOT, opts.donor);
  stage.inputs.push(await hashFile(basePath));
  stage.inputs.push(await hashFile(donorPath));

  await log('running face-rig-transfer...');
  const logFile = resolve(pipelineDir, 'logs/s1-face-rig-transfer-subprocess.log');
  const child = Bun.spawn(
    ['bun', resolve(ROOT, 'scripts/blender/face-rig-transfer.ts'),
      '--donor', donorPath,
      '--target', basePath,
      '--output-dir', outputDir,
      '--blender', opts.blender,
    ],
    { cwd: ROOT, stdout: 'pipe', stderr: 'pipe' },
  );

  // Stream output to log file
  const [stdout, stderr] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  await appendFile(logFile, `--- stdout ---\n${stdout}\n--- stderr ---\n${stderr}\n`);

  const exitCode = await child.exited;
  if (exitCode !== 0) throw new Error(`face-rig-transfer exited with code ${exitCode}. See ${logFile}`);

  // Read and validate transfer metrics
  const metricsPath = resolve(outputDir, 'transfer-metrics.json');
  const metricsRaw: Record<string, unknown> = JSON.parse(await readFile(metricsPath, 'utf8'));
  const channelsArr = Array.isArray(metricsRaw['channels']) ? metricsRaw['channels'] : [];
  const summaryRaw = typeof metricsRaw['summary'] === 'object' && metricsRaw['summary'] !== null
    ? metricsRaw['summary'] as Record<string, unknown>
    : {};
  const channels = channelsArr as readonly { channel: string; achievedAmplitude: number }[];
  const deadChannelsRaw = Array.isArray(summaryRaw['deadChannels']) ? summaryRaw['deadChannels'] as string[] : [];

  const channelCount = channels.length;
  stage.gates.push({
    name: 'all-52-channels-present',
    status: channelCount === 52 ? 'passed' : 'failed',
    threshold: '52 channels in transfer-metrics.json',
    observed: `${channelCount}`,
    detail: channelCount === 52 ? 'ok' : `Expected 52, got ${channelCount}`,
  });

  const deadCount = deadChannelsRaw.length;
  stage.gates.push({
    name: 'no-dead-channels',
    status: deadCount === 0 ? 'passed' : 'failed',
    threshold: '0 dead channels (achievedAmplitude=0)',
    observed: `${deadCount} dead`,
    detail: deadCount === 0 ? 'ok' : `Dead: ${deadChannelsRaw.join(', ')}`,
  });

  // Hash outputs
  stage.outputs.push(await hashFile(metricsPath));
  // Find the output VRM
  const vrmName = (await Array.fromAsync(new Bun.Glob('*.vrm').scan(outputDir)))[0];
  if (!vrmName) throw new Error('No .vrm output found in face-rig-transfer output dir');
  stage.outputs.push(await hashFile(resolve(outputDir, vrmName)));

  // Record blender manifest path
  const blenderManifestPath = resolve(outputDir, 'manifest.json');
  try {
    await stat(blenderManifestPath);
    stage.blenderManifestPath = blenderManifestPath;
  } catch { /* no manifest — fine */ }

  if (channelCount !== 52) throw new Error(`Transfer produced ${channelCount}/52 channels`);
  await log(`transfer complete: ${channelCount}/52 channels, ${deadCount} dead`);
}

// ---------------------------------------------------------------------------
// S2 — Identity bake (via existing CLI)
// ---------------------------------------------------------------------------

async function runS2(
  stage: StageRecord,
  log: (m: string) => Promise<void>,
  opts: Options,
  pipelineDir: string,
  manifest: AvatarPipelineManifest,
): Promise<void> {
  // Find S1 output VRM
  const s1OutputDir = resolve(pipelineDir, 'stages/face-rig-transfer');
  const s1VrmName = (await Array.fromAsync(new Bun.Glob('*.vrm').scan(s1OutputDir)))[0];
  if (!s1VrmName) throw new Error('No S1 output VRM found for identity bake');
  const baseVrm = resolve(s1OutputDir, s1VrmName);

  const outputDir = resolve(pipelineDir, 'stages/identity-bake');
  const publicModel = resolve(pipelineDir, `output/${opts.assetId}.vrm`);
  await mkdir(outputDir, { recursive: true });
  await mkdir(resolve(pipelineDir, 'output'), { recursive: true });

  const proportionsPath = resolve(ROOT, opts.proportions);
  stage.inputs.push(await hashFile(baseVrm));
  stage.inputs.push(await hashFile(proportionsPath));

  await log('running identity bake...');
  const logFile = resolve(pipelineDir, 'logs/s2-identity-bake-subprocess.log');
  const child = Bun.spawn(
    ['bun', resolve(ROOT, 'scripts/face-identity/bake-variants.ts'),
      '--base', baseVrm,
      '--proportions', proportionsPath,
      '--output-dir', outputDir,
      '--public-model', publicModel,
    ],
    { cwd: ROOT, stdout: 'pipe', stderr: 'pipe' },
  );

  const [stdout, stderr] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  await appendFile(logFile, `--- stdout ---\n${stdout}\n--- stderr ---\n${stderr}\n`);

  const exitCode = await child.exited;
  if (exitCode !== 0) throw new Error(`bake-variants exited with code ${exitCode}. See ${logFile}`);

  // Read and validate runner receipt
  const receiptPath = resolve(outputDir, 'runner-receipt.json');
  const receiptRaw: Record<string, unknown> = JSON.parse(await readFile(receiptPath, 'utf8'));
  const receipt = {
    strengths: Array.isArray(receiptRaw['strengths']) ? receiptRaw['strengths'] as number[] : [],
    selectedStrength: typeof receiptRaw['selectedStrength'] === 'number' ? receiptRaw['selectedStrength'] : 0,
    coverage: typeof receiptRaw['coverage'] === 'string' ? receiptRaw['coverage'] : '',
  };

  // Validate receipt: three strengths, 52/52 coverage, selected strength present
  const hasThreeStrengths = receipt.strengths.length === 3;
  stage.gates.push({
    name: 'three-variant-strengths',
    status: hasThreeStrengths ? 'passed' : 'failed',
    threshold: '3 strength values',
    observed: `${receipt.strengths.length}`,
    detail: hasThreeStrengths ? `strengths: ${receipt.strengths.join(', ')}` : 'unexpected strength count',
  });

  const coverageOk = receipt.coverage === '52/52';
  stage.gates.push({
    name: 'selected-variant-coverage',
    status: coverageOk ? 'passed' : 'failed',
    threshold: '52/52 ARKit channels preserved',
    observed: receipt.coverage,
    detail: coverageOk
      ? `selected strength=${receipt.selectedStrength}`
      : `Coverage ${receipt.coverage} at strength ${receipt.selectedStrength}`,
  });

  // Hash outputs
  stage.outputs.push(await hashFile(receiptPath));
  if (await Bun.file(publicModel).exists()) {
    stage.outputs.push(await hashFile(publicModel));
  }
  // Variant report
  const variantReportPath = resolve(outputDir, 'variants/variant-report.json');
  if (await Bun.file(variantReportPath).exists()) {
    stage.outputs.push(await hashFile(variantReportPath));
  }


  if (!coverageOk) throw new Error(`Identity bake coverage ${receipt.coverage} !== 52/52`);
  await log(`identity bake complete: coverage=${receipt.coverage}, selected strength=${receipt.selectedStrength}`);
}

// ---------------------------------------------------------------------------
// S3 — Coverage / motion gates (consume structural receipts)
// ---------------------------------------------------------------------------

async function runS3(
  stage: StageRecord,
  log: (m: string) => Promise<void>,
  pipelineDir: string,
  manifest: AvatarPipelineManifest,
): Promise<void> {
  await log('evaluating coverage and motion gates from structural receipts...');

  // Face-rig coverage: from S1 transfer-metrics
  const s1 = manifest.stages['face-rig-transfer'];
  const metricsOutput = s1?.outputs.find(o => o.path.endsWith('transfer-metrics.json'));
  if (metricsOutput) {
    stage.inputs.push({ ...metricsOutput });
    const metricsRaw: Record<string, unknown> = JSON.parse(await readFile(metricsOutput.path, 'utf8'));
    const summaryObj = typeof metricsRaw['summary'] === 'object' && metricsRaw['summary'] !== null
      ? metricsRaw['summary'] as Record<string, unknown>
      : {};
    const above03 = typeof summaryObj['amplitudeAtLeast0_3'] === 'number' ? summaryObj['amplitudeAtLeast0_3'] : 0;
    stage.gates.push({
      name: 'expression-coverage',
      status: above03 >= 35 ? 'passed' : 'failed',
      threshold: '>=35 channels with achievedAmplitude >= 0.3',
      observed: `${above03}`,
      detail: above03 >= 35 ? 'ok' : `Only ${above03} channels above threshold`,
    });
  }

  // Identity bake receipt: from S2
  const s2 = manifest.stages['identity-bake'];
  const receiptOutput = s2?.outputs.find(o => o.path.endsWith('runner-receipt.json'));
  if (receiptOutput) {
    stage.inputs.push({ ...receiptOutput });
  }

  // Variant report: check inventories
  const variantReportOutput = s2?.outputs.find(o => o.path.endsWith('variant-report.json'));
  if (variantReportOutput) {
    stage.inputs.push({ ...variantReportOutput });
    const reportRaw: Record<string, unknown> = JSON.parse(await readFile(variantReportOutput.path, 'utf8'));
    type VariantEntry = { strength: number; inventoryAfterMutation: { shapeKeys: number; expressionsWithMorphBind: number } };
    const variants: VariantEntry[] = Array.isArray(reportRaw['variants'])
      ? (reportRaw['variants'] as Record<string, unknown>[]).map(v => ({
          strength: typeof v['strength'] === 'number' ? v['strength'] : 0,
          inventoryAfterMutation: {
            shapeKeys: typeof (v['inventoryAfterMutation'] as Record<string, unknown> | undefined)?.['shapeKeys'] === 'number'
              ? (v['inventoryAfterMutation'] as Record<string, unknown>)['shapeKeys'] as number : 0,
            expressionsWithMorphBind: typeof (v['inventoryAfterMutation'] as Record<string, unknown> | undefined)?.['expressionsWithMorphBind'] === 'number'
              ? (v['inventoryAfterMutation'] as Record<string, unknown>)['expressionsWithMorphBind'] as number : 0,
          },
        }))
      : [];
    const allPreserved = variants.every(v =>
      v.inventoryAfterMutation.shapeKeys === 52 && v.inventoryAfterMutation.expressionsWithMorphBind === 52,
    );
    stage.gates.push({
      name: 'expression-invariant-52',
      status: allPreserved ? 'passed' : 'failed',
      threshold: 'all variants preserve exact 52/52 expression discovery',
      observed: variants.map(v =>
        `strength ${v.strength}: ${v.inventoryAfterMutation.shapeKeys}/${v.inventoryAfterMutation.expressionsWithMorphBind}`,
      ).join('; '),
      detail: allPreserved ? 'ok' : 'One or more variants lost canonical expressions during direct GLB mutation',
    });
  }

  // The staged VRM is a direct S3 input: changing its content invalidates the
  // coverage-gates resume record and re-runs both runtime gates.
  const stagedVrm = s2?.outputs.find(output => output.path.endsWith('.vrm'));
  if (!stagedVrm) throw new Error('Identity-bake stage has no staged output VRM');
  stage.inputs.push(await hashFile(stagedVrm.path));
  stage.gates.push(...await runtimeGateResults(stagedVrm.path));

  // Write gate results as output
  const gateResultsPath = resolve(pipelineDir, 'stages/coverage-gates/gate-results.json');
  await mkdir(resolve(pipelineDir, 'stages/coverage-gates'), { recursive: true });
  await Bun.write(gateResultsPath, `${JSON.stringify(stage.gates, null, 2)}\n`);
  stage.outputs.push(await hashFile(gateResultsPath));

  await log(`coverage gates evaluated: ${stage.gates.filter(g => g.status === 'passed').length} passed / ${stage.gates.filter(g => g.status === 'pending').length} pending / ${stage.gates.length} total`);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const options = parseArgs(Bun.argv.slice(2));
const pipelineDir = resolve(ROOT, 'data/avatar-models', options.assetId, 'pipeline');
const manifestPath = resolve(pipelineDir, 'manifest.json');
const logsDir = resolve(pipelineDir, 'logs');
await mkdir(logsDir, { recursive: true });
await mkdir(resolve(pipelineDir, 'stages'), { recursive: true });

// Build provenance from inputs
const propsRaw: Record<string, unknown> = JSON.parse(await readFile(resolve(ROOT, options.proportions), 'utf8'));
const evidenceRaw = propsRaw['evidence'];
const evidence = typeof evidenceRaw === 'object' && evidenceRaw !== null
  ? evidenceRaw as Record<string, unknown>
  : undefined;
const provenance: Provenance = {
  baseModel: {
    slug: 'kizuna-ai-kamatte',
    source: 'https://kizunaai.com/download/kamatteaimodel/',
    license: 'KAMATTE private/non-commercial/no-redistribution',
    licenseNotes: resolve(ROOT, options.licenseNotes),
  },
  donor: {
    slug: 'hinzka-vroid-v110-female-perfectsync',
    source: 'https://hinzka.booth.pm/',
    license: 'VN3 License',
  },
  identityCorpus: evidence ? {
    reconstructionId: String(propsRaw['reconstructionId'] ?? ''),
    clipCount: typeof evidence['inlierClipCount'] === 'number' ? evidence['inlierClipCount'] : 0,
    frameCount: typeof evidence['selectedFrameCount'] === 'number' ? evidence['selectedFrameCount'] : 0,
  } : null,
};

// Resume or create manifest
let manifest: AvatarPipelineManifest;
try {
  manifest = await readManifest(manifestPath);
  process.stderr.write(`Resuming pipeline for ${manifest.assetId}\n`);
} catch {
  manifest = freshManifest(options.assetId, provenance);
  await atomicWriteManifest(manifestPath, manifest);
  process.stderr.write(`Created fresh manifest for ${options.assetId}\n`);
}

// Check prior stages before running each — abort if any predecessor failed
for (const stageName of STAGE_NAMES) {
  // Predecessors must be completed
  const stageIndex = STAGE_NAMES.indexOf(stageName);
  const predecessorFailed = STAGE_NAMES.slice(0, stageIndex).some(
    s => manifest.stages[s]?.status === 'failed',
  );
  if (predecessorFailed) {
    process.stderr.write(`Skipping ${stageName}: a predecessor stage has failed\n`);
    continue;
  }

  const logPath = resolve(logsDir, `${stageName}.log`);
  if (stageName === 'source-validation') {
    await runStage(manifest, manifestPath, stageName, logPath, (stage, log) => runS0(stage, log, options));
  } else if (stageName === 'face-rig-transfer') {
    await runStage(manifest, manifestPath, stageName, logPath, (stage, log) => runS1(stage, log, options, pipelineDir));
  } else if (stageName === 'identity-bake') {
    await runStage(manifest, manifestPath, stageName, logPath, (stage, log) => runS2(stage, log, options, pipelineDir, manifest));
  } else if (stageName === 'coverage-gates') {
    const stagedVrm = manifest.stages['identity-bake']?.outputs.find(output => output.path.endsWith('.vrm'));
    await runStage(
      manifest,
      manifestPath,
      stageName,
      logPath,
      (stage, log) => runS3(stage, log, pipelineDir, manifest),
      stagedVrm ? [stagedVrm.path] : null,
    );
  }
}

// Final verdict
manifest.finalVerdict = computeVerdict(manifest);

// Generate proof card
const proofCardPath = resolve(pipelineDir, 'output/proof-card.json');
await mkdir(resolve(pipelineDir, 'output'), { recursive: true });
const card = generateProofCard(manifest);
await writeProofCard(proofCardPath, card);
manifest.proofCard = proofCardPath;
await atomicWriteManifest(manifestPath, manifest);

process.stderr.write(`\nPipeline complete. Verdict: ${manifest.finalVerdict}\n`);
process.stderr.write(`Manifest: ${manifestPath}\n`);
process.stderr.write(`Proof card: ${proofCardPath}\n`);

if (manifest.finalVerdict === 'rejected') {
  process.exit(1);
}
