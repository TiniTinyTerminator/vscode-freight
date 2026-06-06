import * as vscode from "vscode";
import { LanguageClient } from "vscode-languageclient/node";
import * as fs from "fs";

import { freightDocumentSelector } from "./utils";
import type { ExtensionState } from "./state";
import type { StatusController } from "./status";

const FREIGHT_LSP_PID_FILE = "/tmp/freight-lsp-debug.pid";

let client: InstanceType<typeof LanguageClient> | undefined;


async function startLanguageServer(
  context: import("vscode").ExtensionContext,
  state: ExtensionState,
  status: StatusController
) {
  const config = vscode.workspace.getConfiguration("freight");
  if (!config.get("lsp.enabled", true)) {
    status.refresh("idle");
    return;
  }

  const freight = config.get("executablePath", "freight") as string;
  const profile = config.get("lsp.profile", "dev") as string;
  const fortls = config.get("lsp.fortlsPath", "fortls") as string;
  const asmLsp = config.get("lsp.asmLspPath", "asm-lsp") as string;
  const enableFortls = config.get("lsp.enableFortls", true) as boolean;
  const enableAsmLsp = config.get("lsp.enableAsmLsp", true) as boolean;
  const logLevel = config.get("lsp.logLevel", "") as string;

  const args = ["lsp", "--profile", profile, "--fortls", fortls, "--asm-lsp", asmLsp];
  if (!enableFortls) args.push("--no-fortls");
  if (!enableAsmLsp) args.push("--no-asm-lsp");

  const env: Record<string, string> = { ...process.env as Record<string, string> };
  if (logLevel) env["FREIGHT_LOG"] = logLevel;

  const serverOptions = { command: freight, args, options: { env } };

  client = new LanguageClient(
    "freight",
    "Freight Language Server",
    serverOptions,
    {
      documentSelector: freightDocumentSelector(),
      synchronize: { fileEvents: vscode.workspace.createFileSystemWatcher("**/freight.toml") },
      outputChannelName: "Freight Language Server",
    }
  );

  context.subscriptions.push(client);
  status.refresh("building");
  try {
    await client.start();
    status.refresh("ok");
  } catch (error) {
    status.refresh("fail");
    const message = error instanceof Error ? error.message : String(error);
    vscode.window.showWarningMessage(`Could not start freight lsp: ${message}`);
  }
}

async function stopLanguageServer(_state: ExtensionState, status: StatusController) {
  if (!client) return;
  const old = client;
  client = undefined;
  try {
    await old.stop();
  } catch {
    // Client may already be stopped or failed to start.
  }
  status.refresh("idle");
}

function getClient() {
  return client;
}


async function attachFreightDebugger() {
  // Development-only helper: attach CodeLLDB to the Rust freight lsp process.
  let pid;
  try {
    const content = fs.readFileSync(FREIGHT_LSP_PID_FILE, "utf8").trim();
    const n = parseInt(content, 10);
    if (n > 0) pid = n;
  } catch {
    // Server is probably running without debug PID handoff.
  }

  if (!pid) pid = findFreightLspPid();

  if (!pid) {
    vscode.window.showWarningMessage(
      "Could not find a running freight lsp process. Start the extension host first (F5)."
    );
    return;
  }

  const folder = (vscode.workspace.workspaceFolders || [])[0];
  await vscode.debug.startDebugging(folder, {
    type: "lldb",
    request: "attach",
    name: "Attach to freight LSP (Rust)",
    pid,
    stopOnEntry: false,
    sourceLanguages: ["rust"],
  });
}

function findFreightLspPid(): number | null {
  try {
    const entries = fs.readdirSync("/proc").filter((entry) => /^\d+$/.test(entry));
    for (const entry of entries) {
      try {
        const cmdline = fs.readFileSync(`/proc/${entry}/cmdline`, "utf8");
        const parts = cmdline.split("\0").filter(Boolean);
        const exe = parts[0] || "";
        const isFreight = exe === "freight"
          || exe.endsWith("/freight")
          || exe.endsWith("/debug/freight");
        if (isFreight && parts.includes("lsp")) {
          return parseInt(entry, 10);
        }
      } catch {
        // Process ended or is not readable.
      }
    }
  } catch {
    // Non-Linux or /proc not available.
  }
  return null;
}

export {
  attachFreightDebugger,
  getClient,
  startLanguageServer,
  stopLanguageServer,
};
