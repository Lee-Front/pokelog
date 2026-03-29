import type { NotionIntegration } from "../../../../shared/types.js";

export interface NotionPageSnapshot {
  id: string;
  createdTime: string;
  lastEditedTime: string;
  archived: boolean;
  parentType: string;
  statusValue?: string;
  title?: string;
}

interface NotionSearchResponse {
  has_more?: boolean;
  next_cursor?: string | null;
  results?: Array<Record<string, unknown>>;
}

export async function listNotionPages(integration: NotionIntegration): Promise<NotionPageSnapshot[]> {
  const pages: NotionPageSnapshot[] = [];
  let cursor: string | null | undefined = undefined;

  while (true) {
    const body: Record<string, unknown> = {
      page_size: 100,
      filter: {
        property: "object",
        value: "page",
      },
    };
    if (cursor) body.start_cursor = cursor;

    const res = await fetch("https://api.notion.com/v1/search", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${integration.config.token}`,
        "Content-Type": "application/json",
        "Notion-Version": "2022-06-28",
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      const message = typeof data.message === "string" ? data.message : `Notion search failed (${res.status})`;
      throw new Error(message);
    }

    const data = (await res.json()) as NotionSearchResponse;
    for (const result of data.results ?? []) {
      pages.push(toSnapshot(result));
    }

    if (!data.has_more || !data.next_cursor) break;
    cursor = data.next_cursor;
  }

  return pages;
}

function toSnapshot(page: Record<string, unknown>): NotionPageSnapshot {
  const properties = ((page.properties as Record<string, unknown> | undefined) ?? {});
  return {
    id: String(page.id ?? ""),
    createdTime: String(page.created_time ?? ""),
    lastEditedTime: String(page.last_edited_time ?? ""),
    archived: Boolean(page.archived ?? page.in_trash ?? false),
    parentType: String((page.parent as Record<string, unknown> | undefined)?.type ?? "page_id"),
    statusValue: findStatusValue(properties),
    title: findTitle(properties),
  };
}

function findStatusValue(properties: Record<string, unknown>): string | undefined {
  for (const value of Object.values(properties)) {
    const property = (value as Record<string, unknown> | undefined) ?? {};
    const type = String(property.type ?? "");
    if (type === "status") {
      return String((property.status as Record<string, unknown> | undefined)?.name ?? "");
    }
    if (type === "select") {
      return String((property.select as Record<string, unknown> | undefined)?.name ?? "");
    }
  }
  return undefined;
}

function findTitle(properties: Record<string, unknown>): string | undefined {
  for (const value of Object.values(properties)) {
    const property = (value as Record<string, unknown> | undefined) ?? {};
    if (String(property.type ?? "") !== "title") continue;
    const title = Array.isArray(property.title) ? property.title as Array<Record<string, unknown>> : [];
    const plain = title
      .map((item) => String(item.plain_text ?? ""))
      .join("")
      .trim();
    return plain || undefined;
  }
  return undefined;
}
