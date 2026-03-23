import { Command } from "commander";
import {
  adminRepoAdd, adminRepoList, adminRepoRemove,
  adminConfigShow, adminConfigSet,
  adminStatus, adminUsers, adminPollingRun,
} from "./commands/admin.js";

const program = new Command();
program.name("pokelog-admin").description("pokelog 관리자 도구").version("0.1.0");

const repo = program.command("repo").description("Repo 관리");
repo.command("add <url>").description("Repo 등록").option("--branches <branches>", "브랜치 (콤마 구분)").action((url, opts) => adminRepoAdd(url, opts.branches));
repo.command("list").description("Repo 목록").action(adminRepoList);
repo.command("remove <url>").description("Repo 제거").action(adminRepoRemove);

const config = program.command("config").description("서버 설정");
config.command("show").description("설정 확인").action(adminConfigShow);
config.command("set <key> <value>").description("설정 변경").action(adminConfigSet);

program.command("status").description("서버 상태").action(adminStatus);
program.command("users").description("유저 목록").action(adminUsers);

const polling = program.command("polling").description("Polling 관리");
polling.command("run").description("수동 Polling 실행").action(adminPollingRun);

program.parse();
