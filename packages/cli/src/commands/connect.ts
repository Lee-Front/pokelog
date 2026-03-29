import { apiDelete, apiGet, apiPatch, apiPost } from "../api-client.js";
import { BLD, CYN, DIM, GRN, RED, R, YEL } from "../ui/colors.js";
import { inputPrompt, rawSelect, separator } from "../ui/prompts.js";

type Provider = "git" | "github" | "gitlab" | "notion" | "jira" | "slack";
type Status = "untested" | "testing" | "ok" | "error";

interface IntegrationBase {
  id: string;
  provider: Provider;
  label: string;
  status: Status;
  lastError?: string;
  failCount: number;
  addedAt: string;
  lastCheckedAt?: string;
}

interface GitIntegration extends IntegrationBase {
  provider: "git" | "github" | "gitlab";
  config: {
    repoUrl: string;
    authMode?: "public" | "token";
    token?: string;
  };
  emails?: string[];
}

interface NotionIntegration extends IntegrationBase {
  provider: "notion";
  config: {
    token: string;
  };
}

interface JiraIntegration extends IntegrationBase {
  provider: "jira";
  config: {
    baseUrl: string;
    email: string;
    apiToken: string;
    projectKey?: string;
  };
}

interface SlackIntegration extends IntegrationBase {
  provider: "slack";
  config: {
    botToken: string;
    teamId?: string;
    channelId?: string;
  };
}

type Integration = GitIntegration | NotionIntegration | JiraIntegration | SlackIntegration | IntegrationBase;
type MessageTone = "info" | "success" | "warn" | "error";

interface ScreenMessage {
  tone: MessageTone;
  text: string;
}

function clearScreen(): void {
  process.stdout.write("\x1b[2J\x1b[H");
}

function isGitIntegration(integration: Integration): integration is GitIntegration {
  return integration.provider === "git" || integration.provider === "github" || integration.provider === "gitlab";
}

function isNotionIntegration(integration: Integration): integration is NotionIntegration {
  return integration.provider === "notion" && "config" in integration;
}

function providerLabel(provider: Provider): string {
  switch (provider) {
    case "git":
      return "Git";
    case "github":
      return "GitHub";
    case "gitlab":
      return "GitLab";
    case "notion":
      return "Notion";
    case "jira":
      return "Jira";
    case "slack":
      return "Slack";
  }
}

function formatMessage(message: ScreenMessage): string {
  switch (message.tone) {
    case "success":
      return `${GRN}${message.text}${R}`;
    case "warn":
      return `${YEL}${message.text}${R}`;
    case "error":
      return `${RED}${message.text}${R}`;
    default:
      return `${CYN}${message.text}${R}`;
  }
}

function statusText(integration: Integration): string {
  switch (integration.status) {
    case "ok":
      return `${GRN}connected${R}`;
    case "error":
      return `${RED}error${integration.lastError ? ` (${integration.lastError})` : ""}${R}`;
    case "testing":
      return `${YEL}testing${R}`;
    default:
      return `${DIM}untested${R}`;
  }
}

function integrationSummary(integration: Integration): string {
  if (isGitIntegration(integration)) {
    if ((integration.emails ?? []).length === 0) return `${DIM}all commits${R}`;
    return integration.emails!.join(", ");
  }
  if (integration.provider === "notion") {
    return `${DIM}workspace token${R}`;
  }
  if (integration.provider === "jira" && "config" in integration) {
    return integration.config.projectKey
      ? `${integration.config.baseUrl} / ${integration.config.projectKey}`
      : integration.config.baseUrl;
  }
  if (integration.provider === "slack" && "config" in integration) {
    return integration.config.channelId || integration.config.teamId || `${DIM}workspace token${R}`;
  }
  return `${DIM}${providerLabel(integration.provider)}${R}`;
}

function extractPageCount(metadata: unknown): string {
  const record = (metadata as Record<string, unknown> | null) ?? null;
  if (!record || typeof record.pageCount !== "number") return "";
  return ` / pages ${record.pageCount}`;
}

function printConnectScreen(integrations: Integration[], message?: ScreenMessage): void {
  clearScreen();
  const counts = ["git", "notion", "jira", "slack"]
    .map((provider) => `${provider}:${integrations.filter((item) => item.provider === provider).length}`)
    .join("  ");

  console.log(`  ${BLD}Connect${R} ${DIM}integrations${R}`);
  console.log(`  ${DIM}${counts}${R}`);
  console.log(`  ${DIM}tip:${R} polling is 1 minute. Notion supports manual sync.`);
  if (message) {
    console.log();
    console.log(`  ${formatMessage(message)}`);
  }
  console.log();
}

async function getIntegrations(): Promise<{ integrations: Integration[]; message?: ScreenMessage }> {
  const res = await apiGet("/api/user/integrations");
  if (!res.ok) {
    return {
      integrations: [],
      message: { tone: "error", text: `연동 목록을 불러오지 못했습니다: ${String(res.data.error)}` },
    };
  }

  return {
    integrations: ((res.data.integrations as Integration[] | undefined) ?? []).filter((integration) =>
      ["git", "github", "gitlab", "notion", "jira", "slack"].includes(integration.provider),
    ),
  };
}

async function promptProvider(): Promise<Provider | null> {
  return rawSelect("추가할 provider를 선택하세요", [
    { name: "Git (public repo URL)", value: "git" },
    { name: "Notion", value: "notion" },
    { name: "Jira", value: "jira" },
    { name: "Slack", value: "slack" },
  ]);
}

async function addGitIntegration(): Promise<{ body?: Record<string, unknown>; message?: ScreenMessage }> {
  const repoUrl = (await inputPrompt("Repository URL:")).trim();
  if (!repoUrl) return {};

  const mode = await rawSelect("집계 방식을 선택하세요", [
    { name: "Track all commits", value: "all" },
    { name: "Track only specific author emails", value: "emails" },
  ]);
  if (!mode) return {};

  const emails: string[] = [];
  if (mode === "emails") {
    console.log();
    console.log(`  ${DIM}이메일을 한 줄씩 입력하세요. 빈 입력이면 종료합니다.${R}`);
    while (true) {
      const email = (await inputPrompt("Author email:")).trim();
      if (!email) break;
      emails.push(email);
    }
    if (emails.length === 0) {
      return { message: { tone: "warn", text: "이메일 필터 모드에서는 최소 1개의 이메일이 필요합니다." } };
    }
  } else {
    console.log();
    console.log(`  ${YEL}이 설정은 해당 저장소의 모든 작성자 커밋을 내 활동으로 집계합니다.${R}`);
  }

  const defaultLabel = repoUrl.replace(/^https?:\/\//, "");
  const label = (await inputPrompt(`표시 이름 (${defaultLabel}):`)).trim();
  return {
    body: {
      provider: "git",
      label: label || defaultLabel,
      config: { repoUrl, authMode: "public" },
      emails,
    },
  };
}

async function addNotionIntegration(): Promise<{ body?: Record<string, unknown> }> {
  const token = (await inputPrompt("Notion Integration Token:")).trim();
  if (!token) return {};
  const label = (await inputPrompt("표시 이름 (예: Personal Notion):")).trim();
  return {
    body: {
      provider: "notion",
      label: label || "Notion",
      config: { token },
    },
  };
}

async function addJiraIntegration(): Promise<{ body?: Record<string, unknown> }> {
  const baseUrl = (await inputPrompt("Jira base URL:")).trim();
  if (!baseUrl) return {};
  const email = (await inputPrompt("Jira email:")).trim();
  if (!email) return {};
  const apiToken = (await inputPrompt("Jira API token:")).trim();
  if (!apiToken) return {};
  const projectKey = (await inputPrompt("Project key (optional):")).trim();
  const label = (await inputPrompt(`표시 이름 (${projectKey || baseUrl}):`)).trim();
  return {
    body: {
      provider: "jira",
      label: label || projectKey || baseUrl,
      config: {
        baseUrl,
        email,
        apiToken,
        projectKey: projectKey || undefined,
      },
    },
  };
}

async function addSlackIntegration(): Promise<{ body?: Record<string, unknown> }> {
  const botToken = (await inputPrompt("Slack Bot Token:")).trim();
  if (!botToken) return {};
  const teamId = (await inputPrompt("Team ID (optional):")).trim();
  const channelId = (await inputPrompt("Channel ID (optional):")).trim();
  const label = (await inputPrompt(`표시 이름 (${teamId || channelId || "Slack"}):`)).trim();
  return {
    body: {
      provider: "slack",
      label: label || teamId || channelId || "Slack",
      config: {
        botToken,
        teamId: teamId || undefined,
        channelId: channelId || undefined,
      },
    },
  };
}

async function addIntegration(): Promise<ScreenMessage | null> {
  clearScreen();
  console.log(`  ${BLD}새 연동 추가${R}`);
  console.log(`  ${DIM}Esc를 누르면 언제든 취소됩니다.${R}`);
  console.log();

  const provider = await promptProvider();
  if (!provider) return null;

  let payload: { body?: Record<string, unknown>; message?: ScreenMessage } = {};
  if (provider === "git") payload = await addGitIntegration();
  if (provider === "notion") payload = await addNotionIntegration();
  if (provider === "jira") payload = await addJiraIntegration();
  if (provider === "slack") payload = await addSlackIntegration();
  if (payload.message) return payload.message;
  if (!payload.body) return null;

  const createRes = await apiPost("/api/user/integrations", payload.body);
  if (!createRes.ok) {
    return { tone: "error", text: `연동을 추가하지 못했습니다: ${String(createRes.data.error)}` };
  }

  const created = createRes.data.integration as Integration;
  const testRes = await apiPost(`/api/user/integrations/${created.id}/test`);
  if (!testRes.ok) {
    return { tone: "warn", text: `연동은 저장됐지만 연결 테스트는 실패했습니다: ${String(testRes.data.error)}` };
  }

  const warning = testRes.data.warning ? ` / ${String(testRes.data.warning)}` : "";
  const pageCount = extractPageCount(testRes.data.metadata);
  return { tone: "success", text: `${providerLabel(created.provider)} 연동이 추가됐습니다: ${created.label}${pageCount}${warning}` };
}

async function updateGitEmails(integration: GitIntegration): Promise<ScreenMessage | null> {
  clearScreen();
  console.log(`  ${BLD}${integration.label} 이메일 필터 수정${R}`);
  console.log(`  ${DIM}이메일을 한 줄씩 입력하세요. 빈 입력이면 종료합니다.${R}`);
  console.log();

  const emails: string[] = [];
  while (true) {
    const email = (await inputPrompt("Author email:")).trim();
    if (!email) break;
    emails.push(email);
  }

  const patchRes = await apiPatch(`/api/user/integrations/${integration.id}`, { emails });
  if (!patchRes.ok) {
    return { tone: "error", text: `이메일 필터를 수정하지 못했습니다: ${String(patchRes.data.error)}` };
  }

  if (emails.length === 0) {
    return { tone: "success", text: `이메일 필터를 비웠습니다: ${integration.label} / all commits` };
  }
  return { tone: "success", text: `이메일 필터를 저장했습니다: ${emails.join(", ")}` };
}

async function syncNotionIntegration(integration: NotionIntegration): Promise<ScreenMessage> {
  const syncRes = await apiPost(`/api/user/integrations/${integration.id}/sync`);
  if (!syncRes.ok) {
    return { tone: "error", text: `수동 동기화가 실패했습니다: ${String(syncRes.data.error)}` };
  }

  const result = (syncRes.data.result ?? {}) as Record<string, unknown>;
  const status = result.firstSync === true ? "baseline created" : "diff checked";
  const snapshotCount = typeof result.snapshotCount === "number" ? String(result.snapshotCount) : "-";
  const detected = typeof result.detectedEvents === "number" ? String(result.detectedEvents) : "-";
  const applied = typeof result.appliedEvents === "number" ? String(result.appliedEvents) : "-";
  const tone: MessageTone = Number(applied) > 0 ? "success" : "warn";
  return {
    tone,
    text: `Notion sync | ${integration.label} | status ${status} | pages ${snapshotCount} | detected ${detected} | applied ${applied}`,
  };
}

async function editIntegration(integration: Integration): Promise<ScreenMessage | null> {
  clearScreen();
  console.log(`  ${BLD}${integration.label}${R} ${DIM}[${providerLabel(integration.provider)}]${R}`);
  console.log(`  ${DIM}status:${R} ${statusText(integration)}`);
  console.log(`  ${DIM}summary:${R} ${integrationSummary(integration)}`);
  console.log();

  const choices: Array<{ name: string; value: string }> = [
    { name: "연결 테스트", value: "test" },
    { name: "삭제", value: "delete" },
  ];
  if (isNotionIntegration(integration)) {
    choices.unshift({ name: "지금 동기화", value: "sync" });
  }
  if (isGitIntegration(integration)) {
    choices.unshift({ name: "이메일 필터 수정", value: "emails" });
  }
  choices.push({ name: "닫기", value: "close" });

  const mode = await rawSelect("작업을 선택하세요", choices);
  if (!mode || mode === "close") return null;

  if (mode === "emails" && isGitIntegration(integration)) {
    return updateGitEmails(integration);
  }

  if (mode === "sync" && isNotionIntegration(integration)) {
    return syncNotionIntegration(integration);
  }

  if (mode === "test") {
    const testRes = await apiPost(`/api/user/integrations/${integration.id}/test`);
    if (!testRes.ok) {
      return { tone: "error", text: `연결 테스트가 실패했습니다: ${String(testRes.data.error)}` };
    }
    const warning = testRes.data.warning ? ` / ${String(testRes.data.warning)}` : "";
    const pageCount = extractPageCount(testRes.data.metadata);
    return { tone: "success", text: `연결 테스트 성공: ${integration.label}${pageCount}${warning}` };
  }

  const confirm = await rawSelect(`${integration.label} 연동을 삭제할까요?`, [
    { name: "삭제", value: "delete" },
    { name: "취소", value: "cancel" },
  ]);
  if (confirm !== "delete") return null;

  const deleteRes = await apiDelete(`/api/user/integrations/${integration.id}`);
  if (!deleteRes.ok) {
    return { tone: "error", text: `연동을 삭제하지 못했습니다: ${String(deleteRes.data.error)}` };
  }
  return { tone: "success", text: `연동을 삭제했습니다: ${integration.label}` };
}

export async function connectCommand() {
  let flashMessage: ScreenMessage | undefined;

  while (true) {
    const { integrations, message } = await getIntegrations();
    printConnectScreen(integrations, flashMessage ?? message);

    const items: Array<{ name: string; value: string } | { separator: string }> = [
      { name: "[+ 새 연동 추가]", value: "__add__" },
      separator(" "),
    ];

    for (const integration of integrations) {
      items.push({
        name: `[${providerLabel(integration.provider)}] ${integration.label}  ${statusText(integration)}  ${integrationSummary(integration)}`,
        value: integration.id,
      });
    }

    items.push(separator(" "));
    items.push({ name: "닫기", value: "__close__" });

    const selected = await rawSelect("작업을 선택하세요. Enter 선택 / Esc 닫기", items, {
      pageSize: 16,
    });
    if (!selected || selected === "__close__") {
      clearScreen();
      return;
    }

    flashMessage = undefined;

    if (selected === "__add__") {
      flashMessage = (await addIntegration()) ?? undefined;
      continue;
    }

    const target = integrations.find((integration) => integration.id === selected);
    if (!target) {
      flashMessage = { tone: "error", text: "선택한 연동을 찾지 못했습니다. 화면을 새로고침합니다." };
      continue;
    }

    flashMessage = (await editIntegration(target)) ?? undefined;
  }
}
