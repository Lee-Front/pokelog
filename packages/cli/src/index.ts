#!/usr/bin/env node
import { Command } from "commander";
import { registerCommand, loginCommand, logoutCommand } from "./commands/auth.js";
import { connectCommand } from "./commands/connect.js";
import { eggCommand } from "./commands/egg.js";
import { encounterCommand } from "./commands/encounter.js";
import { evolutionsCommand } from "./commands/evolutions.js";
import { eventsCommand } from "./commands/events.js";
import { healCommand } from "./commands/heal.js";
import { historyCommand } from "./commands/history.js";
import { inventoryCommand } from "./commands/inventory.js";
import { joinCommand } from "./commands/join.js";
import { judgeCommand } from "./commands/judge.js";
import { leaveCommand } from "./commands/leave.js";
import { nicknameCommand, profileCommand, matchCommand, unmatchCommand } from "./commands/profile.js";
import { partyCommand, partySetCommand } from "./commands/party.js";
import { pokedexCommand } from "./commands/pokedex.js";
import { pokemonCommand } from "./commands/pokemon.js";
import { pvpHistoryCommand } from "./commands/pvp-history.js";
import { fusionCommand } from "./commands/fusion.js";
import { teraCommand } from "./commands/tera.js";
import { rankingCommand } from "./commands/ranking.js";
import { regionCommand } from "./commands/region.js";
import { serversCommand } from "./commands/servers.js";
import { shopCommand, buyCommand } from "./commands/shop.js";
import { statusCommand } from "./commands/status.js";
import { storageCommand, withdrawCommand, depositCommand } from "./commands/storage.js";
import {
  tradeAcceptCommand,
  tradeCancelCommand,
  tradeCommand,
  tradeRejectCommand,
  tradeRequestCommand,
  tradeSearchCommand,
} from "./commands/trade.js";
import { useItemCommand } from "./commands/use-item.js";
import { useCommand } from "./commands/use.js";
import { whereamiCommand } from "./commands/whereami.js";
import { interactiveMode } from "./interactive.js";

if (process.argv.length <= 2) {
  interactiveMode().then(() => process.exit(0));
} else {
  const program = new Command();
  program.name("pokelog").description("PokeLog CLI").version("0.1.0");

  program.command("join <url>").description("join server").action(joinCommand);
  program.command("servers").description("list servers").action(serversCommand);
  program.command("use <name>").description("switch server").action(useCommand);
  program.command("leave [name]").description("leave server").action(leaveCommand);
  program.command("whereami").description("show current server").action(whereamiCommand);

  program.command("register").description("register").action(registerCommand);
  program.command("login").description("login").action(loginCommand);
  program.command("logout").description("logout").action(logoutCommand);

  program.command("profile [nickname]").description("show profile").action(profileCommand);
  program.command("nickname <name>").description("change nickname").action(nicknameCommand);
  program.command("match <app> <identifier>").description("legacy match").action(matchCommand);
  program.command("unmatch <app> <identifier>").description("legacy unmatch").action(unmatchCommand);

  program.command("status").description("show status").action(statusCommand);
  program.command("events").description("show events").action(eventsCommand);
  program.command("evolutions").description("resolve pending evolutions").action(evolutionsCommand);
  program.command("encounter <id>").description("open encounter").action(encounterCommand);
  program.command("history").description("show reward history").option("--limit <n>", "recent row count", "20").action((opts) => historyCommand(parseInt(opts.limit, 10) || 20));
  program.command("heal").description("heal party").action(healCommand);
  program.command("region [region]").description("show or change current region").action(regionCommand);

  const partyCmd = program.command("party").description("show party");
  partyCmd.action(partyCommand);
  partyCmd.command("set <uids...>").description("set party").action(partySetCommand);

  const storageCmd = program.command("storage").description("show storage");
  storageCmd.action(storageCommand);
  storageCmd.command("withdraw <uid>").description("withdraw pokemon").action(withdrawCommand);
  storageCmd.command("deposit <uid>").description("deposit pokemon").action(depositCommand);

  program.command("pokemon <uid>").description("pokemon detail").action(pokemonCommand);
  program.command("judge <uid>").description("appraise pokemon IVs").action(judgeCommand);
  program.command("pokedex").description("show pokedex").action(pokedexCommand);
  program.command("inventory").description("show inventory").action(inventoryCommand);
  program.command("egg").description("buy or hatch eggs").action(eggCommand);

  const tradeCmd = program.command("trade").description("list or manage trades");
  tradeCmd.action(tradeCommand);
  tradeCmd.command("search <query>").description("search trade targets").action(tradeSearchCommand);
  tradeCmd.command("request <userId> [myPokemonUid] [theirPokemonUid]").description("request a trade").action(tradeRequestCommand);
  tradeCmd.command("accept <tradeId>").description("accept a trade").action(tradeAcceptCommand);
  tradeCmd.command("reject <tradeId>").description("reject a trade").action(tradeRejectCommand);
  tradeCmd.command("cancel <tradeId>").description("cancel a trade").action(tradeCancelCommand);

  program.command("shop").description("shop").action(shopCommand);
  program.command("buy <item> [quantity]").description("buy item").action((item, qty) => buyCommand(item, parseInt(qty || "1", 10)));
  program.command("use-item <item> <pokemonUid>").description("use item").action(useItemCommand);

  program.command("ranking").description("show ranking").option("--by <criteria>", "ranking field (exp, level, pokedex, points, pvp)", "exp").action((opts) => rankingCommand(opts.by));
  program.command("pvp-history").description("show PvP match history").option("--limit <n>", "record count", "20").action((opts) => pvpHistoryCommand(parseInt(opts.limit, 10) || 20));
  program.command("fusion").description("fuse/unfuse legendary pokemon").action(fusionCommand);
  program.command("tera [pokemonUid]").description("change a pokemon's Tera type").action(teraCommand);
  program.command("connect").description("manage integrations").action(connectCommand);

  program.command("init").description("[deprecated] use join instead").requiredOption("--server <url>", "server url").action((opts) => joinCommand(opts.server));

  program.parse();
}
