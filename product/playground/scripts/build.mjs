import { cp, mkdir, rm } from "node:fs/promises";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const source = path.join(root, "src");
const dist = path.join(root, "dist");

await rm(dist, { recursive: true, force: true });
await mkdir(dist, { recursive: true });
await cp(source, dist, { recursive: true });
