import { readFile } from "node:fs/promises";
import path from "node:path";
import { config } from "./config.js";

export async function loadKeys(name) {
	const filePath = path.join(config.keyDirectory, `${name}.json`);
	try {
		return JSON.parse(await readFile(filePath, "utf8"));
	} catch (error) {
		if (error.code === "ENOENT") {
			throw new Error("Demo keys are missing. Run `npm run setup` first.", {
				cause: error,
			});
		}
		throw error;
	}
}
