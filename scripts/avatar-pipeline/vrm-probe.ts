import { readFile } from 'node:fs/promises';
import { VRMLoaderPlugin, type VRM } from '@pixiv/three-vrm';
import { VRMHumanBoneName, VRMRequiredHumanBoneName, type VRMHumanoid } from '@pixiv/three-vrm-core';
import { Euler, Matrix4, Object3D, Quaternion, Vector3 } from 'three';
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { GateResult } from './manifest.ts';
import { compareVrmBodyRig, compareVrmBodyRigBuffers, type VrmBodyRigDifferentialOptions, type VrmBodyRigDifferentialResult } from './vrm-body-differential.ts';
import { parseGlbJsonChunk, readManifest } from './manifest.ts';

const REQUIRED_BONES = Object.values(VRMRequiredHumanBoneName);
const MAJOR_SYMMETRIC_PAIRS = [
  [VRMHumanBoneName.LeftUpperArm, VRMHumanBoneName.RightUpperArm],
  [VRMHumanBoneName.LeftLowerArm, VRMHumanBoneName.RightLowerArm],
  [VRMHumanBoneName.LeftHand, VRMHumanBoneName.RightHand],
  [VRMHumanBoneName.LeftUpperLeg, VRMHumanBoneName.RightUpperLeg],
  [VRMHumanBoneName.LeftLowerLeg, VRMHumanBoneName.RightLowerLeg],
  [VRMHumanBoneName.LeftFoot, VRMHumanBoneName.RightFoot],
] as const;

export type RuntimeProbeResult = {
  readonly humanoidBonesComplete: {
    readonly passed: boolean;
    readonly observed: string;
    readonly detail: string;
  };
  readonly motionStressPoses: {
    readonly passed: boolean;
    readonly observed: string;
    readonly detail: string;
  };
};

type JsonObject = Record<string, unknown>;
type PoseRotation = readonly [bone: string, x: number, y: number, z: number];

const STRESS_POSES: readonly { readonly name: string; readonly rotations: readonly PoseRotation[] }[] = [
  {
    name: 'arms-raised',
    rotations: [
      [VRMHumanBoneName.LeftUpperArm, 0, 0, 1.25],
      [VRMHumanBoneName.RightUpperArm, 0, 0, -1.25],
    ],
  },
  {
    name: 'arms-crossed',
    rotations: [
      [VRMHumanBoneName.LeftUpperArm, 0.2, 0.75, 0.55],
      [VRMHumanBoneName.RightUpperArm, 0.2, -0.75, -0.55],
      [VRMHumanBoneName.LeftLowerArm, 0, 1.45, 0],
      [VRMHumanBoneName.RightLowerArm, 0, -1.45, 0],
    ],
  },
  {
    name: 'spine-twist',
    rotations: [
      [VRMHumanBoneName.Spine, 0, 0.7, 0],
      [VRMHumanBoneName.Head, 0, -0.35, 0],
    ],
  },
  {
    name: 'head-yaw-left',
    rotations: [[VRMHumanBoneName.Head, 0, 1.2, 0]],
  },
  {
    name: 'head-yaw-right',
    rotations: [[VRMHumanBoneName.Head, 0, -1.2, 0]],
  },
  {
    name: 'hip-knee-flexion',
    rotations: [
      [VRMHumanBoneName.Hips, 0.25, 0, 0],
      [VRMHumanBoneName.LeftUpperLeg, -1.0, 0, 0],
      [VRMHumanBoneName.RightUpperLeg, -1.0, 0, 0],
      [VRMHumanBoneName.LeftLowerLeg, 1.55, 0, 0],
      [VRMHumanBoneName.RightLowerLeg, 1.55, 0, 0],
    ],
  },
];

function asObject(value: unknown): JsonObject | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as JsonObject : undefined;
}

function mappedVrm1Bones(gltf: JsonObject): { readonly mapped: Set<string>; readonly invalidNodes: Set<string> } {
  const extension = asObject(asObject(gltf.extensions)?.VRMC_vrm);
  const humanBones = asObject(asObject(extension?.humanoid)?.humanBones);
  const nodes = Array.isArray(gltf.nodes) ? gltf.nodes : [];
  const mapped = new Set<string>();
  const invalidNodes = new Set<string>();
  for (const name of REQUIRED_BONES) {
    const node = asObject(humanBones?.[name])?.node;
    if (Number.isInteger(node) && typeof node === 'number' && node >= 0 && node < nodes.length && asObject(nodes[node])) {
      mapped.add(name);
    } else if (node !== undefined) {
      invalidNodes.add(name);
    }
  }
  return { mapped, invalidNodes };
}

function finiteTransform(node: Object3D): boolean {
  const values = [
    ...node.position.toArray(),
    ...node.quaternion.toArray(),
    ...node.scale.toArray(),
    ...node.matrix.elements,
    ...node.matrixWorld.elements,
  ];
  return values.every(Number.isFinite);
}

function installLoaderShims(): void {
  if (typeof globalThis.ProgressEvent === 'undefined') {
    class BunProgressEvent extends Event {
      readonly lengthComputable: boolean;
      readonly loaded: number;
      readonly total: number;

      constructor(type: string, init: ProgressEventInit = {}) {
        super(type);
        this.lengthComputable = init.lengthComputable ?? false;
        this.loaded = init.loaded ?? 0;
        this.total = init.total ?? 0;
      }
    }
    Object.defineProperty(globalThis, 'ProgressEvent', { value: BunProgressEvent, configurable: true });
  }

  // Bun has no image decoder in this runtime. The probe never inspects
  // materials, so give GLTFLoader a decode-free 1x1 image object rather than
  // failing irrelevant embedded texture loads.
  if (typeof globalThis.createImageBitmap === 'undefined') {
    Object.defineProperty(globalThis, 'createImageBitmap', {
      configurable: true,
      value: async () => ({ width: 1, height: 1, close() {} }),
    });
  }
}

async function loadHumanoid(buffer: Buffer): Promise<{ readonly scene: Object3D; readonly humanoid: VRMHumanoid }> {
  installLoaderShims();
  const loader = new GLTFLoader();
  loader.register(parser => new VRMLoaderPlugin(parser, { autoUpdateHumanBones: false }));
  const bytes = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer;
  const gltf = await new Promise<GLTF>((resolve, reject) => loader.parse(bytes, '', resolve, reject));
  const humanoid = (gltf.userData.vrm as VRM | null | undefined)?.humanoid;
  if (!humanoid) throw new Error('VRM extension did not produce a runtime humanoid');
  return { scene: gltf.scene, humanoid };
}

function runtimeBones(humanoid: VRMHumanoid): Map<string, Object3D> {
  const result = new Map<string, Object3D>();
  for (const name of Object.values(VRMHumanBoneName)) {
    const node = humanoid.getRawBoneNode(name);
    if (node) result.set(name, node);
  }
  return result;
}

function matrixChanged(before: Matrix4, after: Matrix4): boolean {
  return before.elements.some((value, index) => Math.abs(value - after.elements[index]!) > 1e-7);
}

function stressProbe(scene: Object3D, bones: ReadonlyMap<string, Object3D>): RuntimeProbeResult['motionStressPoses'] {
  scene.updateMatrixWorld(true);
  const restMatrices = new Map<string, Matrix4>();
  const restQuaternions = new Map<string, Quaternion>();
  const restPositions = new Map<string, Vector3>();
  const center = new Vector3();

  for (const [name, node] of bones) {
    restMatrices.set(name, node.matrixWorld.clone());
    restQuaternions.set(name, node.quaternion.clone());
    const position = node.getWorldPosition(new Vector3());
    restPositions.set(name, position);
    center.add(position);
  }
  center.multiplyScalar(1 / Math.max(restPositions.size, 1));
  let restRadius = 0;
  for (const position of restPositions.values()) restRadius = Math.max(restRadius, position.distanceTo(center));

  const violations = new Set<string>();
  if (!Number.isFinite(restRadius) || restRadius <= 1e-6) violations.add('degenerate-rest-bounds');
  const movedBones = new Set<string>();
  let maxDisplacement = 0;

  try {
    for (const pose of STRESS_POSES) {
      for (const [name, node] of bones) node.quaternion.copy(restQuaternions.get(name)!);
      for (const [name, x, y, z] of pose.rotations) {
        const node = bones.get(name);
        if (!node) {
          violations.add(`${pose.name}:missing-${name}`);
          continue;
        }
        node.quaternion.multiply(new Quaternion().setFromEuler(new Euler(x, y, z, 'XYZ')));
      }
      scene.updateMatrixWorld(true);

      for (const [name, node] of bones) {
        if (!finiteTransform(node)) violations.add(`${pose.name}:non-finite-${name}`);
        const position = node.getWorldPosition(new Vector3());
        const restPosition = restPositions.get(name)!;
        maxDisplacement = Math.max(maxDisplacement, position.distanceTo(restPosition));
        if (restRadius > 1e-6 && position.distanceTo(center) > 10 * restRadius) {
          violations.add(`${pose.name}:out-of-bounds-${name}`);
        }
        if (matrixChanged(restMatrices.get(name)!, node.matrixWorld)) movedBones.add(name);
      }
    }
  } finally {
    for (const [name, node] of bones) node.quaternion.copy(restQuaternions.get(name)!);
    scene.updateMatrixWorld(true);
  }

  for (const [left, right] of MAJOR_SYMMETRIC_PAIRS) {
    if (!bones.has(left) || !bones.has(right)) violations.add(`missing-symmetric-pair-${left}/${right}`);
    else {
      if (!movedBones.has(left)) violations.add(`unmoved-${left}`);
      if (!movedBones.has(right)) violations.add(`unmoved-${right}`);
    }
  }

  const violationList = [...violations].sort();
  return {
    passed: violationList.length === 0,
    observed: `poses=${STRESS_POSES.map(pose => pose.name).join(',')}; maxDisplacement=${maxDisplacement.toFixed(6)}; violations=${violationList.length === 0 ? 'none' : violationList.join(',')}`,
    detail: violationList.length === 0
      ? `All ${STRESS_POSES.length} deterministic poses stayed finite, bounded, and bilaterally active`
      : violationList.join('; '),
  };
}

export async function probeVrm(vrmPath: string): Promise<RuntimeProbeResult> {
  const buffer = Buffer.from(await readFile(vrmPath));
  const gltfJson = parseGlbJsonChunk(buffer);
  const { mapped, invalidNodes } = mappedVrm1Bones(gltfJson);
  const missing = REQUIRED_BONES.filter(name => !mapped.has(name));
  const preflightProblems = [...new Set([...missing, ...invalidNodes])].sort();
  if (preflightProblems.length > 0) {
    return {
      humanoidBonesComplete: {
        passed: false,
        observed: `resolved=${REQUIRED_BONES.length - preflightProblems.length}/${REQUIRED_BONES.length}; missing=${preflightProblems.join(',')}`,
        detail: 'Required VRM 1.0 humanoid mappings are missing or reference invalid glTF nodes',
      },
      motionStressPoses: {
        passed: false,
        observed: 'poses=0; maxDisplacement=0.000000; violations=humanoid-prerequisite-failed',
        detail: 'Motion stress probe cannot run without all required humanoid bones',
      },
    };
  }

  const { scene, humanoid } = await loadHumanoid(buffer);
  scene.updateMatrixWorld(true);
  const bones = runtimeBones(humanoid);
  const unresolved = REQUIRED_BONES.filter(name => !bones.has(name));
  const invalidRest = REQUIRED_BONES.filter(name => {
    const node = bones.get(name);
    return node !== undefined && !finiteTransform(node);
  });
  const boneProblems = [...new Set([...unresolved, ...invalidRest])].sort();
  const bonesPassed = boneProblems.length === 0;

  return {
    humanoidBonesComplete: {
      passed: bonesPassed,
      observed: `resolved=${REQUIRED_BONES.length - boneProblems.length}/${REQUIRED_BONES.length}; missing=${boneProblems.length === 0 ? 'none' : boneProblems.join(',')}`,
      detail: bonesPassed ? 'All required bones resolve to runtime nodes with finite rest transforms' : 'Missing runtime nodes or non-finite rest transforms',
    },
    motionStressPoses: bonesPassed
      ? stressProbe(scene, bones)
      : {
          passed: false,
          observed: 'poses=0; maxDisplacement=0.000000; violations=humanoid-prerequisite-failed',
          detail: 'Motion stress probe cannot run without all required humanoid bones',
        },
  };
}

function failedProbeGates(error: unknown): readonly [GateResult, GateResult] {
  const message = error instanceof Error ? error.message : String(error);
  return [
    {
      name: 'humanoid-bones-complete',
      status: 'failed',
      threshold: 'all required VRM 1.0 humanoid bones mapped to finite runtime nodes',
      observed: `probe error: ${message}`,
      detail: message,
    },
    {
      name: 'motion-stress-poses',
      status: 'failed',
      threshold: 'deterministic major-bone poses stay finite, bounded, and bilaterally active',
      observed: `probe error: ${message}`,
      detail: message,
    },
  ];
}

export async function runtimeGateResults(
  vrmPath: string,
  probe: (path: string) => Promise<RuntimeProbeResult> = probeVrm,
): Promise<readonly [GateResult, GateResult]> {
  try {
    const result = await probe(vrmPath);
    return [
      {
        name: 'humanoid-bones-complete',
        status: result.humanoidBonesComplete.passed ? 'passed' : 'failed',
        threshold: 'all required VRM 1.0 humanoid bones mapped to finite runtime nodes',
        observed: result.humanoidBonesComplete.observed,
        detail: result.humanoidBonesComplete.detail,
      },
      {
        name: 'motion-stress-poses',
        status: result.motionStressPoses.passed ? 'passed' : 'failed',
        threshold: 'deterministic major-bone poses stay finite, bounded, and bilaterally active',
        observed: result.motionStressPoses.observed,
        detail: result.motionStressPoses.detail,
      },
    ];
  } catch (error) {
    return failedProbeGates(error);
  }
}

export async function probeManifestVrm(manifestPath: string): Promise<RuntimeProbeResult> {
  const manifest = await readManifest(manifestPath);
  const vrm = manifest.stages['identity-bake']?.outputs.find(output => output.path.endsWith('.vrm'));
  if (!vrm) throw new Error(`No staged output VRM recorded in ${manifestPath}`);
  return probeVrm(vrm.path);
}
export { compareVrmBodyRig, compareVrmBodyRigBuffers };
export type { VrmBodyRigDifferentialOptions, VrmBodyRigDifferentialResult };

if (import.meta.main) {
  const args = process.argv.slice(2);
  if (args[0] !== '--compare' || args.length !== 3) {
    console.error('Usage: bun scripts/avatar-pipeline/vrm-probe.ts --compare <base.vrm> <claimed-face-only.vrm>');
    process.exitCode = 2;
  } else {
    const result = await compareVrmBodyRig(args[1]!, args[2]!);
    process.stdout.write(`${JSON.stringify(result)}\n`);
    process.exitCode = result.passed ? 0 : 1;
  }
}
