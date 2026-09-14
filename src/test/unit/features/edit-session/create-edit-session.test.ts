import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createEditSession, type EditSessionOptions } from "@/features/edit-session";
import { createAsyncQueue } from "@/lib/async-queue";

type Save = (content: string) => Promise<string>;

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function setup(overrides: Partial<EditSessionOptions<string>> = {}) {
  const save = vi.fn<Save>(async (content) => content);
  const onExternal = vi.fn<(content: string) => void>();
  const session = createEditSession<string>({
    initial: "<p>Stored</p>",
    save,
    onExternal,
    ...overrides,
  });
  const statuses: string[] = [];
  session.subscribe((status) => statuses.push(status));
  return {
    session,
    save: (overrides.save as typeof save | undefined) ?? save,
    onExternal,
    statuses,
  };
}

async function settle() {
  await vi.advanceTimersByTimeAsync(0);
}

describe("createEditSession", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("saving typed text", () => {
    it("saves the latest text once after the author pauses", async () => {
      const { session, save } = setup();

      session.update("<p>a</p>");
      await vi.advanceTimersByTimeAsync(500);
      session.update("<p>ab</p>");
      await vi.advanceTimersByTimeAsync(999);
      expect(save).not.toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(1);

      expect(save).toHaveBeenCalledTimes(1);
      expect(save).toHaveBeenCalledWith("<p>ab</p>");
    });

    it("reports saving, then saved, then idle two seconds later", async () => {
      const pending = deferred<string>();
      const { session, statuses } = setup({ save: vi.fn<Save>(() => pending.promise) });
      expect(session.getStatus()).toBe("idle");

      session.update("<p>a</p>");
      await vi.advanceTimersByTimeAsync(1000);
      expect(session.getStatus()).toBe("saving");

      pending.resolve("<p>a</p>");
      await settle();
      expect(session.getStatus()).toBe("saved");

      await vi.advanceTimersByTimeAsync(1999);
      expect(session.getStatus()).toBe("saved");
      await vi.advanceTimersByTimeAsync(1);

      expect(session.getStatus()).toBe("idle");
      expect(statuses).toEqual(["saving", "saved", "idle"]);
    });

    it("does not mark a keystroke typed during a save as saved", async () => {
      const pending = deferred<string>();
      const save = vi
        .fn<Save>()
        .mockReturnValueOnce(pending.promise)
        .mockResolvedValue("<p>ab</p>");
      const { session } = setup({ save });

      session.update("<p>a</p>");
      await vi.advanceTimersByTimeAsync(1000);
      session.update("<p>ab</p>");
      pending.resolve("<p>a</p>");
      await settle();

      expect(session.hasUnsavedChanges()).toBe(true);
      await session.flush();
      expect(save).toHaveBeenLastCalledWith("<p>ab</p>");
      expect(session.hasUnsavedChanges()).toBe(false);
    });

    it("saves on request even when nothing changed", async () => {
      const { session, save } = setup();

      await session.save();

      expect(save).toHaveBeenCalledWith("<p>Stored</p>");
      expect(session.getStatus()).toBe("saved");
    });

    it("includes input the editor still holds when saving on request", async () => {
      const holder: { session?: ReturnType<typeof setup>["session"] } = {};
      const { session, save } = setup({
        beforeFlush: () => holder.session?.update("<p>typed just now</p>"),
      });
      holder.session = session;

      await session.save();

      expect(save).toHaveBeenCalledTimes(1);
      expect(save).toHaveBeenCalledWith("<p>typed just now</p>");
    });

    it("runs saves one at a time, in order, with writes that share its queue", async () => {
      const queue = createAsyncQueue();
      const order: string[] = [];
      const first = deferred<string>();
      const save = vi.fn<Save>(async (content) => {
        order.push(`save ${content}`);
        if (content === "<p>a</p>") await first.promise;
        return content;
      });
      const { session } = setup({ save, queue });

      session.update("<p>a</p>");
      await vi.advanceTimersByTimeAsync(1000);
      const other = queue.enqueue(async () => {
        order.push("tags");
      });
      session.update("<p>ab</p>");
      await vi.advanceTimersByTimeAsync(1000);
      expect(order).toEqual(["save <p>a</p>"]);

      first.resolve("<p>a</p>");
      await other;
      await settle();

      expect(order).toEqual(["save <p>a</p>", "tags", "save <p>ab</p>"]);
    });
  });

  describe("when a save fails", () => {
    it("shows the error until the next save and keeps the text unsaved", async () => {
      const save = vi.fn<Save>().mockRejectedValueOnce(new Error("disk full"));
      save.mockImplementation(async (content) => content);
      const { session } = setup({ save });

      session.update("<p>a</p>");
      await vi.advanceTimersByTimeAsync(1000);

      expect(session.getStatus()).toBe("error");
      expect(session.hasUnsavedChanges()).toBe(true);
      await vi.advanceTimersByTimeAsync(10_000);
      expect(session.getStatus()).toBe("error");

      session.update("<p>ab</p>");
      await vi.advanceTimersByTimeAsync(1000);

      expect(save).toHaveBeenLastCalledWith("<p>ab</p>");
      expect(session.getStatus()).toBe("saved");
      expect(session.hasUnsavedChanges()).toBe(false);
    });

    it("rejects an explicit save", async () => {
      const failure = new Error("disk full");
      const { session } = setup({ save: vi.fn<Save>().mockRejectedValue(failure) });

      await expect(session.save()).rejects.toBe(failure);
    });
  });

  describe("flush", () => {
    it("saves unsaved text right away instead of waiting for the pause", async () => {
      const { session, save } = setup();

      session.update("<p>a</p>");
      await session.flush();

      expect(save).toHaveBeenCalledWith("<p>a</p>");
      await vi.advanceTimersByTimeAsync(1000);
      expect(save).toHaveBeenCalledTimes(1);
    });

    it("takes the input the editor still holds before deciding", async () => {
      const holder: { session?: ReturnType<typeof setup>["session"] } = {};
      const { session, save } = setup({
        beforeFlush: () => holder.session?.update("<p>still coalescing</p>"),
      });
      holder.session = session;

      await session.flush();

      expect(save).toHaveBeenCalledWith("<p>still coalescing</p>");
    });

    it("does nothing when everything is saved", async () => {
      const { session, save } = setup();

      await session.flush();

      expect(save).not.toHaveBeenCalled();
    });

    it("waits for the save already running instead of saving twice", async () => {
      const pending = deferred<string>();
      const save = vi.fn<Save>(() => pending.promise);
      const { session } = setup({ save });

      session.update("<p>a</p>");
      await vi.advanceTimersByTimeAsync(1000);
      let flushed = false;
      const flushing = session.flush().then(() => {
        flushed = true;
      });
      await settle();
      expect(flushed).toBe(false);

      pending.resolve("<p>a</p>");
      await flushing;

      expect(save).toHaveBeenCalledTimes(1);
    });

    it("retries after the running save fails, and rejects if the retry fails", async () => {
      const failure = new Error("disk full");
      const pending = deferred<string>();
      const save = vi.fn<Save>().mockReturnValueOnce(pending.promise).mockRejectedValue(failure);
      const { session } = setup({ save });

      session.update("<p>a</p>");
      await vi.advanceTimersByTimeAsync(1000);
      const flushing = session.flush();
      pending.reject(failure);

      await expect(flushing).rejects.toBe(failure);
      expect(save).toHaveBeenCalledTimes(2);
      expect(session.hasUnsavedChanges()).toBe(true);
    });
  });

  describe("content arriving from the store", () => {
    it("ignores its own save coming back, even normalized by the store", async () => {
      const save = vi.fn<Save>(async (content) => content.replace("<h2>", '<h2 id="h-1">'));
      const { session, onExternal } = setup({ save });

      session.update("<h2>Title</h2>");
      await vi.advanceTimersByTimeAsync(1000);
      session.externalContent('<h2 id="h-1">Title</h2>');

      expect(onExternal).not.toHaveBeenCalled();
      expect(session.getContent()).toBe("<h2>Title</h2>");
    });

    it("ignores a save that comes back while the author keeps typing", async () => {
      const save = vi.fn<Save>(async (content) => `${content}<!--stored-->`);
      const { session, onExternal } = setup({ save });

      session.update("<p>A</p>");
      await vi.advanceTimersByTimeAsync(1000);
      session.update("<p>AB</p>");
      session.externalContent("<p>A</p><!--stored-->");

      expect(onExternal).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1000);
      expect(save).toHaveBeenLastCalledWith("<p>AB</p>");
    });

    it("waits for a running save before judging content that arrives during it", async () => {
      // Stores publish the new content before the save call resolves.
      const pending = deferred<string>();
      const { session, onExternal } = setup({ save: vi.fn<Save>(() => pending.promise) });

      session.update("<h2>Title</h2>");
      await vi.advanceTimersByTimeAsync(1000);
      session.externalContent('<h2 id="h-1">Title</h2>');
      expect(onExternal).not.toHaveBeenCalled();

      pending.resolve('<h2 id="h-1">Title</h2>');
      await settle();

      expect(onExternal).not.toHaveBeenCalled();
    });

    it("ignores a save's echo that arrives while the next save is already running", async () => {
      const second = deferred<string>();
      const save = vi
        .fn<Save>()
        .mockImplementationOnce(async (content) => `${content}<!--stored-->`)
        .mockImplementationOnce(() => second.promise);
      const { session, onExternal } = setup({ save });

      session.update("<p>A</p>");
      await vi.advanceTimersByTimeAsync(1000);
      // The author presses Save for newer text before the first echo reaches the editor.
      session.update("<p>AB</p>");
      const saving = session.save();
      session.externalContent("<p>A</p><!--stored-->");
      second.resolve("<p>AB</p><!--stored-->");
      await saving;
      await settle();

      expect(onExternal).not.toHaveBeenCalled();
      expect(session.getContent()).toBe("<p>AB</p>");
    });

    it("ignores an echo that arrives before its save resolves when another save is queued", async () => {
      const first = deferred<string>();
      const second = deferred<string>();
      const save = vi
        .fn<Save>()
        .mockImplementationOnce(() => first.promise)
        .mockImplementationOnce(() => second.promise);
      const { session, onExternal } = setup({ save });

      session.update("<p>A</p>");
      await vi.advanceTimersByTimeAsync(1000);
      session.update("<p>AB</p>");
      const saving = session.save();
      // The store publishes the first save before that save call resolves.
      session.externalContent("<p>A</p><!--stored-->");
      first.resolve("<p>A</p><!--stored-->");
      await settle();
      second.resolve("<p>AB</p><!--stored-->");
      await saving;
      await settle();

      expect(onExternal).not.toHaveBeenCalled();
      expect(session.getContent()).toBe("<p>AB</p>");
    });

    it("adopts an outside change, dropping the save queued for the old text", async () => {
      const { session, save, onExternal } = setup();

      session.update("<p>Typed before the pull</p>");
      session.externalContent("<p>Pulled from another device</p>");
      await vi.advanceTimersByTimeAsync(5000);

      expect(onExternal).toHaveBeenCalledWith("<p>Pulled from another device</p>");
      expect(save).not.toHaveBeenCalled();
      expect(session.getContent()).toBe("<p>Pulled from another device</p>");
      expect(session.hasUnsavedChanges()).toBe(false);
    });

    it("recognizes its own echo after adopting an outside change", async () => {
      const { session, onExternal } = setup();

      session.externalContent("<p>Restored</p>");
      session.externalContent("<p>Restored</p>");

      expect(onExternal).toHaveBeenCalledTimes(1);
    });

    it("clears a failed-save error once an outside change replaces the text", async () => {
      const { session } = setup({ save: vi.fn<Save>().mockRejectedValue(new Error("disk full")) });

      session.update("<p>a</p>");
      await vi.advanceTimersByTimeAsync(1000);
      expect(session.getStatus()).toBe("error");

      session.externalContent("<p>Restored</p>");

      expect(session.getStatus()).toBe("idle");
    });
  });

  describe("closing", () => {
    it("flushes unsaved text when it closes", async () => {
      const { session, save } = setup();

      session.update("<p>a</p>");
      await session.dispose();

      expect(save).toHaveBeenCalledWith("<p>a</p>");
      expect(session.isDisposed()).toBe(true);
    });

    it("saves at once text the editor drains after the session closed", async () => {
      const { session, save } = setup();

      void session.dispose();
      session.update("<p>drained while unmounting</p>");
      await settle();

      expect(save).toHaveBeenCalledWith("<p>drained while unmounting</p>");
    });

    it("leaves no timer running once closed", async () => {
      const { session } = setup();

      session.update("<p>a</p>");
      await vi.advanceTimersByTimeAsync(1000);
      expect(session.getStatus()).toBe("saved");
      // Closing with unsaved text saves while closed; that save must not start
      // the "saved" reset timer either.
      session.update("<p>ab</p>");
      await session.dispose();

      expect(session.getStatus()).toBe("saved");
      expect(vi.getTimerCount()).toBe(0);
    });

    it("stops adopting store content once closed", async () => {
      const { session, onExternal } = setup();

      await session.dispose();
      session.externalContent("<p>Pulled</p>");

      expect(onExternal).not.toHaveBeenCalled();
    });

    it("returns the same result when closed twice", async () => {
      const { session, save } = setup();

      session.update("<p>a</p>");
      const first = session.dispose();

      expect(session.dispose()).toBe(first);
      await first;
      expect(save).toHaveBeenCalledTimes(1);
    });
  });
});
