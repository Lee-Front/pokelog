#!/usr/bin/env node
import path from "node:path";
import { fileURLToPath } from "node:url";
import { pathToFileURL } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..", "..");

// tsx를 직접 import하여 TypeScript 로더 등록
const tsxPath = path.join(root, "node_modules", "tsx", "dist", "esm", "index.mjs");
await import(pathToFileURL(tsxPath).href);

// 소스 직접 실행
const entry = pathToFileURL(path.join(__dirname, "src", "index.ts")).href;
await import(entry);
