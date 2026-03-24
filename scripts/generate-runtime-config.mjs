import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const outputPath = path.join(process.cwd(), "frontend", "js", "runtime-config.js");
const apiBase = (process.env.EVGO_API_BASE || "").trim();
const socketBase = (process.env.EVGO_SOCKET_BASE || apiBase).trim();
const isVercelBuild = process.env.VERCEL === "1";

if (isVercelBuild && !apiBase) {
    throw new Error("EVGO_API_BASE is required for Vercel production builds.");
}

const fileContents = `(() => {
    const isLocalHost = ["127.0.0.1", "localhost"].includes(window.location.hostname);

    window.__EVGO_CONFIG__ = {
        API_BASE: ${JSON.stringify(apiBase)} || (isLocalHost ? "http://127.0.0.1:5000" : ""),
        SOCKET_BASE: ${JSON.stringify(socketBase)} || (isLocalHost ? "http://127.0.0.1:5000" : ""),
        ...(window.__EVGO_CONFIG__ || {}),
    };
})();
`;

await mkdir(path.dirname(outputPath), { recursive: true });
await writeFile(outputPath, fileContents, "utf8");
console.log(`Wrote runtime config to ${outputPath}`);
