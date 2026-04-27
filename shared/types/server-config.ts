// === Server config & sync state ===
export interface RepoConfig {
  url: string;
  branches: string[];
}

export interface ComboConfig {
  bytesPerMinute: number;
  multipliers: number[];
  maxMultiplier: number;
}

export interface EncounterConfig {
  baseChance: number;
  ceilingBytes: number;
  timeLimitHours: number;
}

export type VitaminStatKey = "hp" | "attack" | "defense" | "spAttack" | "spDefense" | "speed";
export type PpBoostKind = "increment" | "max";

export interface ShopItem {
  name: string;
  price: number;
  catchBonus?: number;
  healAmount?: number;
  guaranteedCatch?: boolean;
  /** If set, using this item boosts the target pokemon's given stat (vitamin). */
  vitaminStat?: VitaminStatKey;
  /** If set, using this item modifies a move's maxPp. */
  ppBoost?: PpBoostKind;
}

export interface IntegrationRewardRule {
  enabled: boolean;
  points: number;
  exp?: number;
  cooldownMinutes?: number;
  dailyMax?: number;
}

export interface IntegrationEventDefinition {
  key: string;
  label: string;
  description: string;
  recommended: boolean;
  experimental?: boolean;
}

export interface IntegrationRewardRules {
  git: Record<string, IntegrationRewardRule>;
  notion: Record<string, IntegrationRewardRule>;
  jira: Record<string, IntegrationRewardRule>;
  slack: Record<string, IntegrationRewardRule>;
}

export interface ServerMeta {
  serverId: string;
  serverName: string;
  displayName: string;
  apiVersion: string;
  featureFlags: Record<string, boolean>;
}

export interface ServerConfig {
  server: { port: number };
  meta: ServerMeta;
  polling: {
    intervalMinutes: number;
    repos: RepoConfig[];
  };
  rewards: {
    expPerByte: number;
    pointsPerByte: number;
    combo: ComboConfig;
    encounter: EncounterConfig;
    integrations: IntegrationRewardRules;
  };
  shop: {
    items: Record<string, ShopItem>;
  };
}

// === Sync state ===
export interface NotionSyncSnapshot {
  createdTime: string;
  lastEditedTime: string;
  archived: boolean;
  parentType: string;
  statusValue?: string;
}

export interface JiraSyncSnapshot {
  issueKey: string;
  statusName: string;
  statusCategory: string;
  assignee?: string;
  updated: string;
  commentCount: number;
  worklogCount: number;
}

export interface SlackSyncSnapshot {
  lastMessageTs: string;
}

export interface SyncState {
  repos: Record<string, Record<string, string>>;
  integrations?: {
    notion?: Record<string, Record<string, NotionSyncSnapshot>>;
    jira?: Record<string, Record<string, JiraSyncSnapshot>>;
    slack?: Record<string, SlackSyncSnapshot>;
  };
}
