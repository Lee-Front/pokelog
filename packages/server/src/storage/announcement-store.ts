/**
 * 운영자 공지 저장소 — pokelog-data/announcements.json (단일 배열 파일).
 *
 * 동시성: 생성/토글/삭제는 읽기-수정-쓰기라 경합에 취약하다. pvp-store의 키별
 * 직렬화 헬퍼(withLock)를 재사용해 같은 파일에 대한 변경을 직렬화한다. 파일 레벨
 * atomic rename은 json-store가 보장한다.
 */
import crypto from "node:crypto";
import path from "node:path";
import type { Announcement } from "../../../../shared/types.js";
import { getDataDir } from "../paths.js";
import { readJson, writeJson } from "./json-store.js";
import { withLock } from "./pvp-store.js";

const LOCK_KEY = "announcements";

function announcementsPath(): string {
  return path.join(getDataDir(), "announcements.json");
}

/** 전체 공지를 최신순(createdAt 내림차순)으로 반환. 파일이 없으면 빈 배열. */
export async function getAnnouncements(): Promise<Announcement[]> {
  const list = await readJson<Announcement[]>(announcementsPath());
  if (!Array.isArray(list)) return [];
  return [...list].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/** 공지를 생성(active=true)하고 저장. 생성된 공지를 반환. */
export async function createAnnouncement(title: string, body: string): Promise<Announcement> {
  return withLock(LOCK_KEY, async () => {
    const list = (await readJson<Announcement[]>(announcementsPath())) ?? [];
    const announcement: Announcement = {
      id: crypto.randomUUID(),
      title,
      body,
      active: true,
      createdAt: new Date().toISOString(),
    };
    list.push(announcement);
    await writeJson(announcementsPath(), list);
    return announcement;
  });
}

/** active 토글. 대상이 없으면 null. */
export async function setAnnouncementActive(id: string, active: boolean): Promise<Announcement | null> {
  return withLock(LOCK_KEY, async () => {
    const list = (await readJson<Announcement[]>(announcementsPath())) ?? [];
    const target = list.find((a) => a.id === id);
    if (!target) return null;
    target.active = active;
    await writeJson(announcementsPath(), list);
    return target;
  });
}

/** 공지 삭제. 삭제했으면 true, 대상이 없으면 false. */
export async function deleteAnnouncement(id: string): Promise<boolean> {
  return withLock(LOCK_KEY, async () => {
    const list = (await readJson<Announcement[]>(announcementsPath())) ?? [];
    const next = list.filter((a) => a.id !== id);
    if (next.length === list.length) return false;
    await writeJson(announcementsPath(), next);
    return true;
  });
}
