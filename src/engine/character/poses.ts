import type { VRM, VRMHumanBoneName } from '@pixiv/three-vrm';

/**
 * Pose di esempio espresse come rotazioni (Eulero XYZ, radianti) delle ossa
 * "normalizzate" di VRM: in posa di riposo (T-pose) tutte le ossa hanno assi
 * allineati al mondo, con il personaggio rivolto verso +Z.
 *
 *   - braccio sinistro lungo +X: rotazione Z negativa → lo abbassa
 *   - braccio destro   lungo −X: rotazione Z positiva → lo abbassa
 *   - avambracci: rotazione Y piega il gomito in avanti (sinistro −, destro +)
 *
 * È un primo passo: più avanti le pose si creeranno con l'IK trascinando mani e piedi.
 */
type Rotation = [x: number, y: number, z: number];
export type Pose = Partial<Record<VRMHumanBoneName, Rotation>>;

export const POSES = {
  tpose: { label: 'T-pose', bones: {} },
  relaxed: {
    label: 'Rilassata',
    bones: {
      spine: [0.03, 0, 0],
      neck: [0.05, 0, 0.03],
      head: [0.02, -0.12, 0.06],
      leftUpperArm: [0, 0, -1.2],
      rightUpperArm: [0, 0, 1.2],
      leftLowerArm: [0, -0.25, 0],
      rightLowerArm: [0, 0.25, 0],
      leftHand: [0, 0, -0.1],
      rightHand: [0, 0, 0.1],
      leftUpperLeg: [0, 0, 0.04],
      rightUpperLeg: [-0.05, 0, -0.06],
      rightLowerLeg: [0.12, 0, 0],
    },
  },
  wave: {
    label: 'Saluto',
    bones: {
      spine: [0, 0, -0.04],
      neck: [0, 0, 0.04],
      head: [0.05, 0.15, 0.12],
      leftUpperArm: [0, 0, -1.25],
      leftLowerArm: [0, -0.2, 0],
      rightUpperArm: [0, 0.3, 0.25],
      rightLowerArm: [0, 0, -1.9],
      rightHand: [0, 0, -0.2],
    },
  },
  hand: {
    label: 'Mano sul petto',
    bones: {
      neck: [0.1, 0, 0],
      head: [0.15, 0.2, -0.12],
      leftUpperArm: [0, -0.6, -1.1],
      leftLowerArm: [0, -2.0, 0],
      rightUpperArm: [0, 0, 1.2],
      rightLowerArm: [0, 0.3, 0],
    },
  },
} satisfies Record<string, { label: string; bones: Pose }>;

export type PoseName = keyof typeof POSES;

export function applyPose(vrm: VRM, pose: Pose): void {
  vrm.humanoid.resetNormalizedPose();
  // Nei modelli VRM 0.x le ossa normalizzate sono ruotate di 180° attorno a Y
  // rispetto al VRM 1.0: le rotazioni attorno a X e Z vanno invertite.
  const flip = vrm.meta.metaVersion === '0' ? -1 : 1;
  for (const [bone, rot] of Object.entries(pose) as [VRMHumanBoneName, Rotation][]) {
    const node = vrm.humanoid.getNormalizedBoneNode(bone);
    node?.rotation.set(rot[0] * flip, rot[1], rot[2] * flip);
  }
}

export const EXPRESSIONS = {
  neutral: 'Neutra',
  happy: 'Felice',
  angry: 'Arrabbiata',
  sad: 'Triste',
  relaxed: 'Serena',
} as const;

export type ExpressionName = keyof typeof EXPRESSIONS;

export function applyExpression(vrm: VRM, name: ExpressionName): void {
  const em = vrm.expressionManager;
  if (!em) return;
  for (const key of Object.keys(EXPRESSIONS)) em.setValue(key, 0);
  if (name !== 'neutral') em.setValue(name, 1);
}
