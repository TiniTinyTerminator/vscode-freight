const vscode = require("vscode");
const { LanguageClient } = require("vscode-languageclient/node");
const { FreightExplorerProvider } = require("./explorer");

let client;
let explorerProvider;

// Persistent workspace state ─────────────────────────────────────────────────
let activeProfile = "dev";   // "dev" | "release"
let activeTarget  = null;    // string | null  — active [[bin]] name, null = auto
let activeSysroot = null;    // string | null  — sysroot path
let activeFamily  = null;    // "gcc" | "clang" | "msvc" | "nvcc" | null = auto

// Status bar items (Left, descending priority = left-to-right order) ─────────
let sbBuild;    // priority 54 — $(package) Freight [release]
let sbTarget;   // priority 53 — $(run) target
let sbSysroot;  // priority 52 — $(server-environment) sysroot
let sbFamily;   // priority 51 — $(chip) family

const FAMILIES = [
  { label: "auto",  description: "Let freight detect the compiler" },
  { label: "gcc",   description: "GCC / g++ / gfortran" },
  { label: "clang", description: "Clang / clang++ / clang-cl" },
  { label: "msvc",  description: "MSVC (cl.exe)" },
  { label: "nvcc",  description: "NVIDIA CUDA compiler" },
];

function activate(context) {
  activeProfile = context.workspaceState.get("freight.profile", "dev");
  activeTarget  = context.workspaceState.get("freight.target",  null);
  activeSysroot = context.workspaceState.get("freight.sysroot", null);
  activeFamily  = context.workspaceState.get("freight.family",  null);

  // ── Status bar ─────────────────────────────────────────────────────────────
  sbBuild = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 54);
  sbBuild.command = "freight.toggleProfile";
  sbBuild.show();
  context.subscriptions.push(sbBuild);

  sbTarget = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 53);
  sbTarget.command = "freight.pickTarget";
  sbTarget.show();
  context.subscriptions.push(sbTarget);

  sbSysroot = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 52);
  sbSysroot.command = "freight.pickSysroot";
  sbSysroot.show();
  context.subscriptions.push(sbSysroot);

  sbFamily = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 51);
  sbFamily.command = "freight.pickFamily";
  sbFamily.show();
  context.subscriptions.push(sbFamily);

  refreshStatusBars("idle");

  // ── Task tracking ──────────────────────────────────────────────────────────
  context.subscriptions.push(
    vscode.tasks.onDidStartTask((e) => {
      if (e.execution.task.source === "freight") refreshStatusBars("building");
    }),
    vscode.tasks.onDidEndTask((e) => {
      if (e.execution.task.source === "freight") refreshStatusBars("idle");
    }),
    vscode.tasks.onDidEndTaskProcess((e) => {
      if (e.execution.task.source === "freight") {
        refreshStatusBars(e.exitCode === 0 ? "ok" : "fail");
      }
    })
  );

  // ── Providers ──────────────────────────────────────────────────────────────
  const taskProvider = new FreightTaskProvider();
  context.subscriptions.push(vscode.tasks.registerTaskProvider("freight", taskProvider));
  context.subscriptions.push(vscode.debug.registerDebugConfigurationProvider("freight", new FreightDebugProvider()));
  context.subscriptions.push(vscode.debug.registerDebugAdapterDescriptorFactory("freight", new FreightDebugAdapterFactory()));

  explorerProvider = new FreightExplorerProvider(context);
  const explorerView = vscode.window.createTreeView("freight.explorerView", {
    treeDataProvider: explorerProvider,
    showCollapseAll: true,
  });
  context.subscriptions.push(explorerView);

  // Refresh target bar when manifest changes (bins may appear/disappear)
  explorerProvider.onDidRefresh(() => refreshStatusBars("idle"));

  // ── Commands ───────────────────────────────────────────────────────────────
  context.subscriptions.push(
    vscode.commands.registerCommand("freight.restartLanguageServer", async () => {
      await stopLanguageServer();
      await startLanguageServer(context);
    }),
    vscode.commands.registerCommand("freight.generateCompileCommands", async () => {
      await runFreightCommand(["compile-commands"]);
    }),
    vscode.commands.registerCommand("freight.run", async () => {
      await vscode.debug.startDebugging(getActiveWorkspaceFolder(), {
        type: "freight", request: "launch", name: "Freight: Run",
        mode: "run", release: activeProfile === "release",
        cwd: "${workspaceFolder}", args: []
      });
    }),
    vscode.commands.registerCommand("freight.debug", async () => {
      await vscode.debug.startDebugging(getActiveWorkspaceFolder(), {
        type: "freight", request: "launch", name: "Freight: Debug",
        mode: "debug", cwd: "${workspaceFolder}", args: []
      });
    }),
    vscode.commands.registerCommand("freight.toggleProfile", async () => {
      const profiles = explorerProvider?.getProfiles() ?? ["dev", "release"];
      const descriptions = { dev: "Debug build (default)", release: "Optimised release build" };
      const items = profiles.map((p) => ({
        label: (p === activeProfile ? "$(check) " : "        ") + p,
        description: descriptions[p] ?? "Custom profile",
        value: p,
      }));
      const choice = await vscode.window.showQuickPick(items, {
        placeHolder: `Active profile: ${activeProfile}`,
      });
      if (choice) {
        activeProfile = choice.value;
        await context.workspaceState.update("freight.profile", activeProfile);
        refreshStatusBars("idle");
      }
    }),
    vscode.commands.registerCommand("freight.pickTarget", async () => {
      const bins = explorerProvider?.getBinNames() ?? [];
      const items = [
        { label: "$(search) auto", description: "Let freight select the binary", value: null },
        ...bins.map((b) => ({ label: `$(run) ${b}`, description: "", value: b })),
      ];
      const choice = await vscode.window.showQuickPick(items, {
        placeHolder: `Active target: ${activeTarget ?? "auto"}`,
      });
      if (choice !== undefined) {
        activeTarget = choice.value;
        await context.workspaceState.update("freight.target", activeTarget);
        refreshStatusBars("idle");
      }
    }),
    vscode.commands.registerCommand("freight.pickSysroot", async () => {
      const input = await vscode.window.showInputBox({
        prompt: "Sysroot path (leave empty to clear)",
        value: activeSysroot ?? "",
        placeHolder: "/path/to/sysroot or empty to disable",
      });
      if (input !== undefined) {
        activeSysroot = input.trim() || null;
        await context.workspaceState.update("freight.sysroot", activeSysroot);
        refreshStatusBars("idle");
      }
    }),
    vscode.commands.registerCommand("freight.pickFamily", async () => {
      const items = FAMILIES.map((f) => ({
        ...f,
        label: (f.label === (activeFamily ?? "auto") ? "$(check) " : "        ") + f.label,
        value: f.label === "auto" ? null : f.label,
      }));
      const choice = await vscode.window.showQuickPick(items, {
        placeHolder: `Compiler family: ${activeFamily ?? "auto"}`,
      });
      if (choice !== undefined) {
        activeFamily = choice.value;
        await context.workspaceState.update("freight.family", activeFamily);
        refreshStatusBars("idle");
      }
    }),
    vscode.commands.registerCommand("freight.refreshExplorer", () => {
      explorerProvider.refresh();
    }),
    vscode.commands.registerCommand("freight.openDepDoc", (name) => {
      if (name) {
        vscode.env.openExternal(vscode.Uri.parse(`https://freight.dev/packages/${name}`));
      }
    }),
    vscode.commands.registerCommand("freight.runTarget", async (binName) => {
      await vscode.debug.startDebugging(getActiveWorkspaceFolder(), {
        type: "freight", request: "launch", name: `Freight: Run ${binName}`,
        mode: "run", release: activeProfile === "release", bin: binName,
        cwd: "${workspaceFolder}", args: []
      });
    }),
    vscode.commands.registerCommand("freight.debugTarget", async (binName) => {
      await vscode.debug.startDebugging(getActiveWorkspaceFolder(), {
        type: "freight", request: "launch", name: `Freight: Debug ${binName}`,
        mode: "debug", bin: binName, cwd: "${workspaceFolder}", args: []
      });
    }),
    vscode.workspace.onDidChangeConfiguration(async (event) => {
      if (event.affectsConfiguration("freight.lsp") || event.affectsConfiguration("freight.executablePath")) {
        await stopLanguageServer();
        await startLanguageServer(context);
      }
    })
  );

  startLanguageServer(context);
}

// ── Status bar rendering ─────────────────────────────────────────────────────

function refreshStatusBars(state) {
  // Build / profile bar
  const profile = activeProfile === "release" ? " [release]" : "";
  switch (state) {
    case "building":
      sbBuild.text = `$(sync~spin) Freight${profile}`;
      sbBuild.tooltip = "Freight — building…";
      break;
    case "ok":
      sbBuild.text = `$(check) Freight${profile}`;
      sbBuild.tooltip = "Freight — last build succeeded. Click to switch profile.";
      break;
    case "fail":
      sbBuild.text = `$(error) Freight${profile}`;
      sbBuild.tooltip = "Freight — last build failed. Click to switch profile.";
      break;
    default:
      sbBuild.text = `$(package) Freight${profile}`;
      sbBuild.tooltip = "Freight — click to switch profile (dev / release)";
  }

  // Target bar
  sbTarget.text = `$(run) ${activeTarget ?? "[no target]"}`;
  sbTarget.tooltip = activeTarget
    ? `Active target: ${activeTarget} — click to change`
    : "No target selected — click to pick a binary";

  // Sysroot bar
  if (activeSysroot) {
    const short = activeSysroot.length > 24 ? `…${activeSysroot.slice(-22)}` : activeSysroot;
    sbSysroot.text = `$(server-environment) ${short}`;
    sbSysroot.tooltip = `Sysroot: ${activeSysroot} — click to change`;
  } else {
    sbSysroot.text = "$(server-environment) [no sysroot]";
    sbSysroot.tooltip = "No sysroot — click to set cross-compile sysroot";
  }

  // Family bar
  sbFamily.text = `$(chip) ${activeFamily ?? "auto"}`;
  sbFamily.tooltip = activeFamily
    ? `Compiler family: ${activeFamily} — click to change`
    : "Compiler family: auto-detect — click to override";
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function getActiveWorkspaceFolder() {
  const active = vscode.window.activeTextEditor && vscode.window.activeTextEditor.document.uri;
  if (active) return vscode.workspace.getWorkspaceFolder(active);
  return (vscode.workspace.workspaceFolders || [])[0];
}

async function deactivate() {
  await stopLanguageServer();
}

async function startLanguageServer(context) {
  const config = vscode.workspace.getConfiguration("freight");
  if (!config.get("lsp.enabled", true)) {
    refreshStatusBars("idle");
    return;
  }

  const freight = config.get("executablePath", "freight");
  const args = ["lsp"];

  appendIfChanged(args, "--profile", config.get("lsp.profile", "dev"), "dev");
  appendIfChanged(args, "--clangd", config.get("lsp.clangdPath", "clangd"), "clangd");
  appendIfChanged(args, "--fortls", config.get("lsp.fortlsPath", "fortls"), "fortls");
  appendIfChanged(args, "--asm-lsp", config.get("lsp.asmLspPath", "asm-lsp"), "asm-lsp");

  if (!config.get("lsp.enableClangd", true))  args.push("--no-clangd");
  if (!config.get("lsp.enableFortls", true))   args.push("--no-fortls");
  if (!config.get("lsp.enableAsmLsp", true))   args.push("--no-asm-lsp");

  client = new LanguageClient(
    "freight", "Freight",
    { command: freight, args },
    {
      documentSelector: freightDocumentSelector(),
      synchronize: { fileEvents: vscode.workspace.createFileSystemWatcher("**/freight.toml") },
      outputChannelName: "Freight Language Server"
    }
  );

  context.subscriptions.push(client);
  refreshStatusBars("building");
  try {
    await client.start();
    refreshStatusBars("ok");
  } catch (error) {
    refreshStatusBars("fail");
    vscode.window.showWarningMessage(`Could not start freight lsp: ${error.message || error}`);
  }
}

function appendIfChanged(args, flag, value, defaultValue) {
  if (value && value !== defaultValue) args.push(flag, value);
}

async function stopLanguageServer() {
  if (!client) return;
  const old = client;
  client = undefined;
  await old.stop();
  refreshStatusBars("idle");
}

function freightDocumentSelector() {
  const sourcePatterns = [
    "**/*.{c,h,cc,hh,cpp,hpp,cxx,hxx,c++,h++,cppm,ixx,mpp}",
    "**/*.{cu,cuh,hip,cl,ispc,m,mm}",
    "**/*.{f,for,ftn,f77,f66,f90,f95,f03,f08,f18}",
    "**/*.{F,FOR,FTN,F77,F66,F90,F95,F03,F08,F18}",
    "**/*.{asm,nasm,s,S}"
  ];
  return [
    { language: "freight-manifest",   scheme: "file" },
    { language: "c",                  scheme: "file" },
    { language: "cpp",                scheme: "file" },
    { language: "cuda-cpp",           scheme: "file" },
    { language: "objective-c",        scheme: "file" },
    { language: "objective-cpp",      scheme: "file" },
    { language: "fortran",            scheme: "file" },
    { language: "FortranFreeForm",    scheme: "file" },
    { language: "FortranFixedForm",   scheme: "file" },
    { language: "asm",                scheme: "file" },
    { language: "nasm",               scheme: "file" },
    { language: "gas",                scheme: "file" },
    ...sourcePatterns.map((pattern) => ({ scheme: "file", pattern }))
  ];
}

async function runFreightCommand(args) {
  const folder = vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders[0];
  if (!folder) {
    vscode.window.showWarningMessage("Open a Freight workspace first.");
    return;
  }
  const config = vscode.workspace.getConfiguration("freight");
  const execution = new vscode.ShellExecution(config.get("executablePath", "freight"), args, {
    cwd: folder.uri.fsPath
  });
  const task = new vscode.Task(
    { type: "freight", command: args.join(" ") },
    folder, `freight ${args.join(" ")}`, "freight", execution, "$freight"
  );
  await vscode.tasks.executeTask(task);
}

// ── Task provider ─────────────────────────────────────────────────────────────

class FreightTaskProvider {
  provideTasks() {
    return (vscode.workspace.workspaceFolders || []).flatMap(freightTasks);
  }
  resolveTask(task) {
    const command = task.definition.command;
    const folder = task.scope?.uri ? task.scope : (vscode.workspace.workspaceFolders || [])[0];
    if (!folder || !command) return undefined;
    return makeFreightTask(folder, command, task.definition.args || []);
  }
}

// ── Debug provider ────────────────────────────────────────────────────────────

class FreightDebugProvider {
  resolveDebugConfiguration(folder, config) {
    const workspaceFolder = folder || getActiveWorkspaceFolder();
    if (!workspaceFolder) {
      vscode.window.showWarningMessage("Open a Freight workspace before launching a Freight debug configuration.");
      return undefined;
    }
    const mode = config.mode || "run";
    return {
      ...config,
      type: "freight",
      request: config.request || "launch",
      name: config.name || (mode === "debug" ? "Freight: Debug" : "Freight: Run"),
      mode,
      // Inject status bar values as defaults (explicit launch config overrides them)
      bin:     config.bin     ?? activeTarget  ?? undefined,
      sysroot: config.sysroot ?? activeSysroot ?? undefined,
      family:  config.family  ?? activeFamily  ?? undefined,
      cwd: resolveCwd(config.cwd, workspaceFolder),
      args: Array.isArray(config.args) ? config.args : []
    };
  }

  async provideDebugConfigurations() {
    const bins = explorerProvider?.getBinNames() ?? [];
    const configs = [
      { name: "Freight: Run",   type: "freight", request: "launch", mode: "run",   cwd: "${workspaceFolder}", args: [] },
      { name: "Freight: Debug", type: "freight", request: "launch", mode: "debug", cwd: "${workspaceFolder}", args: [] },
    ];
    for (const bin of bins) {
      configs.push({ name: `Freight: Debug ${bin}`, type: "freight", request: "launch", mode: "debug", bin, cwd: "${workspaceFolder}", args: [] });
    }
    return configs;
  }
}

// ── Debug adapter factory ─────────────────────────────────────────────────────

class FreightDebugAdapterFactory {
  async createDebugAdapterDescriptor(session) {
    const config = session.configuration;
    const freight = vscode.workspace.getConfiguration("freight").get("executablePath", "freight");
    const cwd = config.cwd;

    if (config.mode === "run") {
      const folder = getActiveWorkspaceFolder();
      if (folder) {
        const resolvedConfig = await resolveBin(config);
        if (!resolvedConfig) return undefined;
        await runFreightCommand(buildRunArgs(resolvedConfig));
      }
      return undefined;
    }

    const resolvedConfig = await resolveBin(config);
    if (!resolvedConfig) return undefined;

    const dapArgs = ["dap"];
    if (resolvedConfig.request === "attach") dapArgs.push("--attach");

    return new vscode.DebugAdapterExecutable(freight, dapArgs, cwd ? { cwd } : undefined);
  }
}

// ── Launch config helpers ─────────────────────────────────────────────────────

async function resolveBin(config) {
  if (config.bin || config.request === "attach") return config;
  const bins = explorerProvider?.getBinNames() ?? [];
  if (bins.length <= 1) return config;
  const choice = await vscode.window.showQuickPick(
    bins.map((b) => ({ label: b })),
    { placeHolder: "Select binary to run" }
  );
  if (!choice) return null;
  return { ...config, bin: choice.label };
}

function buildRunArgs(config) {
  const args = ["run"];
  if (config.release) args.push("--release");
  if (config.package) args.push("-p", config.package);
  if (config.bin)     args.push("--bin", config.bin);
  if (Array.isArray(config.features) && config.features.length > 0) {
    args.push("--features", config.features.join(","));
  }
  if (config.noDefaultFeatures) args.push("--no-default-features");
  if (Array.isArray(config.args) && config.args.length > 0) {
    args.push("--", ...config.args);
  }
  return args;
}

function resolveCwd(cwd, folder) {
  if (!cwd || cwd === "${workspaceFolder}") return folder.uri.fsPath;
  return cwd.replace("${workspaceFolder}", folder.uri.fsPath);
}

// ── Task helpers ─────────────────────────────────────────────────────────────

function freightTasks(folder) {
  return [
    makeFreightTask(folder, "build", [],              vscode.TaskGroup.Build),
    makeFreightTask(folder, "build", ["--release"]),
    makeFreightTask(folder, "run",   []),
    makeFreightTask(folder, "test",  [],              vscode.TaskGroup.Test),
    makeFreightTask(folder, "fetch", []),
    makeFreightTask(folder, "clean", []),
    makeFreightTask(folder, "compile-commands", []),
  ];
}

function makeFreightTask(folder, command, args, group) {
  const config = vscode.workspace.getConfiguration("freight");
  const freight = config.get("executablePath", "freight");
  const label = `freight ${[command, ...args].join(" ")}`.trim();
  const execution = new vscode.ShellExecution(freight, [command, ...args], { cwd: folder.uri.fsPath });
  const task = new vscode.Task(
    { type: "freight", command, args }, folder, label, "freight", execution, "$freight"
  );
  if (group) task.group = group;
  return task;
}

module.exports = { activate, deactivate };
