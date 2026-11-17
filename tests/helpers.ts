import path from "node:path";
import { openDatabase } from "../src/lib/db";

export function memoryDb() {
  return openDatabase(":memory:", path.resolve(__dirname, "../migrations"));
}
