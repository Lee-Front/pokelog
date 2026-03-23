export interface RewardConfig {
  expPerByte: number;
  pointsPerByte: number;
}

export function calculateReward(
  bytes: number,
  comboMultiplier: number,
  config: RewardConfig
): { exp: number; points: number } {
  return {
    exp: Math.floor(bytes * config.expPerByte * comboMultiplier),
    points: Math.floor(bytes * config.pointsPerByte * comboMultiplier),
  };
}
