import { apiPost } from "../api-client.js";
import { selectAction, inputPrompt, numberPrompt } from "../ui/prompts.js";

export async function debugCommand() {
  while (true) {
    const action = await selectAction("디버그 메뉴:", [
      { name: "테스트 커밋 발생", value: "commit" },
      { name: "야생 조우 강제 발생", value: "encounter" },
      { name: "포인트 지급", value: "points" },
      { name: "아이템 지급", value: "item" },
      { name: "포켓몬 지급", value: "pokemon" },
      { name: "전투 초기화", value: "clear-battle" },
      { name: "← 돌아가기", value: "__back__" },
    ]);
    if (action === "__back__") return;

    switch (action) {
      case "commit": {
        const bytes = await numberPrompt("바이트 수 (기본 500):");
        const res = await apiPost("/api/admin/test/commit", {
          userId: "wkdrmadl3",
          bytes: bytes || 500,
        });
        if (res.ok) {
          const d = res.data;
          console.log(`  커밋 처리 완료`);
          console.log(`  EXP: +${d.exp}  Points: +${d.points}  Combo: ${d.combo}x (x${d.multiplier})`);
          if (d.encounter) {
            const enc = d.encounter as { species: string; level: number };
            console.log(`  야생 ${enc.species} Lv.${enc.level} 출현!`);
          }
        } else {
          console.error(`  오류: ${res.data.error}`);
        }
        break;
      }
      case "encounter": {
        const species = await inputPrompt("포켓몬 종류 (빈값=랜덤):");
        const level = await numberPrompt("레벨 (빈값=랜덤):");
        const body: Record<string, unknown> = { userId: "wkdrmadl3" };
        if (species) body.species = species;
        if (level) body.level = level;
        const res = await apiPost("/api/admin/test/encounter", body);
        if (res.ok) {
          const evt = res.data.event as { species: string; level: number };
          console.log(`  야생 ${evt.species} Lv.${evt.level} 조우 이벤트 생성!`);
        } else {
          console.error(`  오류: ${res.data.error}`);
        }
        break;
      }
      case "points": {
        const amount = await numberPrompt("지급할 포인트:");
        if (!amount) break;
        const res = await apiPost("/api/admin/test/give-points", {
          userId: "wkdrmadl3",
          amount,
        });
        if (res.ok) {
          console.log(`  포인트 지급 완료 (현재: ${res.data.points}P)`);
        } else {
          console.error(`  오류: ${res.data.error}`);
        }
        break;
      }
      case "item": {
        const item = await inputPrompt("아이템명 (pokeball, potion 등):");
        if (!item) break;
        const qty = await numberPrompt("수량 (기본 1):");
        const res = await apiPost("/api/admin/test/give-item", {
          userId: "wkdrmadl3",
          item,
          quantity: qty || 1,
        });
        if (res.ok) {
          console.log(`  ${item} ${qty || 1}개 지급 완료`);
        } else {
          console.error(`  오류: ${res.data.error}`);
        }
        break;
      }
      case "pokemon": {
        const species = await inputPrompt("포켓몬 종류:");
        if (!species) break;
        const level = await numberPrompt("레벨 (기본 5):");
        const res = await apiPost("/api/admin/test/give-pokemon", {
          userId: "wkdrmadl3",
          species,
          level: level || 5,
        });
        if (res.ok) {
          const p = res.data.pokemon as { species: string; level: number };
          console.log(`  ${p.species} Lv.${p.level} 지급 완료!`);
        } else {
          console.error(`  오류: ${res.data.error}`);
        }
        break;
      }
      case "clear-battle": {
        const res = await apiPost("/api/admin/test/clear-battle", {
          userId: "wkdrmadl3",
        });
        if (res.ok) {
          console.log("  전투 상태 초기화 완료");
        } else {
          console.error(`  오류: ${res.data.error}`);
        }
        break;
      }
    }
    console.log();
  }
}
