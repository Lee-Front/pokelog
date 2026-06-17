import type { UserData } from "../../../../shared/types.js";

/**
 * 유저의 **게임 진행 데이터만** 초기화하고 계정/연동/공지표시상태는 보존한다.
 * 오픈베타 와이프(개별 reset-game, 전체 reset-all-game)에서 공통으로 쓰인다.
 *
 * mutate-in-place 방식으로 동작하며, 호출자가 saveUser(user, "admin-adjust")로
 * 저장한다(포인트/경험치 하락이 의도된 것이므로 잔액역행 경고를 건너뛴다).
 *
 * ── 리셋(게임 진행) ──────────────────────────────────────────────
 *   points, totalExp, battleMoney   — 모든 재화 0
 *   combo                            — 콤보 카운트/마지막 커밋시각 초기화
 *   encounterCeiling                 — 누적 바이트(조우 천장) 0
 *   party, pokemon, storage          — 보유 포켓몬 전부 제거
 *   eggs                             — 보유 알 제거
 *   pokedex                          — 도감 기록 초기화
 *   inventory                        — 인벤토리 비움
 *   pendingEvents                    — 대기 중 야생 조우 제거
 *   pendingEvolutions                — 대기 중 진화 제거
 *   battleState                      — 진행 중 야생 전투 종료
 *   currentRegion                    — 기본 지역으로
 *
 * ── 보존(계정/연동/식별) ─────────────────────────────────────────
 *   account (id/password/nickname/createdAt/matchings)  — 로그인 정체성
 *   integrations (연동 이메일·토큰 포함)                  — 재적립 소스 유지
 *   log                                                  — 활동 이력(감사용) 유지
 *   dismissedAnnouncementIds                             — 공지 표시상태 유지
 *
 * PvP 매치/스탯/대기열은 별도 저장소(pvp/)에 살며 UserData에 없으므로 여기서
 * 건드리지 않는다(유저↔매치 링크 보존).
 */
export function resetGameData(user: UserData): void {
  user.points = 0;
  user.totalExp = 0;
  user.battleMoney = 0;
  user.combo = { count: 0, lastCommitAt: null };
  user.encounterCeiling = { accumulatedBytes: 0 };
  user.party = [];
  user.pokemon = [];
  user.storage = [];
  user.eggs = [];
  user.pokedex = [];
  user.seenSpecies = [];
  user.inventory = {};
  user.pendingEvents = [];
  user.pendingEvolutions = [];
  user.battleState = null;
  user.currentRegion = "default";
}
