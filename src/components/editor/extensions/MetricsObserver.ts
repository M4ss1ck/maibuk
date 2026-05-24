import { Extension } from "@tiptap/core";
import type { Transaction } from "@tiptap/pm/state";
import { classifyTransaction } from "../../../features/metrics/classifier";
import { getOrCreateDeviceId } from "../../../features/metrics/device-id";
import { isMetricsDevDisabled } from "../../../features/metrics/settings";
import { useSettingsStore } from "../../../features/settings/store";
import { metricsService } from "../../../lib/metrics/MetricsService";

interface MetricsObserverOptions {
  workId: string | null;
  chapterId: string | null;
}

type TransactionHandler = (payload: { transaction: Transaction }) => void;

interface MetricsObserverStorage {
  transactionHandler: TransactionHandler | null;
}

export const MetricsObserver = Extension.create<
  MetricsObserverOptions,
  MetricsObserverStorage
>({
  name: "metricsObserver",

  addOptions() {
    return {
      workId: null,
      chapterId: null,
    };
  },

  addStorage() {
    return {
      transactionHandler: null,
    };
  },

  onCreate() {
    const handleTransaction: TransactionHandler = ({ transaction }) => {
      if (this.editor.view.composing) return;
      if (isMetricsDevDisabled()) return;
      if (!useSettingsStore.getState().metrics.enabled.writing) return;

      const events = classifyTransaction(transaction, {
        workId: this.options.workId,
        chapterId: this.options.chapterId,
        deviceId: getOrCreateDeviceId(),
      });
      if (events.length === 0) return;

      metricsService.recordEvents(events);
      metricsService.markActive(this.options.workId);
    };

    this.storage.transactionHandler = handleTransaction;
    this.editor.on("transaction", handleTransaction);
  },

  onDestroy() {
    if (this.storage.transactionHandler) {
      this.editor.off("transaction", this.storage.transactionHandler);
      this.storage.transactionHandler = null;
    }
  },
});
