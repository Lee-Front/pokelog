#!/usr/bin/env node
import { Command } from "commander";
import { initCommand } from "./commands/init.js";
import { registerCommand, loginCommand, logoutCommand } from "./commands/auth.js";
import { profileCommand, nicknameCommand, matchCommand, unmatchCommand } from "./commands/profile.js";
import { statusCommand } from "./commands/status.js";
import { eventsCommand } from "./commands/events.js";
import { encounterCommand } from "./commands/encounter.js";
import { partyCommand, partySetCommand } from "./commands/party.js";
import { storageCommand, withdrawCommand, depositCommand } from "./commands/storage.js";
import { pokemonCommand } from "./commands/pokemon.js";
import { pokedexCommand } from "./commands/pokedex.js";
import { inventoryCommand } from "./commands/inventory.js";
import { shopCommand, buyCommand } from "./commands/shop.js";
import { useItemCommand } from "./commands/use-item.js";
import { rankingCommand } from "./commands/ranking.js";

const program = new Command();
program.name("pokelog").description("커밋으로 포켓몬을 키우는 개발자 동기부여 CLI").version("0.1.0");

// Init
program.command("init").description("서버 URL 설정").requiredOption("--server <url>", "서버 URL").action((opts) => initCommand(opts.server));

// Auth
program.command("register").description("회원가입").action(registerCommand);
program.command("login").description("로그인").action(loginCommand);
program.command("logout").description("로그아웃").action(logoutCommand);

// Profile
program.command("profile [nickname]").description("프로필 확인").action(profileCommand);
program.command("nickname <name>").description("닉네임 변경").action(nicknameCommand);
program.command("match <app> <identifier>").description("매칭 정보 추가").action(matchCommand);
program.command("unmatch <app> <identifier>").description("매칭 정보 제거").action(unmatchCommand);

// Game
program.command("status").description("현황 요약").action(statusCommand);
program.command("events").description("미확인 이벤트 목록").action(eventsCommand);
program.command("encounter <id>").description("야생 조우 진입").action(encounterCommand);

// Party
const partyCmd = program.command("party").description("파티 확인");
partyCmd.action(partyCommand);
partyCmd.command("set <uids...>").description("파티 편성").action(partySetCommand);

// Storage
const storageCmd = program.command("storage").description("보관함 확인");
storageCmd.action(storageCommand);
storageCmd.command("withdraw <uid>").description("보관함에서 파티로").action(withdrawCommand);
storageCmd.command("deposit <uid>").description("파티에서 보관함으로").action(depositCommand);

// Pokemon
program.command("pokemon <uid>").description("포켓몬 상세 정보").action(pokemonCommand);
program.command("pokedex").description("도감").action(pokedexCommand);
program.command("inventory").description("인벤토리").action(inventoryCommand);

// Shop
program.command("shop").description("상점").action(shopCommand);
program.command("buy <item> [quantity]").description("아이템 구매").action((item, qty) => buyCommand(item, parseInt(qty || "1", 10)));
program.command("use <item> <pokemonUid>").description("아이템 사용").action(useItemCommand);

// Social
program.command("ranking").description("랭킹").option("--by <criteria>", "정렬 기준", "exp").action((opts) => rankingCommand(opts.by));

program.parse();
