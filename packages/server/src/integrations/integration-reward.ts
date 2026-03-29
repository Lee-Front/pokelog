import type { IntegrationRewardRule, IntegrationRewardRules, UserData } from "../../../../shared/types.js";

interface RewardApplicationOptions {
  provider: keyof IntegrationRewardRules;
  eventKey: string;
  sourceId: string;
  timestamp: string;
  summary: string;
}

export function applyIntegrationReward(
  user: UserData,
  rules: IntegrationRewardRules,
  options: RewardApplicationOptions,
): { applied: boolean; reason?: string } {
  const providerRules = rules[options.provider];
  const rule = providerRules?.[options.eventKey];
  if (!rule) return { applied: false, reason: "missing_rule" };
  if (!rule.enabled) return { applied: false, reason: "disabled" };
  if (isBlockedByCooldown(user, rule, options)) return { applied: false, reason: "cooldown" };
  if (isBlockedByDailyMax(user, rule, options)) return { applied: false, reason: "daily_max" };

  user.points += rule.points;
  user.totalExp += rule.exp ?? 0;
  user.log.push({
    type: "integration_reward",
    provider: options.provider,
    eventKey: options.eventKey,
    sourceId: options.sourceId,
    summary: options.summary,
    points: rule.points,
    exp: rule.exp ?? 0,
    timestamp: options.timestamp,
  });
  if (user.log.length > 200) {
    user.log = user.log.slice(-200);
  }

  return { applied: true };
}

function isBlockedByCooldown(
  user: UserData,
  rule: IntegrationRewardRule,
  options: RewardApplicationOptions,
): boolean {
  if (!rule.cooldownMinutes || rule.cooldownMinutes <= 0) return false;
  const threshold = Date.parse(options.timestamp) - rule.cooldownMinutes * 60 * 1000;
  return user.log.some((entry) =>
    entry.type === "integration_reward" &&
    entry.provider === options.provider &&
    entry.eventKey === options.eventKey &&
    entry.sourceId === options.sourceId &&
    Date.parse(String(entry.timestamp)) >= threshold,
  );
}

function isBlockedByDailyMax(
  user: UserData,
  rule: IntegrationRewardRule,
  options: RewardApplicationOptions,
): boolean {
  if (!rule.dailyMax || rule.dailyMax <= 0) return false;
  const dayStart = new Date(options.timestamp);
  dayStart.setHours(0, 0, 0, 0);
  const count = user.log.filter((entry) =>
    entry.type === "integration_reward" &&
    entry.provider === options.provider &&
    entry.eventKey === options.eventKey &&
    Date.parse(String(entry.timestamp)) >= dayStart.getTime(),
  ).length;
  return count >= rule.dailyMax;
}
