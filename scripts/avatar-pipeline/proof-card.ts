/**
 * Proof card generator — produces a machine-readable review artifact from
 * a completed avatar-pipeline-manifest-v1.
 */
import { writeFile } from 'node:fs/promises';
import type { AvatarPipelineManifest, GateResult } from './manifest.ts';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ProofCard = {
  readonly schemaVersion: 1;
  readonly assetId: string;
  readonly lane: 'production';
  readonly timestamp: string;
  readonly appearance: {
    readonly baseModelSlug: string;
    readonly donorSlug: string;
  };
  readonly faceRig: {
    readonly totalChannels: number;
    readonly channelsAbove0_3: number;
    readonly transferMetricsPath: string | null;
    readonly gates: readonly GateResult[];
  };
  readonly skinning: {
    readonly gates: readonly GateResult[];
  };
  readonly motionStress: {
    readonly gates: readonly GateResult[];
  };
  readonly catalogReview: {
    readonly gateSummary: readonly { readonly gate: string; readonly status: GateResult['status']; readonly observed: string }[];
    readonly verdict: 'accepted' | 'rejected' | 'pending';
  };
  readonly provenance: AvatarPipelineManifest['provenance'];
  readonly licenseSummary: {
    readonly base: string;
    readonly donor: string;
    readonly redistributionAllowed: false;
  };
};

// ---------------------------------------------------------------------------
// Generator
// ---------------------------------------------------------------------------

export function generateProofCard(manifest: AvatarPipelineManifest): ProofCard {
  const s1 = manifest.stages['face-rig-transfer'];
  const s3 = manifest.stages['coverage-gates'];

  // Extract face-rig gate data
  const faceRigGates = s1?.gates ?? [];
  const coverageGates = s3?.gates ?? [];

  // Find channel counts from gates
  const totalChannelsGate = faceRigGates.find(g => g.name === 'all-52-channels-present');
  const channelsAbove = coverageGates.find(g => g.name === 'expression-coverage');

  // Transfer metrics path from S1 outputs
  const metricsOutput = s1?.outputs.find(o => o.path.endsWith('transfer-metrics.json'));

  // Build gate summary across all stages
  const gateSummary: { gate: string; status: GateResult['status']; observed: string }[] = [];
  for (const name of Object.keys(manifest.stages)) {
    for (const gate of manifest.stages[name].gates) {
      gateSummary.push({ gate: gate.name, status: gate.status, observed: gate.observed });
    }
  }

  return {
    schemaVersion: 1,
    assetId: manifest.assetId,
    lane: 'production',
    timestamp: new Date().toISOString(),
    appearance: {
      baseModelSlug: manifest.provenance.baseModel.slug,
      donorSlug: manifest.provenance.donor.slug,
    },
    faceRig: {
      totalChannels: totalChannelsGate ? parseInt(totalChannelsGate.observed, 10) || 52 : 0,
      channelsAbove0_3: channelsAbove ? parseInt(channelsAbove.observed, 10) || 0 : 0,
      transferMetricsPath: metricsOutput?.path ?? null,
      gates: faceRigGates,
    },
    skinning: {
      gates: coverageGates.filter(g => g.name.startsWith('humanoid-')),
    },
    motionStress: {
      gates: coverageGates.filter(g => g.name.startsWith('motion-')),
    },
    catalogReview: {
      gateSummary,
      verdict: manifest.finalVerdict,
    },
    provenance: manifest.provenance,
    licenseSummary: {
      base: manifest.provenance.baseModel.license,
      donor: manifest.provenance.donor.license,
      redistributionAllowed: false,
    },
  };
}

export async function writeProofCard(outputPath: string, card: ProofCard): Promise<void> {
  await writeFile(outputPath, `${JSON.stringify(card, null, 2)}\n`);
}
