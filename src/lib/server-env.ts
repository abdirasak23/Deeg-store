import "server-only";
import path from "node:path";
import { existsSync } from "node:fs";
import { loadEnvConfig } from "@next/env";

let loaded = false;
export function serverEnv(name: string): string {
  if (!loaded) {
    loaded = true;
    let dir = process.cwd();
    for (let i = 0; i < 5; i += 1) {
      if (existsSync(path.join(dir, ".env.local")) && existsSync(path.join(dir, "store-panel"))) {
        loadEnvConfig(dir, process.env.NODE_ENV !== "production", undefined, true);
        break;
      }
      const parent = path.dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
  }
  return process.env[name]?.trim() ?? "";
}
