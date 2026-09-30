import { Readable } from "node:stream";

const HOP_BY_HOP_HEADERS = new Set([
	"connection",
	"host",
	"keep-alive",
	"proxy-connection",
	"te",
	"trailer",
	"transfer-encoding",
	"upgrade",
]);

export function toWebRequest(request) {
	const headers = new Headers();
	for (const [name, value] of Object.entries(request.headers)) {
		if (HOP_BY_HOP_HEADERS.has(name) || value === undefined) continue;
		if (Array.isArray(value)) {
			for (const item of value) headers.append(name, item);
		} else {
			headers.set(name, value);
		}
	}
	const hasBody = !["GET", "HEAD"].includes(request.method);
	return new Request(
		new URL(request.originalUrl, `https://${request.headers.host}`),
		{
			method: request.method,
			headers,
			...(hasBody
				? { body: Readable.toWeb(request), duplex: "half" }
				: {}),
		},
	);
}

export async function sendWebResponse(response, expressResponse) {
	expressResponse.status(response.status);
	response.headers.forEach((value, name) => {
		expressResponse.setHeader(name, value);
	});
	expressResponse.send(Buffer.from(await response.arrayBuffer()));
}
