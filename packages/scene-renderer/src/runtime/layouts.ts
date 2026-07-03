import type { CloneLayout, CloneSpec, Vec3 } from "./spec";

export interface CloneTransform {
  index: number;
  position: Vec3;
  rotation: Vec3;
  scale: number;
}

export function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let mixed = state;
    mixed = Math.imul(mixed ^ (mixed >>> 15), mixed | 1);
    mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61);
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
  };
}

export function cloneTransforms(clone: CloneSpec | undefined): CloneTransform[] {
  const count = Math.max(1, Math.floor(clone?.count ?? 1));
  const layout = clone?.layout ?? "line";
  const spacing = clone?.spacing ?? 1.2;
  const radius = clone?.radius ?? Math.max(spacing, 1);
  const transforms: CloneTransform[] = [];
  const random = mulberry32(clone?.seed ?? 1);
  const columns = Math.max(1, Math.ceil(Math.sqrt(count)));
  const rows = Math.max(1, Math.ceil(count / columns));
  for (let index = 0; index < count; index += 1) {
    transforms.push(transformForIndex(index, count, layout, spacing, radius, columns, rows, random));
  }
  return transforms;
}

function transformForIndex(
  index: number,
  count: number,
  layout: CloneLayout,
  spacing: number,
  radius: number,
  columns: number,
  rows: number,
  random: () => number,
): CloneTransform {
  if (layout === "grid") {
    const column = index % columns;
    const row = Math.floor(index / columns);
    return {
      index,
      position: [(column - (columns - 1) / 2) * spacing, ((rows - 1) / 2 - row) * spacing, 0],
      rotation: [0, 0, 0],
      scale: 1,
    };
  }
  if (layout === "orbit") {
    const angle = (Math.PI * 2 * index) / Math.max(1, count);
    return { index, position: [Math.cos(angle) * radius, Math.sin(angle) * radius, 0], rotation: [0, 0, angle], scale: 1 };
  }
  if (layout === "spiral") {
    const progress = count <= 1 ? 0 : index / (count - 1);
    const angle = progress * Math.PI * 6;
    const distance = radius * progress;
    return { index, position: [Math.cos(angle) * distance, Math.sin(angle) * distance, (progress - 0.5) * spacing], rotation: [0, 0, angle], scale: 1 };
  }
  if (layout === "scatter") {
    return {
      index,
      position: [(random() * 2 - 1) * radius, (random() * 2 - 1) * radius, (random() * 2 - 1) * radius * 0.5],
      rotation: [0, 0, random() * Math.PI * 2],
      scale: 0.75 + random() * 0.5,
    };
  }
  return { index, position: [(index - (count - 1) / 2) * spacing, 0, 0], rotation: [0, 0, 0], scale: 1 };
}
