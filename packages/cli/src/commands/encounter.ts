import { DIM, RED, GRN, YEL, BLU, CYN, BLD, R } from "../ui/colors.js";
import { apiPost, apiGet } from "../api-client.js";
import { fetchArt, fetchBallArt, renderHpBar } from "../ui/display.js";
import { redraw, clearScreen } from "../ui/screen.js";
import { enterRaw, waitKey } from "../ui/raw-mode.js";
import {
  sleep,
  buildBattleScene,
  playBallThrowAnimation,
  BALL_KEYS,
  POTION_KEYS,
  ITEM_DISPLAY,
  BALL_ART_KEY,
  buildSelectLines,
  buildMenuPanel,
  buildFightPanel,
  buildBagPanel,
  buildPartyPanel,
  BAG_CATEGORIES,
  MENU_ACTIONS,
  type Move,
  type BattleResult,
  type PartyMon,
  type PokemonInfo,
  type SubMode,
} from "../ui/encounter-animation.js";

// ── 메인 ───────────────────────────────────────────────────────
export async function encounterCommand(
  eventId: string,
  wildInfo: { species: string; level: number },
): Promise<void> {
  enterRaw();

  // 파티 로드
  const partyRes = await apiGet("/api/game/party");
  if (!partyRes.ok) {
    process.stdout.write(`\n  ${RED}오류: ${partyRes.data.error}${R}\n`);
    return;
  }

  const party = partyRes.data.party as PartyMon[];
  const alivePokemon = party.filter(p => p.hp > 0);
  if (alivePokemon.length === 0) {
    const errLines = [
      "",
      `  ${RED}전투 가능한 포켓몬이 없습니다.${R}`,
      `  ${DIM}포켓몬이 모두 쓰러져 있습니다. 인벤토리에서 회복 아이템을 사용하세요.${R}`,
      "",
      `  ${DIM}Enter / Esc 뒤로${R}`,
    ];
    clearScreen();
    process.stdout.write(errLines.join("\n"));
    await waitKey();
    return;
  }

  // ── Phase 1: 포켓몬 선택 ─────────────────────────────────────
  const artCache = new Map<string, string | null>();

  async function getCachedArt(species: string): Promise<string | null> {
    if (!artCache.has(species)) {
      const art = await fetchArt(species);
      artCache.set(species, art);
    }
    return artCache.get(species) ?? null;
  }

  async function refreshPartyHp(): Promise<void> {
    const pr = await apiGet("/api/game/party");
    if (pr.ok) {
      const np = pr.data.party as PartyMon[];
      for (const p of party) {
        const u = np.find(n => n.uid === p.uid);
        if (u) { p.hp = u.hp; p.maxHp = u.maxHp; }
      }
    }
  }

  let selectCursor = 0;
  let selectArt: string | null = null;
  let lastSelectSpecies = "";
  const titleStr = `야생 ${wildInfo.species} Lv.${wildInfo.level}`;

  let selectedUid: string | null = null;
  let lineCount = 0;
  let first = true;

  while (selectedUid === null) {
    const alive = party.filter(p => p.hp > 0);
    selectCursor = Math.min(selectCursor, Math.max(0, alive.length - 1));

    const species = alive[selectCursor]?.species ?? "";
    if (species !== lastSelectSpecies) {
      selectArt = species ? await getCachedArt(species) : null;
      lastSelectSpecies = species;
    }

    const lines = buildSelectLines(titleStr, party, selectCursor, selectArt);
    lineCount = redraw(lines, lineCount, first);
    first = false;

    const key = await waitKey();
    if (key === "\x03") { process.stdout.write("\x1b[?25h"); process.exit(0); }
    else if (key === "\x1b" || key === "q") {
      process.stdout.write("\x1b[?25h\x1b[2J\x1b[H");
      return;
    }
    else if (key === "\x1b[A") { if (selectCursor > 0) selectCursor--; }
    else if (key === "\x1b[B") { if (selectCursor < alive.length - 1) selectCursor++; }
    else if (key === "\r") {
      const chosen = alive[selectCursor];
      if (chosen) selectedUid = chosen.uid;
    }
  }

  // 배틀 시작
  const startRes = await apiPost("/api/battle/start", { eventId, pokemonUid: selectedUid });
  if (!startRes.ok) {
    const errLines = [
      "",
      `  ${RED}전투 시작 오류: ${startRes.data.error}${R}`,
      "",
      `  ${DIM}Enter / Esc 뒤로${R}`,
    ];
    clearScreen();
    process.stdout.write(errLines.join("\n"));
    await waitKey();
    return;
  }

  // ── Phase 2: 배틀 루프 ───────────────────────────────────────
  let battleOver = false;
  const battleLog: string[] = [];

  type SubMode = "menu" | "fight" | "bag" | "party";
  let subMode: SubMode = "menu";

  let menuCursor  = 0;
  let fightCursor = 0;
  let bagCat      = 0;
  let bagCursor   = 0;
  let partyCursor = 0;
  let partyForced = false;

  let stateStale  = true;
  lineCount = 0;
  first     = true;

  // 현재 배틀 상태
  let wildState: PokemonInfo = { species: wildInfo.species, level: wildInfo.level, hp: 1, maxHp: 1 };
  let myPoke: PartyMon | null = null;
  let myPokeMoves: Move[] = [];
  let inventory: Record<string, number> = {};

  let wildArt: string | null = null;
  let myArt: string | null = null;
  let partyArt: string | null = null;
  let lastPartyArtUid = "";

  // scene lines (battle art + log)
  let sceneLines: string[] = [];

  function buildSceneLines(): string[] {
    const lines: string[] = [];
    if (myPoke && wildArt && myArt) {
      const scene = buildBattleScene(myPoke, wildState, myArt, wildArt);
      for (const l of scene.split("\n")) lines.push(l);
    } else {
      lines.push(`  ${wildState.species} Lv.${wildState.level}`);
      lines.push(`  HP: ${renderHpBar(wildState.hp, wildState.maxHp, 12)}`);
      if (myPoke) {
        lines.push(`  ${myPoke.species} Lv.${myPoke.level}`);
        lines.push(`  HP: ${renderHpBar(myPoke.hp, myPoke.maxHp, 12)}`);
      }
    }
    lines.push("");
    lines.push(`  ${DIM}${"─".repeat(48)}${R}`);
    // 항상 3줄 고정 → 라인 수 변화 없이 line-by-line overwrite 유지
    const recent = battleLog.slice(-3);
    const logLines = recent.length === 0
      ? [`  ${DIM}전투 시작!${R}`, "", ""]
      : [
          recent[0] ? `  ${recent[0]}` : "",
          recent[1] ? `  ${recent[1]}` : "",
          recent[2] ? `  ${recent[2]}` : "",
        ];
    for (const l of logLines) lines.push(l);
    lines.push(`  ${DIM}${"─".repeat(48)}${R}`);
    lines.push("");
    return lines;
  }

  function buildFullLines(): string[] {
    const scene = buildSceneLines();
    let panel: string[];

    if (subMode === "menu") {
      panel = buildMenuPanel(menuCursor);
    } else if (subMode === "fight") {
      panel = buildFightPanel(myPokeMoves, fightCursor);
    } else if (subMode === "bag") {
      const catKeys = BAG_CATEGORIES[bagCat].keys;
      const visibleItems: [string, number][] = catKeys
        .filter(k => (inventory[k] ?? 0) > 0)
        .map(k => [k, inventory[k]] as [string, number]);
      panel = buildBagPanel(bagCat, bagCursor, inventory, visibleItems);
    } else {
      // party mode — use separate full-screen layout
      panel = buildPartyPanel(party, partyCursor, myPoke?.uid ?? "", partyArt, partyForced);
    }

    if (subMode === "party") {
      // Party mode: replace scene entirely
      return panel;
    }

    return [...scene, ...panel];
  }

  while (!battleOver) {
    // 상태 갱신
    if (stateStale) {
      const stateRes = await apiGet("/api/battle/state");
      if (!stateRes.ok || !stateRes.data.battleState) break;

      const state = stateRes.data.battleState as {
        wild: { species: string; level: number; hp: number; maxHp: number };
        myPokemonUid: string;
      };

      wildState = state.wild;
      myPoke    = party.find(p => p.uid === state.myPokemonUid) ?? null;

      // 아트 fetch
      if (!artCache.has(wildState.species)) {
        const art = await fetchArt(wildState.species);
        artCache.set(wildState.species, art);
      }
      wildArt = artCache.get(wildState.species) ?? null;

      if (myPoke) {
        if (!artCache.has(myPoke.species)) {
          const art = await fetchArt(myPoke.species);
          artCache.set(myPoke.species, art);
        }
        myArt = artCache.get(myPoke.species) ?? null;
      }

      // 기술 목록 fetch
      if (myPoke) {
        const detailRes = await apiGet(`/api/game/pokemon/${myPoke.uid}`);
        if (detailRes.ok) {
          myPokeMoves = (detailRes.data.pokemon as { moves?: Move[] })?.moves ?? [];
        }
      }

      // 인벤토리 fetch
      const invRes = await apiGet("/api/game/inventory");
      if (invRes.ok) inventory = invRes.data.inventory as Record<string, number>;

      stateStale = false;

      // 현재 포켓몬이 쓰러진 경우 강제 교체
      if (myPoke && myPoke.hp <= 0) {
        const alive = party.filter(p => p.hp > 0);
        if (alive.length === 0) {
          battleOver = true;
          battleLog.push(`${RED}전투 패배...${R}`);
          break;
        }
        subMode     = "party";
        partyForced = true;
        partyCursor = party.findIndex(p => p.hp > 0);
        if (partyCursor < 0) partyCursor = 0;
        first = true;
      }
    }

    // 파티 모드일 때 아트 fetch
    if (subMode === "party") {
      const targetUid = party[partyCursor]?.uid ?? "";
      if (targetUid !== lastPartyArtUid) {
        const sp = party[partyCursor]?.species ?? "";
        partyArt = sp ? await getCachedArt(sp) : null;
        lastPartyArtUid = targetUid;
      }
    }

    const lines = buildFullLines();
    lineCount = redraw(lines, lineCount, first);
    first = false;

    const key = await waitKey();
    if (key === "\x03") { process.stdout.write("\x1b[?25h"); process.exit(0); }

    // ── 메뉴 모드 ──────────────────────────────────────────────
    if (subMode === "menu") {
      if (key === "\x1b[D") { if (menuCursor % 2 > 0) menuCursor--; }
      else if (key === "\x1b[C") { if (menuCursor % 2 < 1) menuCursor++; }
      else if (key === "\x1b[A") { if (menuCursor >= 2) menuCursor -= 2; }
      else if (key === "\x1b[B") { if (menuCursor < 2) menuCursor += 2; }
      else if (key === "\r") {
        const action = MENU_ACTIONS[menuCursor];
        if (action === "싸운다") {
          subMode = "fight";
          fightCursor = 0;
        } else if (action === "가방") {
          subMode = "bag";
          bagCat = 0;
          bagCursor = 0;
        } else if (action === "포켓몬") {
          subMode = "party";
          partyForced = false;
          partyCursor = 0;
          lastPartyArtUid = "";
          partyArt = null;
          first = true;
        } else if (action === "도망치기") {
          const runRes = await apiPost("/api/battle/action", { action: "run", data: {} });
          const r = runRes.data as BattleResult;
          if (r.message) battleLog.push(r.message);
          if (Array.isArray(r.log)) for (const m of r.log as string[]) battleLog.push(m);
          if (r.battleOver) {
            battleOver = true;
            battleLog.push("도망쳤다!");
          }
          // 파티 HP 갱신
          await refreshPartyHp();
          stateStale = true;
          subMode    = "menu";
        }
      }
    }

    // ── 싸운다 모드 ────────────────────────────────────────────
    else if (subMode === "fight") {
      const rowSize = 2;
      const row = Math.floor(fightCursor / rowSize);
      const col = fightCursor % rowSize;
      const moveCount = myPokeMoves.length;

      if (key === "\x1b" || key === "q") { subMode = "menu"; }
      else if (key === "\x1b[A") {
        const newRow = row - 1;
        if (newRow >= 0) fightCursor = newRow * rowSize + col;
      }
      else if (key === "\x1b[B") {
        const newRow = row + 1;
        const newIdx = newRow * rowSize + col;
        if (newIdx < moveCount) fightCursor = newIdx;
      }
      else if (key === "\x1b[D") {
        if (col > 0) fightCursor--;
      }
      else if (key === "\x1b[C") {
        if (col < rowSize - 1 && fightCursor + 1 < moveCount) fightCursor++;
      }
      else if (key === "\r") {
        const move = myPokeMoves[fightCursor];
        if (!move) continue;
        if (move.pp <= 0) continue;

        const res = await apiPost("/api/battle/action", { action: "fight", data: { moveId: move.id } });
        const r   = res.data as BattleResult;
        if (r.message) battleLog.push(r.message);
        if (Array.isArray(r.log)) for (const m of r.log as string[]) battleLog.push(m);
        if (r.battleOver) {
          battleOver = true;
          if (r.result === "victory") battleLog.push(`${GRN}전투 승리!${R}`);
          else if (r.result === "defeat") battleLog.push(`${RED}전투 패배...${R}`);
        }
        if (r.rewards) battleLog.push(`보상: EXP +${r.rewards.exp}, ${r.rewards.points}P`);

        await refreshPartyHp();
        stateStale = true;
        subMode    = "menu";
      }
    }

    // ── 가방 모드 ──────────────────────────────────────────────
    else if (subMode === "bag") {
      const catKeys = BAG_CATEGORIES[bagCat].keys;
      const visibleItems: [string, number][] = catKeys
        .filter(k => (inventory[k] ?? 0) > 0)
        .map(k => [k, inventory[k]] as [string, number]);

      if (key === "\x1b" || key === "q") { subMode = "menu"; }
      else if (key === "\x1b[D") {
        bagCat    = (bagCat - 1 + BAG_CATEGORIES.length) % BAG_CATEGORIES.length;
        bagCursor = 0;
      }
      else if (key === "\x1b[C") {
        bagCat    = (bagCat + 1) % BAG_CATEGORIES.length;
        bagCursor = 0;
      }
      else if (key === "\x1b[A") {
        if (bagCursor > 0) bagCursor--;
      }
      else if (key === "\x1b[B") {
        if (bagCursor < visibleItems.length - 1) bagCursor++;
      }
      else if (key === "\r") {
        const item = visibleItems[bagCursor];
        if (!item) continue;
        const [itemKey] = item;

        if (BALL_KEYS.includes(itemKey)) {
          // 볼 던지기
          const catchPromise = apiPost("/api/battle/action", { action: "catch", data: { ball: itemKey } });

          if (myPoke && myArt && wildArt) {
            const ballArtStr = await fetchBallArt(BALL_ART_KEY[itemKey] ?? itemKey);
            if (ballArtStr) {
              await playBallThrowAnimation(myPoke, wildState, myArt, wildArt, ballArtStr, catchPromise);
            }
          }

          const catchResult = await catchPromise;
          const r = catchResult.data as BattleResult;
          if (r.message) battleLog.push(r.message);
          if (Array.isArray(r.log)) for (const m of r.log as string[]) battleLog.push(m);
          if (r.caught) battleLog.push(`${YEL}포획 성공!${R}`);
          if (r.battleOver) {
            battleOver = true;
            if (r.result === "caught") battleLog.push(`${YEL}포켓몬을 잡았다!${R}`);
            else if (r.result === "victory") battleLog.push(`${GRN}전투 승리!${R}`);
            else if (r.result === "defeat")  battleLog.push(`${RED}전투 패배...${R}`);
          }
          if (r.rewards) battleLog.push(`보상: EXP +${r.rewards.exp}, ${r.rewards.points}P`);

          await refreshPartyHp();
          inventory[itemKey] = Math.max(0, (inventory[itemKey] ?? 1) - 1);
          stateStale = true;
          subMode    = "menu";
          first      = true;
        } else {
          // 포션 사용
          if (!myPoke) continue;
          const res = await apiPost("/api/battle/action", {
            action: "item",
            data: { item: itemKey, pokemonUid: myPoke.uid },
          });
          const r = res.data as BattleResult;
          if (r.message) battleLog.push(r.message);
          if (Array.isArray(r.log)) for (const m of r.log as string[]) battleLog.push(m);
          if (r.battleOver) {
            battleOver = true;
            if (r.result === "victory") battleLog.push(`${GRN}전투 승리!${R}`);
            else if (r.result === "defeat") battleLog.push(`${RED}전투 패배...${R}`);
          }
          if (r.rewards) battleLog.push(`보상: EXP +${r.rewards.exp}, ${r.rewards.points}P`);

          await refreshPartyHp();
          inventory[itemKey] = Math.max(0, (inventory[itemKey] ?? 1) - 1);
          stateStale = true;
          subMode    = "menu";
        }
      }
    }

    // ── 파티 모드 ──────────────────────────────────────────────
    else if (subMode === "party") {
      if (key === "\x1b[A") {
        if (partyCursor > 0) {
          partyCursor--;
          lastPartyArtUid = "";
        }
      }
      else if (key === "\x1b[B") {
        if (partyCursor < party.length - 1) {
          partyCursor++;
          lastPartyArtUid = "";
        }
      }
      else if (key === "\x1b" || key === "q") {
        if (!partyForced) {
          subMode = "menu";
          lastPartyArtUid = "";
          partyArt = null;
          first = true;
        }
        // partyForced 시 Esc 무시
      }
      else if (key === "\r") {
        const target = party[partyCursor];
        if (!target) continue;
        if (target.uid === myPoke?.uid) continue; // 이미 출전 중
        if (target.hp <= 0) continue; // 쓰러진 포켓몬

        const forced = partyForced;
        const res = await apiPost("/api/battle/action", {
          action: "switch",
          data: { pokemonUid: target.uid, forced },
        });
        const r = res.data as BattleResult;
        if (r.message) battleLog.push(r.message);
        if (Array.isArray(r.log)) for (const m of r.log as string[]) battleLog.push(m);
        if (r.battleOver) {
          battleOver = true;
          if (r.result === "victory") battleLog.push(`${GRN}전투 승리!${R}`);
          else if (r.result === "defeat") battleLog.push(`${RED}전투 패배...${R}`);
        }

        await refreshPartyHp();
        partyForced     = false;
        stateStale      = true;
        subMode         = "menu";
        lastPartyArtUid = "";
        partyArt        = null;
        first           = true;
      }
    }
  }

  // ── 전투 종료 화면 ───────────────────────────────────────────
  const finalScene = buildSceneLines();
  const finalLines = [
    ...finalScene,
    "",
    `  ${DIM}아무 키나 누르세요...${R}`,
  ];
  clearScreen();
  process.stdout.write(finalLines.join("\n"));
  await waitKey();
  process.stdout.write("\x1b[?25h\x1b[2J\x1b[H");
}
