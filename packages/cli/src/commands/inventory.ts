import { DIM, RED, GRN, YEL, CYN, BLD, R } from "../ui/colors.js";
import { apiGet, apiPost } from "../api-client.js";
import { fetchArt, fetchBallArt } from "../ui/display.js";
import { enterRaw, waitKey } from "../ui/raw-mode.js";
import { padRight, artToLines, mergeSideBySide } from "../ui/text.js";
import { clearScreen } from "../ui/screen.js";

type InventoryKind = "ball" | "healing" | "evolution" | "held" | "other";

type PartyMon = {
  uid: string;
  species: string;
  level: number;
  hp: number;
  maxHp: number;
  heldItem?: string | null;
};

type InventoryCatalogEntry = {
  name: string;
  kind: InventoryKind;
  description: string;
  canUseDirectly: boolean;
  canHold: boolean;
};

type InventoryResponse = {
  inventory: Record<string, number>;
  catalog: Record<string, InventoryCatalogEntry>;
};

const CATEGORY_ORDER = [
  { label: "Balls", kind: "ball" },
  { label: "Healing", kind: "healing" },
  { label: "Evolution", kind: "evolution" },
  { label: "Held", kind: "held" },
  { label: "Other", kind: "other" },
] as const;

const BALL_ART: Record<string, string> = {
  pokeball: "MonsterBall",
  safariball: "SafariBall",
  greatball: "GreatBall",
  ultraball: "UltraBall",
  masterball: "MasterBall",
};

const artCache = new Map<string, string | null>();

function formatSlug(value: string): string {
  return value
    .split("-")
    .map((part) => (part ? part[0].toUpperCase() + part.slice(1) : part))
    .join(" ");
}

function getCatalogEntry(itemId: string, catalog: Record<string, InventoryCatalogEntry>): InventoryCatalogEntry | undefined {
  return catalog[itemId];
}

function getItemName(itemId: string, catalog: Record<string, InventoryCatalogEntry>): string {
  return getCatalogEntry(itemId, catalog)?.name ?? formatSlug(itemId);
}

function getItemDesc(itemId: string, catalog: Record<string, InventoryCatalogEntry>): string {
  return getCatalogEntry(itemId, catalog)?.description ?? "";
}

function getItemKind(itemId: string, catalog: Record<string, InventoryCatalogEntry>): InventoryKind | undefined {
  return getCatalogEntry(itemId, catalog)?.kind;
}

function isUsable(itemId: string, catalog: Record<string, InventoryCatalogEntry>): boolean {
  const entry = getCatalogEntry(itemId, catalog);
  return Boolean(entry?.canUseDirectly || entry?.canHold);
}

async function getCachedArt(key: string, fetcher: () => Promise<string | null>): Promise<string | null> {
  if (artCache.has(key)) {
    return artCache.get(key)!;
  }

  const art = await fetcher();
  artCache.set(key, art);
  return art;
}

function makeHealingArt(label: string): string {
  const text = label.slice(0, 10).padEnd(10);
  return [
    `${DIM}     .-.${R}`,
    `${DIM}    ( + )${R}`,
    `${DIM}   /   \\${R}`,
    `${GRN}  |${BLD}${text}${R}${GRN}|${R}`,
    `${DIM}   \\   /${R}`,
    `${DIM}    '-'${R}`,
  ].join("\n");
}

function getCategoryItems(
  inventory: Record<string, number>,
  catalog: Record<string, InventoryCatalogEntry>,
  kind: InventoryKind,
): [string, number][] {
  return Object.entries(inventory)
    .filter(([itemId, count]) => count > 0 && getItemKind(itemId, catalog) === kind)
    .sort((a, b) => getItemName(a[0], catalog).localeCompare(getItemName(b[0], catalog)));
}

function buildItemsLines(
  catIdx: number,
  items: [string, number][],
  itemIdx: number,
  art: string | null,
  message: string,
  catalog: Record<string, InventoryCatalogEntry>,
): string[] {
  const tabs = CATEGORY_ORDER.map((category, index) => (
    index === catIdx ? `${CYN}${BLD}${category.label}${R}` : `${DIM}${category.label}${R}`
  )).join(` ${DIM}|${R} `);

  const left = items.length === 0
    ? [`  ${DIM}No items in this category.${R}`]
    : items.map(([itemId, count], index) => {
      const cursor = index === itemIdx ? `${CYN}>${R}` : " ";
      const label = index === itemIdx ? `${BLD}${getItemName(itemId, catalog)}${R}` : getItemName(itemId, catalog);
      return `${cursor} ${padRight(label, 20)} ${DIM}x${count}${R}`;
    });

  const selectedItem = items[itemIdx]?.[0] ?? "";
  const selectedEntry = selectedItem ? getCatalogEntry(selectedItem, catalog) : undefined;
  const desc = selectedEntry?.description ? `${DIM}${selectedEntry.description}${R}` : "";

  const lines = [
    "",
    `  ${BLD}Inventory${R}`,
    "  " + "-".repeat(54),
    `  ${DIM}Left/Right: Category  Up/Down: Move  Enter: Select  Esc: Back${R}`,
    `  ${tabs}`,
    "",
    ...mergeSideBySide(left, artToLines(art)),
    "",
  ];

  if (desc) {
    lines.push(`  ${desc}`, "");
  }
  if (message) {
    lines.push(`  ${message}`);
  }
  return lines;
}

function buildTargetsLines(
  itemId: string,
  itemCount: number,
  targets: PartyMon[],
  targetIdx: number,
  art: string | null,
  message: string,
  catalog: Record<string, InventoryCatalogEntry>,
): string[] {
  const itemKind = getItemKind(itemId, catalog);
  const instructions = itemKind === "healing"
    ? "Up/Down: Target  Enter: Heal  Esc: Back"
    : itemKind === "held"
      ? "Up/Down: Target  Enter: Equip item  Esc: Back"
      : "Up/Down: Target  Enter: Use item  Esc: Back";

  const left = [
    `${YEL}Select Pokemon${R}`,
    ...targets.map((pokemon, index) => {
      const cursor = index === targetIdx ? `${CYN}>${R}` : " ";
      const name = index === targetIdx ? `${BLD}${pokemon.species}${R}` : pokemon.species;
      const heldLabel = pokemon.heldItem ? ` ${DIM}@ ${getItemName(pokemon.heldItem, catalog)}${R}` : "";
      const hpLabel = `${DIM}${pokemon.hp}/${pokemon.maxHp}${R}`;
      return `${cursor} ${padRight(name, 16)} ${padRight(hpLabel, 14)} ${DIM}Lv.${pokemon.level}${R}${heldLabel}`;
    }),
  ];

  const lines = [
    "",
    `  ${BLD}${getItemName(itemId, catalog)}${R} ${DIM}(x${itemCount})${R}`,
    "  " + "-".repeat(54),
    `  ${DIM}${instructions}${R}`,
    "",
    ...mergeSideBySide(left, artToLines(art)),
    "",
  ];

  if (message) {
    lines.push(`  ${message}`);
  }
  return lines;
}

function getTargetsForItem(
  itemId: string,
  party: PartyMon[],
  catalog: Record<string, InventoryCatalogEntry>,
): PartyMon[] {
  return getItemKind(itemId, catalog) === "healing"
    ? party.filter((pokemon) => pokemon.hp < pokemon.maxHp)
    : party;
}

async function getItemArt(itemId: string, catalog: Record<string, InventoryCatalogEntry>): Promise<string | null> {
  const kind = getItemKind(itemId, catalog);
  if (!kind) {
    return null;
  }

  if (kind === "ball" && BALL_ART[itemId]) {
    return getCachedArt(itemId, () => fetchBallArt(BALL_ART[itemId]));
  }

  if (kind === "healing") {
    const label = getItemName(itemId, catalog);
    const art = makeHealingArt(label);
    artCache.set(itemId, art);
    return art;
  }

  return null;
}

function resolveItemAction(itemId: string, catalog: Record<string, InventoryCatalogEntry>): string {
  return getItemKind(itemId, catalog) === "held"
    ? "/api/game/items/equip"
    : "/api/shop/use";
}

export async function inventoryCommand() {
  enterRaw();

  type Mode = "items" | "targets";

  let mode: Mode = "items";
  let categoryIndex = 0;
  let itemIndex = 0;
  let targetIndex = 0;
  let selectedItem = "";
  let message = "";
  let currentArt: string | null = null;
  let lastArtKey = "";
  let inventory: Record<string, number> = {};
  let catalog: Record<string, InventoryCatalogEntry> = {};
  let party: PartyMon[] = [];
  let targets: PartyMon[] = [];

  async function refreshInventory() {
    const response = await apiGet("/api/game/inventory");
    if (response.ok) {
      const data = response.data as InventoryResponse;
      inventory = data.inventory ?? {};
      catalog = data.catalog ?? {};
    }
  }

  async function refreshParty() {
    const response = await apiGet("/api/game/party");
    if (response.ok) {
      party = response.data.party as PartyMon[];
    }
  }

  await Promise.all([refreshInventory(), refreshParty()]);

  while (true) {
    if (mode === "items") {
      const category = CATEGORY_ORDER[categoryIndex];
      const categoryItems = getCategoryItems(inventory, catalog, category.kind);
      itemIndex = Math.min(itemIndex, Math.max(0, categoryItems.length - 1));

      const artKey = categoryItems[itemIndex]?.[0] ?? "";
      if (artKey !== lastArtKey) {
        currentArt = artKey ? await getItemArt(artKey, catalog) : null;
        lastArtKey = artKey;
      }

      clearScreen();
      process.stdout.write(
        buildItemsLines(categoryIndex, categoryItems, itemIndex, currentArt, message, catalog).join("\n"),
      );
      message = "";

      const key = await waitKey();
      if (key === "\x03") {
        process.stdout.write("\x1b[?25h");
        process.exit(0);
      }
      if (key === "\x1b" || key === "q") {
        break;
      }
      if (key === "\x1b[D") {
        categoryIndex = (categoryIndex - 1 + CATEGORY_ORDER.length) % CATEGORY_ORDER.length;
        itemIndex = 0;
        lastArtKey = "";
        currentArt = null;
        /* clearScreen handles redraw */
        continue;
      }
      if (key === "\x1b[C") {
        categoryIndex = (categoryIndex + 1) % CATEGORY_ORDER.length;
        itemIndex = 0;
        lastArtKey = "";
        currentArt = null;
        /* clearScreen handles redraw */
        continue;
      }
      if (key === "\x1b[A" && itemIndex > 0) {
        itemIndex -= 1;
        continue;
      }
      if (key === "\x1b[B" && itemIndex < categoryItems.length - 1) {
        itemIndex += 1;
        continue;
      }
      if (key !== "\r") {
        continue;
      }

      const [itemId] = categoryItems[itemIndex] ?? [];
      if (!itemId) {
        continue;
      }
      if (!isUsable(itemId, catalog)) {
        message = `${DIM}This item cannot be used from inventory.${R}`;
        continue;
      }

      await refreshParty();
      targets = getTargetsForItem(itemId, party, catalog);
      if (targets.length === 0) {
        message = getItemKind(itemId, catalog) === "healing"
          ? `${DIM}No party Pokemon need healing.${R}`
          : `${DIM}No party Pokemon available for this item.${R}`;
        continue;
      }

      selectedItem = itemId;
      targetIndex = 0;
      lastArtKey = "";
      currentArt = null;
      mode = "targets";
      continue;
    }

    targetIndex = Math.min(targetIndex, Math.max(0, targets.length - 1));

    const artKey = targets[targetIndex]?.species ?? "";
    if (artKey !== lastArtKey) {
      currentArt = await getCachedArt(artKey, () => fetchArt(artKey));
      lastArtKey = artKey;
    }

    const itemCount = inventory[selectedItem] ?? 0;
    clearScreen();
    process.stdout.write(
      buildTargetsLines(selectedItem, itemCount, targets, targetIndex, currentArt, message, catalog).join("\n"),
    );
    message = "";

    const key = await waitKey();
    if (key === "\x03") {
      process.stdout.write("\x1b[?25h");
      process.exit(0);
    }
    if (key === "\x1b" || key === "q") {
      mode = "items";
      lastArtKey = "";
      currentArt = null;
      continue;
    }
    if (key === "\x1b[A" && targetIndex > 0) {
      targetIndex -= 1;
      continue;
    }
    if (key === "\x1b[B" && targetIndex < targets.length - 1) {
      targetIndex += 1;
      continue;
    }
    if (key !== "\r") {
      continue;
    }

    const target = targets[targetIndex];
    if (!target) {
      continue;
    }

    const response = await apiPost(resolveItemAction(selectedItem, catalog), {
      item: selectedItem,
      pokemonUid: target.uid,
    });
    if (!response.ok) {
      message = `${RED}${response.data.error}${R}`;
      continue;
    }

    message = `${GRN}${response.data.message ?? `${getItemName(selectedItem, catalog)} used successfully.`}${R}`;
    await Promise.all([refreshInventory(), refreshParty()]);
    if ((inventory[selectedItem] ?? 0) <= 0) {
      mode = "items";
      lastArtKey = "";
      currentArt = null;
      continue;
    }

    targets = getTargetsForItem(selectedItem, party, catalog);
    if (targets.length === 0) {
      mode = "items";
      lastArtKey = "";
      currentArt = null;
      continue;
    }

    targetIndex = Math.min(targetIndex, targets.length - 1);
  }

  process.stdout.write("\x1b[?25h");
}
