import { access, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { generateSigningKey } from "@oidfed/core";
import { config } from "../src/config.js";

await mkdir(config.keyDirectory, { recursive: true });

const keyNames = config.devMockAuth
	? ["trust-anchor", "ingester", "sender"]
	: ["ingester", "sender"];
for (const name of keyNames) {
	const filePath = path.join(config.keyDirectory, `${name}.json`);
	try {
		await access(filePath);
		continue;
	} catch (error) {
		if (error.code !== "ENOENT") throw error;
	}

	const federation = await generateSigningKey("ES256");
	const keys = {
		federation: {
			publicKey: federation.publicKey,
			privateKey: federation.privateKey,
		},
	};
	if (name !== "trust-anchor") {
		const protocol = await generateSigningKey("ES256");
		keys.protocol = {
			publicKey: protocol.publicKey,
			privateKey: protocol.privateKey,
		};
	}
	await writeFile(filePath, `${JSON.stringify(keys, null, 2)}\n`, {
		flag: "wx",
		mode: 0o600,
	});
}

console.log(`Created local federation keys in ${config.keyDirectory}`);
