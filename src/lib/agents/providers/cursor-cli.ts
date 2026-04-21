import { execSync } from "child_process";
import type { AgentProvider, ProviderStatus } from "../provider-interface";
import { checkCliProviderAvailable, resolveCliCommand, RUNTIME_PATH } from "../provider-cli";

const home = process.env.HOME || "";

export const cursorCliProvider: AgentProvider = {
  id: "cursor-cli",
  name: "Cursor CLI",
  type: "cli",
  icon: "terminal",
  installMessage:
    "Cursor Agent CLI not found. Install with: curl https://cursor.com/install -fsS | bash",
  installSteps: [
    {
      title: "Install Cursor CLI",
      detail: "macOS, Linux, or WSL:",
      command: "curl https://cursor.com/install -fsS | bash",
    },
    {
      title: "Add ~/.local/bin to PATH",
      detail: "Ensure the installer’s bin directory is on your PATH (see Cursor installation docs).",
    },
    {
      title: "Authenticate",
      detail:
        "For scripts, set CURSOR_API_KEY, or run agent login for an interactive session (see Cursor authentication docs).",
      link: {
        label: "Cursor CLI authentication",
        url: "https://cursor.com/docs/cli/reference/authentication",
      },
    },
    {
      title: "Verify",
      detail: "Confirm the CLI is available and signed in:",
      command: "agent whoami",
    },
  ],
  detachedPromptLaunchMode: "one-shot",
  models: [
    {
      id: "composer-2",
      name: "Composer 2",
      description: "Cursor agent default (see agent --list-models for your account)",
    },
  ],
  command: "agent",
  commandCandidates: [
    `${home}/.local/bin/agent`,
    `${home}/.local/bin/cursor-agent`,
    "/usr/local/bin/agent",
    "/opt/homebrew/bin/agent",
    "agent",
  ],

  buildArgs(prompt: string, workdir: string): string[] {
    return [
      "-p",
      "--trust",
      "--output-format",
      "stream-json",
      "--stream-partial-output",
      "--workspace",
      workdir,
      prompt,
    ];
  },

  buildOneShotInvocation(prompt: string, workdir: string) {
    return {
      command: this.command || "agent",
      args: this.buildArgs ? this.buildArgs(prompt, workdir) : [],
    };
  },

  buildSessionInvocation(prompt: string | undefined, workdir: string) {
    const args = ["--workspace", workdir];
    if (prompt?.trim()) {
      args.push(prompt.trim());
    }
    return {
      command: this.command || "agent",
      args,
    };
  },

  async isAvailable(): Promise<boolean> {
    return checkCliProviderAvailable(this);
  },

  async healthCheck(): Promise<ProviderStatus> {
    try {
      const available = await this.isAvailable();
      if (!available) {
        return {
          available: false,
          authenticated: false,
          error: this.installMessage,
        };
      }

      if (process.env.CURSOR_API_KEY?.trim()) {
        return {
          available: true,
          authenticated: true,
          version: "CURSOR_API_KEY is set",
        };
      }

      try {
        const cmd = resolveCliCommand(this);
        const output = execSync(`${cmd} whoami 2>&1`, {
          encoding: "utf8",
          env: { ...process.env, PATH: RUNTIME_PATH },
          stdio: ["ignore", "pipe", "pipe"],
          timeout: 5_000,
        }).trim();

        if (/logged\s+in/i.test(output)) {
          return {
            available: true,
            authenticated: true,
            version: output.replace(/\s+/g, " ").trim(),
          };
        }

        return {
          available: true,
          authenticated: false,
          error:
            "Cursor CLI is installed but not authenticated. Run: agent login — or set CURSOR_API_KEY for scripts.",
        };
      } catch {
        return {
          available: true,
          authenticated: false,
          error:
            "Could not verify Cursor authentication. Run: agent login — or set CURSOR_API_KEY for scripts.",
        };
      }
    } catch (error) {
      return {
        available: false,
        authenticated: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  },
};
