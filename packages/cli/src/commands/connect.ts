import { apiDelete, apiGet, apiPatch, apiPost } from "../api-client.js";
import { BLD, CYN, DIM, GRN, RED, R, YEL } from "../ui/colors.js";
import { inputPrompt, separator } from "../ui/prompts.js";
import { clearScreen, selectFrame } from "../ui/screen.js";

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
  console.log(`  ${DIM}tip:${R} polling is 1 minute. Notion/Jira/Slack support manual sync.`);
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
      message: { tone: "error", text: `鞐半彊 氇╇鞚?攵堧煬鞓れ 氇豁枅鞀惦媹雼? ${String(res.data.error)}` },
    };
  }

  return {
    integrations: ((res.data.integrations as Integration[] | undefined) ?? []).filter((integration) =>
      ["git", "github", "gitlab", "notion", "jira", "slack"].includes(integration.provider),
    ),
  };
}

async function promptProvider(): Promise<Provider | null> {
  return selectFrame("Choose a provider", [
    { name: "Git", value: "git" },
    { name: "Notion", value: "notion" },
    { name: "Jira", value: "jira" },
    { name: "Slack", value: "slack" },
  ]);
}

async function addGitIntegration(): Promise<{ body?: Record<string, unknown>; message?: ScreenMessage }> {
  const repoUrl = (await inputPrompt("Repository URL:")).trim();
  if (!repoUrl) return {};

  const authMode = await selectFrame("Choose an authentication mode", [
    { name: "Public (韱犿伆 鞐嗢澊)", value: "public" },
    { name: "Private (Personal Access Token)", value: "token" },
  ]);
  if (!authMode) return {};

  let token: string | undefined;
  if (authMode === "token") {
    token = (await inputPrompt("Personal Access Token:")).trim();
    if (!token) return {};
  }

  const mode = await selectFrame("Choose a tracking mode", [
    { name: "Track all commits", value: "all" },
    { name: "Track only specific author emails", value: "emails" },
  ]);
  if (!mode) return {};

  const emails: string[] = [];
  if (mode === "emails") {
    console.log();
    console.log(`  ${DIM}鞚措鞚检潉 頃?欷勳敥 鞛呺牓頃橃劯鞖? 牍?鞛呺牓鞚措┐ 膦呺頃╇媹雼?${R}`);
    while (true) {
      const email = (await inputPrompt("Author email:")).trim();
      if (!email) break;
      emails.push(email);
    }
    if (emails.length === 0) {
      return { message: { tone: "warn", text: "鞚措鞚?頃勴劙 氇摐鞐愳劀電?斓滌唽 1臧滌潣 鞚措鞚检澊 頃勳殧頃╇媹雼?" } };
    }
  } else {
    console.log();
    console.log(`  ${YEL}鞚?靹れ爼鞚€ 頃措嫻 鞝€鞛レ唽鞚?氇摖 鞛戩劚鞛?旎る皨鞚?雮?頇滊彊鞙茧 歆戧硠頃╇媹雼?${R}`);
  }

  const defaultLabel = repoUrl.replace(/^https?:\/\//, "");
  const label = (await inputPrompt(`響滌嫓 鞚措 (${defaultLabel}):`)).trim();
  return {
    body: {
      provider: "git",
      label: label || defaultLabel,
      config: { repoUrl, authMode, token },
      emails,
    },
  };
}

async function addNotionIntegration(): Promise<{ body?: Record<string, unknown> }> {
  console.log(`  ${YEL}Notion鞚€ Integration鞚?鞐瓣舶霅?韼橃澊歆€毵?於旍爜頃?靾?鞛堨姷雼堧嫟.${R}`);
  console.log(`  ${DIM}斓滌儊鞙?韼橃澊歆€鞐?鞐瓣舶頃橂┐ 頃橃渼 韼橃澊歆€電?鞛愲彊鞙茧 韽暔霅╇媹雼?${R}`);
  console.log();
  const token = (await inputPrompt("Notion Integration Token:")).trim();
  if (!token) return {};
  const label = (await inputPrompt("響滌嫓 鞚措 (鞓? Personal Notion):")).trim();
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
  const label = (await inputPrompt(`響滌嫓 鞚措 (${projectKey || baseUrl}):`)).trim();
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
  const label = (await inputPrompt(`響滌嫓 鞚措 (${teamId || channelId || "Slack"}):`)).trim();
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
  console.log(`  ${BLD}靸?鞐半彊 於旉皜${R}`);
  console.log(`  ${DIM}Esc毳?雸勲ゴ氅?鞏胳牅霌?旆唽霅╇媹雼?${R}`);
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
    return { tone: "error", text: `鞐半彊鞚?於旉皜頃橃 氇豁枅鞀惦媹雼? ${String(createRes.data.error)}` };
  }

  const created = createRes.data.integration as Integration;
  const testRes = await apiPost(`/api/user/integrations/${created.id}/test`);
  if (!testRes.ok) {
    return { tone: "warn", text: `鞐半彊鞚€ 鞝€鞛ル悙歆€毵?鞐瓣舶 韰岇姢韸鸽姅 鞁ろ尐頄堨姷雼堧嫟: ${String(testRes.data.error)}` };
  }

  const warning = testRes.data.warning ? ` / ${String(testRes.data.warning)}` : "";
  const pageCount = extractPageCount(testRes.data.metadata);
  return { tone: "success", text: `${providerLabel(created.provider)} 鞐半彊鞚?於旉皜霅愳姷雼堧嫟: ${created.label}${pageCount}${warning}` };
}

async function updateGitEmails(integration: GitIntegration): Promise<ScreenMessage | null> {
  clearScreen();
  console.log(`  ${BLD}${integration.label} 鞚措鞚?頃勴劙 靾橃爼${R}`);
  console.log(`  ${DIM}鞚措鞚检潉 頃?欷勳敥 鞛呺牓頃橃劯鞖? 牍?鞛呺牓鞚措┐ 膦呺頃╇媹雼?${R}`);
  console.log();

  const emails: string[] = [];
  while (true) {
    const email = (await inputPrompt("Author email:")).trim();
    if (!email) break;
    emails.push(email);
  }

  const patchRes = await apiPatch(`/api/user/integrations/${integration.id}`, { emails });
  if (!patchRes.ok) {
    return { tone: "error", text: `鞚措鞚?頃勴劙毳?靾橃爼頃橃 氇豁枅鞀惦媹雼? ${String(patchRes.data.error)}` };
  }

  if (emails.length === 0) {
    return { tone: "success", text: `鞚措鞚?頃勴劙毳?牍勳洜鞀惦媹雼? ${integration.label} / all commits` };
  }
  return { tone: "success", text: `鞚措鞚?頃勴劙毳?鞝€鞛ロ枅鞀惦媹雼? ${emails.join(", ")}` };
}

async function syncIntegration(integration: Integration): Promise<ScreenMessage> {
  const syncRes = await apiPost(`/api/user/integrations/${integration.id}/sync`);
  if (!syncRes.ok) {
    return { tone: "error", text: `靾橂彊 霃欔赴頇旉皜 鞁ろ尐頄堨姷雼堧嫟: ${String(syncRes.data.error)}` };
  }

  const result = (syncRes.data.result ?? {}) as Record<string, unknown>;
  const status = result.firstSync === true ? "baseline created" : "diff checked";
  const countKey = typeof result.snapshotCount === "number" ? "pages" :
    typeof result.issueCount === "number" ? "issues" :
    typeof result.messageCount === "number" ? "messages" : "items";
  const count = typeof result.snapshotCount === "number" ? String(result.snapshotCount) :
    typeof result.issueCount === "number" ? String(result.issueCount) :
    typeof result.messageCount === "number" ? String(result.messageCount) : "-";
  const detected = typeof result.detectedEvents === "number" ? String(result.detectedEvents) : "-";
  const applied = typeof result.appliedEvents === "number" ? String(result.appliedEvents) : "-";
  const tone: MessageTone = Number(applied) > 0 ? "success" : "warn";
  return {
    tone,
    text: `${providerLabel(integration.provider)} sync | ${integration.label} | status ${status} | ${countKey} ${count} | detected ${detected} | applied ${applied}`,
  };
}

async function editIntegration(integration: Integration): Promise<ScreenMessage | null> {
  clearScreen();
  console.log(`  ${BLD}${integration.label}${R} ${DIM}[${providerLabel(integration.provider)}]${R}`);
  console.log(`  ${DIM}status:${R} ${statusText(integration)}`);
  console.log(`  ${DIM}summary:${R} ${integrationSummary(integration)}`);
  console.log();

  const choices: Array<{ name: string; value: string }> = [
    { name: "Test integration", value: "test" },
    { name: "靷牅", value: "delete" },
  ];
  if (["notion", "jira", "slack"].includes(integration.provider)) {
    choices.unshift({ name: "Sync now", value: "sync" });
  }
  if (isGitIntegration(integration)) {
    choices.unshift({ name: "鞚措鞚?頃勴劙 靾橃爼", value: "emails" });
  }
  choices.push({ name: "雼赴", value: "close" });

  const mode = await selectFrame("Choose an action", choices);
  if (!mode || mode === "close") return null;

  if (mode === "emails" && isGitIntegration(integration)) {
    return updateGitEmails(integration);
  }

  if (mode === "sync") {
    return syncIntegration(integration);
  }

  if (mode === "test") {
    const testRes = await apiPost(`/api/user/integrations/${integration.id}/test`);
    if (!testRes.ok) {
      return { tone: "error", text: `鞐瓣舶 韰岇姢韸戈皜 鞁ろ尐頄堨姷雼堧嫟: ${String(testRes.data.error)}` };
    }
    const warning = testRes.data.warning ? ` / ${String(testRes.data.warning)}` : "";
    const pageCount = extractPageCount(testRes.data.metadata);
    return { tone: "success", text: `鞐瓣舶 韰岇姢韸?靹标车: ${integration.label}${pageCount}${warning}` };
  }

  const confirm = await selectFrame(`${integration.label} 鞐半彊鞚?靷牅頃犼箤鞖?`, [
    { name: "靷牅", value: "delete" },
    { name: "旆唽", value: "cancel" },
  ]);
  if (confirm !== "delete") return null;

  const deleteRes = await apiDelete(`/api/user/integrations/${integration.id}`);
  if (!deleteRes.ok) {
    return { tone: "error", text: `鞐半彊鞚?靷牅頃橃 氇豁枅鞀惦媹雼? ${String(deleteRes.data.error)}` };
  }
  return { tone: "success", text: `鞐半彊鞚?靷牅頄堨姷雼堧嫟: ${integration.label}` };
}

export async function connectCommand() {
  let flashMessage: ScreenMessage | undefined;

  while (true) {
    const { integrations, message } = await getIntegrations();
    printConnectScreen(integrations, flashMessage ?? message);

    const items: Array<{ name: string; value: string } | { separator: string }> = [
      { name: "[+ 靸?鞐半彊 於旉皜]", value: "__add__" },
      separator(" "),
    ];

    for (const integration of integrations) {
      items.push({
        name: `[${providerLabel(integration.provider)}] ${integration.label}  ${statusText(integration)}  ${integrationSummary(integration)}`,
        value: integration.id,
      });
    }

    items.push(separator(" "));
    items.push({ name: "雼赴", value: "__close__" });

    const selected = await selectFrame("Choose an action. Enter select / Esc close", items, {
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
      flashMessage = { tone: "error", text: "靹犿儩頃?鞐半彊鞚?彀眷 氇豁枅鞀惦媹雼? 頇旊┐鞚?靸堧瓿犾龚頃╇媹雼?" };
      continue;
    }

    flashMessage = (await editIntegration(target)) ?? undefined;
  }
}

