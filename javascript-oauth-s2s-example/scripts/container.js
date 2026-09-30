import { access } from "node:fs/promises";
import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { config } from "../src/config.js";

const children = new Set();
let shuttingDown = false;
let resolveChildrenExited;
const childrenExited = new Promise((resolve) => {
	resolveChildrenExited = resolve;
});

function stopChildren(signal, exitCode) {
	if (shuttingDown) return;
	shuttingDown = true;
	process.exitCode = exitCode;
	for (const child of children) child.kill(signal);
	const forceStop = setTimeout(() => {
		for (const child of children) child.kill("SIGKILL");
	}, 10_000);
	forceStop.unref();
	if (children.size === 0) resolveChildrenExited();
}

function launch(command, args) {
	const child = spawn(command, args, {
		cwd: process.cwd(),
		env: process.env,
		stdio: "inherit",
	});
	children.add(child);
	child.on("error", (error) => {
		console.error(`Could not start ${command}:`, error);
		stopChildren("SIGTERM", 1);
	});
	child.on("exit", (code, signal) => {
		children.delete(child);
		if (!shuttingDown) {
			console.error(
				`${command} exited unexpectedly (${signal ?? code ?? "unknown status"}).`,
			);
			stopChildren("SIGTERM", code ?? 1);
		}
		if (children.size === 0) resolveChildrenExited();
	});
	return child;
}

async function waitForTrustAnchor(caddy) {
	const trustAnchorCertificate =
		"/data/caddy/pki/authorities/local/root.crt";
	for (let attempt = 0; attempt < 120; attempt += 1) {
		if (shuttingDown || caddy.exitCode !== null) {
			throw new Error("Caddy exited before its local TLS authority was ready.");
		}
		try {
			await access(trustAnchorCertificate);
			process.env.NODE_EXTRA_CA_CERTS = trustAnchorCertificate;
			return;
		} catch (error) {
			if (error.code !== "ENOENT") throw error;
			await delay(250);
		}
	}
	throw new Error("Timed out waiting for Caddy's local TLS authority.");
}

process.on("SIGINT", () => stopChildren("SIGINT", 0));
process.on("SIGTERM", () => stopChildren("SIGTERM", 0));

try {
	if (config.devMockAuth) {
		const caddy = launch("/usr/bin/caddy", [
			"run",
			"--config",
			"Caddyfile.container",
			"--adapter",
			"caddyfile",
		]);
		await waitForTrustAnchor(caddy);
	}
	if (shuttingDown) {
		await childrenExited;
	} else {
		launch("sh", ["scripts/start-ingester.sh"]);
		launch("sh", ["scripts/start-sender.sh"]);
		await childrenExited;
	}
} catch (error) {
	console.error(error);
	stopChildren("SIGTERM", 1);
	await childrenExited;
}
