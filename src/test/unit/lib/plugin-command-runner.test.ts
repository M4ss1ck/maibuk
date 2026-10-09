import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useModalStore } from "@/components/ui/modal-store";
import { EMPTY_TUTORIAL_PROGRESS, useTutorialStore } from "@/features/tutorial/store";
import { commandState, registerCommandSource, runCommand } from "@/lib/command-runner";
import { registerPluginCommands } from "@/lib/shortcut-registry";

const cleanups: Array<() => void> = [];
afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()?.();
});

const commandId = "plugin.echoes.showReport" as const;

beforeEach(() => {
  useModalStore.setState({ modalIds: [], openCount: 0, closers: {} });
  useTutorialStore.setState({ progress: EMPTY_TUTORIAL_PROGRESS, status: "idle", run: null });
  cleanups.push(
    registerPluginCommands("echoes", {
      defaultLanguage: "en",
      commands: [{ id: "showReport", label: "Show report", contexts: ["global"], defaults: [] }],
    })
  );
});

describe("a registered but unready Plugin Command", () => {
  it("reports unavailable and never queues or replays the invocation", async () => {
    const onTrigger = vi.fn();

    expect(await runCommand(commandId, { source: "voice" })).toBe("unavailable");
    expect(onTrigger).not.toHaveBeenCalled();

    // The Plugin becomes ready later: the earlier invocation is gone.
    cleanups.push(registerCommandSource(() => [{ id: commandId, onTrigger }]));
    expect(onTrigger).not.toHaveBeenCalled();
    expect(await runCommand(commandId, { source: "voice" })).toBe("ran");
    expect(onTrigger).toHaveBeenCalledTimes(1);
  });

  it("reads as disabled, not hidden, once the Plugin declares the binding unready", async () => {
    const onTrigger = vi.fn();
    cleanups.push(registerCommandSource(() => [{ id: commandId, enabled: false, onTrigger }]));

    expect(commandState(commandId)).toBe("disabled");
    expect(await runCommand(commandId, { source: "palette" })).toBe("unavailable");
    expect(onTrigger).not.toHaveBeenCalled();
  });
});
