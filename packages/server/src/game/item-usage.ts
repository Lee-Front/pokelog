import type { OwnedPokemon, ShopItem, UserData } from "../../../../shared/types.js";
import { getItems, getVariants, getSpeciesByName, getAbilities } from "./data-loader.js";
import { GameRuleError } from "./game-errors.js";
import { evolvePokemon, getEvolutionItemUseTarget, getEvolutionBranches, resolveTradeEvolution } from "./growth.js";
import { applyEvGain, emptyEvs, EV_STAT_MAX, EV_TOTAL_MAX, EV_STAT_KEYS, VITAMIN_STAT } from "./evs.js";
import { buildStatsForPokemon } from "./pokemon-stats.js";
import { decrementItem, healPokemon, applyStatusCure } from "./inventory-utils.js";
import { clearPendingEvolutionForPokemon } from "./pending-evolution.js";
import { getDisplaySpeciesName } from "./pokemon-state.js";

export { GameRuleError as ItemUseError };

export interface ItemUseResult {
  kind: "healing" | "status-cure" | "evolution" | "gmax-factor" | "vitamin" | "ability";
  item: string;
  itemName: string;
  pokemon: OwnedPokemon;
  previousSpecies?: string;
  // 특성 변경(특성캡슐/특성패치) 결과 — 바뀐 특성 id와 안내 메시지.
  abilityId?: string | null;
  message?: string;
}

function getItemDisplayName(item: string, shopItem?: ShopItem): string {
  if (shopItem?.name) {
    return shopItem.name;
  }

  return getItems().find((entry) => entry.id === item)?.name ?? item;
}

function getPokemonDisplayName(pokemon: OwnedPokemon): string {
  if (pokemon.nickname) {
    return pokemon.nickname;
  }

  return getDisplaySpeciesName(pokemon.species);
}

// 특성 표시명(한글) — abilities.json에서 id로 조회하고, 없으면 id를 그대로 쓴다.
function getAbilityDisplayName(abilityId: string | null | undefined): string {
  if (!abilityId) {
    return "특성";
  }

  return getAbilities().find((entry) => entry.id === abilityId)?.name ?? abilityId;
}

export function useInventoryItem(
  user: UserData,
  item: string,
  pokemonUid: string,
  shopItem?: ShopItem,
): ItemUseResult {
  if (!user.inventory[item] || user.inventory[item] <= 0) {
    throw new GameRuleError("Item not found in inventory.");
  }

  const pokemon = user.pokemon.find((entry) => entry.uid === pokemonUid);
  if (!pokemon) {
    throw new GameRuleError("Pokemon not found in party.", 404);
  }

  const itemName = getItemDisplayName(item, shopItem);

  if (shopItem?.healAmount) {
    if (pokemon.hp >= pokemon.maxHp) {
      throw new GameRuleError("Pokemon does not need healing.");
    }

    decrementItem(user.inventory, item);
    healPokemon(pokemon, shopItem.healAmount);

    return {
      kind: "healing",
      item,
      itemName,
      pokemon,
    };
  }

  // 상태이상 치료 아이템(antidote/full-heal 등) — curesStatus가 지정된 아이템은 대상의
  // statusCondition을 회복한다. 대상 상태가 없거나 불일치하면 소모 없이 거부한다(잘못 낭비 방지).
  if (shopItem?.curesStatus) {
    if (!applyStatusCure(pokemon, shopItem.curesStatus)) {
      throw new GameRuleError("치료할 상태이상이 없습니다");
    }

    decrementItem(user.inventory, item);

    return {
      kind: "status-cure",
      item,
      itemName,
      pokemon,
    };
  }

  // 교환의끈(linking-cord) — 2인 교환 없이 혼자서 대상의 교환진화를 발동한다(일반 교환·지닌물건
  // 교환 진화 모두). 지닌물건 교환진화면 그 지닌물건을 지니고 있어야 하고, 진화 시 소모한다
  // (trade.ts의 maybeApplyTradeEvolution와 동일 규약). 교환진화가 없으면 효과 없음(400).
  if (item === "linking-cord") {
    const tradeBranch = resolveTradeEvolution(pokemon.species, { heldItem: pokemon.heldItem ?? null });
    if (!tradeBranch) {
      // 교환진화 분기 자체는 있으나 필요한 지닌물건을 안 든 경우엔 안내 메시지를 준다.
      const heldItemBranch = getEvolutionBranches(pokemon.species).find(
        (branch) => branch.trigger === "trade" && branch.conditions.some((c) => c.type === "held-item"),
      );
      const heldItemCondition = heldItemBranch?.conditions.find((c) => c.type === "held-item");
      if (heldItemCondition && heldItemCondition.type === "held-item") {
        throw new GameRuleError(`${getItemDisplayName(heldItemCondition.item)}을(를) 지니게 한 뒤 사용해주세요.`);
      }
      throw new GameRuleError("이 포켓몬에게는 효과가 없다");
    }

    const previousSpecies = pokemon.species;
    decrementItem(user.inventory, item);
    clearPendingEvolutionForPokemon(user, pokemon.uid);
    evolvePokemon(pokemon, tradeBranch.targetSpecies, tradeBranch.targetVariantId);

    // 지닌물건 교환진화(예: 메탈코트)면 진화 후 그 지닌물건을 소모한다.
    if (tradeBranch.conditions.some((c) => c.type === "held-item")) {
      pokemon.heldItem = null;
    }

    if (!user.pokedex.includes(tradeBranch.targetSpecies)) {
      user.pokedex.push(tradeBranch.targetSpecies);
    }

    return {
      kind: "evolution",
      item,
      itemName,
      pokemon,
      previousSpecies,
    };
  }

  // 맥스 수프 — 개체에 기가맥스 팩터를 영구 부여(개체별 1회). canGigantamax와 동일한
  // 방식으로 거다이 가능 종인지 판정한다(variantId 우선, 없으면 species).
  if (item === "max-soup") {
    const variantPrefix = pokemon.variantId ?? pokemon.species;
    const gmaxVariantId = `${variantPrefix}-gmax`;
    const canGmax = getVariants().some(
      (v) => v.id === gmaxVariantId && v.category === "gigantamax",
    );

    if (!canGmax) {
      throw new GameRuleError("이 포켓몬은 거다이맥스할 수 없습니다.");
    }

    if (pokemon.hasGigantamaxFactor) {
      throw new GameRuleError("이미 거다이맥스 가능합니다.");
    }

    pokemon.hasGigantamaxFactor = true;
    decrementItem(user.inventory, item);

    return {
      kind: "gmax-factor",
      item,
      itemName,
      pokemon,
    };
  }

  // 특성캡슐(ability-capsule) — 일반 특성이 2개 이상인 종에서 현재 특성을 "다른" 일반 특성으로
  // 교체한다(normal[0]↔normal[1] 토글). 현재 특성이 normal[0]이면 normal[1]로, 그 외(다른 일반/
  // 숨은특성/미설정)면 normal[0]으로 되돌린다. 일반 특성이 2개 미만이면 바꿀 대상이 없으므로
  // 소모 없이 거부한다(본가와 동일하게 숨은 특성은 대상에서 제외).
  if (item === "ability-capsule") {
    const normalAbilities = getSpeciesByName(pokemon.species)?.abilities?.normal ?? [];
    if (normalAbilities.length < 2) {
      throw new GameRuleError("효과가 없는 것 같다.", 400);
    }

    const nextAbilityId =
      pokemon.abilityId === normalAbilities[0] ? normalAbilities[1] : normalAbilities[0];
    pokemon.abilityId = nextAbilityId;
    decrementItem(user.inventory, item);

    return {
      kind: "ability",
      item,
      itemName,
      pokemon,
      abilityId: nextAbilityId,
      message: `${getPokemonDisplayName(pokemon)}의 특성이 ${getAbilityDisplayName(nextAbilityId)}(으)로 바뀌었다!`,
    };
  }

  // 특성패치(ability-patch) — 숨은 특성이 있는 종에서 일반 특성↔숨은 특성을 토글한다. 현재 특성이
  // 숨은 특성이면 normal[0]으로 되돌리고, 아니면 숨은 특성으로 바꾼다. 숨은 특성이 없으면
  // 소모 없이 거부한다.
  if (item === "ability-patch") {
    const abilities = getSpeciesByName(pokemon.species)?.abilities;
    const hiddenAbility = abilities?.hidden;
    if (!hiddenAbility) {
      throw new GameRuleError("효과가 없는 것 같다.", 400);
    }

    const nextAbilityId =
      pokemon.abilityId === hiddenAbility ? (abilities.normal[0] ?? null) : hiddenAbility;
    pokemon.abilityId = nextAbilityId;
    decrementItem(user.inventory, item);

    return {
      kind: "ability",
      item,
      itemName,
      pokemon,
      abilityId: nextAbilityId,
      message: `${getPokemonDisplayName(pokemon)}의 특성이 ${getAbilityDisplayName(nextAbilityId)}(으)로 바뀌었다!`,
    };
  }

  // 영양제(영양제) — 지정 노력치를 +10. 252/510 상한에 걸리면 거부한다. 적용 후
  // 스탯을 재계산하되 현재 HP는 보존(클램프)한다.
  const vitaminStat = VITAMIN_STAT[item];
  if (vitaminStat) {
    const currentEvs = pokemon.evs ?? emptyEvs();
    const currentTotal = EV_STAT_KEYS.reduce((sum, key) => sum + currentEvs[key], 0);
    if (currentEvs[vitaminStat] >= EV_STAT_MAX || currentTotal >= EV_TOTAL_MAX) {
      throw new GameRuleError("이미 노력치가 최대입니다.");
    }

    pokemon.evs = applyEvGain(currentEvs, { [vitaminStat]: 10 });
    const recomputed = buildStatsForPokemon(pokemon);
    pokemon.maxHp = recomputed.maxHp;
    pokemon.hp = Math.min(pokemon.hp, pokemon.maxHp);
    pokemon.stats = recomputed.stats;
    decrementItem(user.inventory, item);

    return {
      kind: "vitamin",
      item,
      itemName,
      pokemon,
    };
  }

  const evolutionResult = getEvolutionItemUseTarget(pokemon.species, item);
  if (!evolutionResult) {
    throw new GameRuleError(`Cannot use ${itemName} on ${getPokemonDisplayName(pokemon)}.`);
  }

  const previousSpecies = pokemon.species;
  decrementItem(user.inventory, item);
  clearPendingEvolutionForPokemon(user, pokemon.uid);
  evolvePokemon(pokemon, evolutionResult.targetSpecies, evolutionResult.targetVariantId);

  if (!user.pokedex.includes(evolutionResult.targetSpecies)) {
    user.pokedex.push(evolutionResult.targetSpecies);
  }

  return {
    kind: "evolution",
    item,
    itemName,
    pokemon,
    previousSpecies,
  };
}
