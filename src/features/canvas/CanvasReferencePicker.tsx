import { useEffect, useState } from "react";
import type { ParseKeys } from "i18next";
import { useTranslation } from "react-i18next";
import { Tab, TabList, TabPanel, Tabs } from "react-aria-components";
import { ListBox, ListBoxItem } from "react-aria-components/ListBox";
import { Input } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import { CANVAS_REFERENCE_SOURCES, type CanvasReferenceRow } from "@/features/canvas/references";

/**
 * How long a source's list may take before the picker reports it failed: a
 * source backed by a Plugin or a slow read must not leave its tab blank.
 */
export const CANVAS_REFERENCE_LIST_TIMEOUT_MS = 5000;

const TAB_CLASS =
  "flex cursor-pointer items-center gap-1.5 rounded-md px-3 py-1 pointer-coarse:py-2 text-sm font-medium outline-none transition-colors text-muted-foreground hover:text-foreground focus-visible:ring-2 focus-visible:ring-primary data-[selected]:bg-card data-[selected]:text-foreground data-[selected]:shadow-sm";

const FIRST_SOURCE_ID = CANVAS_REFERENCE_SOURCES[0]?.id ?? "";

/** What the active tab's source answered for one query, or that it failed. */
interface ReferenceListAnswer {
  sourceId: string;
  query: string;
  rows: CanvasReferenceRow[];
  failed: boolean;
}

interface CanvasReferencePickerProps {
  isOpen: boolean;
  canvasId: string;
  onClose: () => void;
  onChoose: (sourceId: string, row: CanvasReferenceRow) => void;
}

/**
 * One search field over one tab per Canvas Reference source: the active tab
 * lists through its own source, so the picker never knows what a row is.
 */
export function CanvasReferencePicker({
  isOpen,
  canvasId,
  onClose,
  onChoose,
}: CanvasReferencePickerProps) {
  const { t } = useTranslation();
  const [sourceId, setSourceId] = useState(FIRST_SOURCE_ID);
  const [query, setQuery] = useState("");
  const [answer, setAnswer] = useState<ReferenceListAnswer | null>(null);

  // Every open starts on the first tab with an empty query.
  useEffect(() => {
    if (!isOpen) return;
    setSourceId(FIRST_SOURCE_ID);
    setQuery("");
    setAnswer(null);
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const source = CANVAS_REFERENCE_SOURCES.find((candidate) => candidate.id === sourceId);
    if (!source) return;
    // One answer per tab and query: an answer that lands after the tab or the
    // query moved on is stale and dropped, and so is one that comes too late.
    let live = true;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const settle = (next: ReferenceListAnswer) => {
      if (!live) return;
      live = false;
      clearTimeout(timeout);
      setAnswer(next);
    };
    timeout = setTimeout(() => {
      settle({ sourceId, query, rows: [], failed: true });
    }, CANVAS_REFERENCE_LIST_TIMEOUT_MS);
    void source.list(query, { canvasId }).then(
      (rows) => settle({ sourceId, query, rows, failed: false }),
      () => settle({ sourceId, query, rows: [], failed: true })
    );
    return () => {
      live = false;
      clearTimeout(timeout);
    };
  }, [canvasId, isOpen, query, sourceId]);

  const current = answer && answer.sourceId === sourceId && answer.query === query ? answer : null;

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={t("canvas.addReference")}>
      <Input
        autoFocus
        aria-label={t("canvas.referenceSearchPlaceholder")}
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder={t("canvas.referenceSearchPlaceholder")}
      />
      <Tabs
        selectedKey={sourceId}
        onSelectionChange={(key) => setSourceId(String(key))}
        className="mt-4"
      >
        <TabList
          aria-label={t("canvas.addReference")}
          className="inline-flex max-w-full flex-wrap gap-1 rounded-lg bg-muted/60 p-1"
        >
          {CANVAS_REFERENCE_SOURCES.map((entry) => {
            const Icon = entry.icon;
            return (
              <Tab key={entry.id} id={entry.id} className={TAB_CLASS}>
                <Icon className="size-4" aria-hidden="true" />
                {t(entry.label as ParseKeys)}
              </Tab>
            );
          })}
        </TabList>
        <TabPanel id={sourceId} className="outline-none">
          {current === null ? null : current.failed ? (
            <p role="alert" className="py-8 text-center text-sm text-muted-foreground">
              {t("canvas.referenceListFailed")}
            </p>
          ) : current.rows.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              {t("canvas.referenceEmpty")}
            </p>
          ) : (
            <ListBox
              aria-label={t("canvas.addReference")}
              items={current.rows}
              selectionMode="none"
              onAction={(key) => {
                const row = current.rows.find((candidate) => candidate.id === String(key));
                if (row) onChoose(sourceId, row);
              }}
              className="mt-3 max-h-80 overflow-auto outline-none"
            >
              {(row) => (
                <ListBoxItem
                  id={row.id}
                  textValue={row.title || t("canvas.referenceUntitled")}
                  className="cursor-pointer rounded-lg px-3 py-2 text-sm outline-none data-focused:bg-muted"
                >
                  <div className="truncate">{row.title || t("canvas.referenceUntitled")}</div>
                  {row.subtitle ? (
                    <div className="truncate text-xs text-muted-foreground">{row.subtitle}</div>
                  ) : null}
                </ListBoxItem>
              )}
            </ListBox>
          )}
        </TabPanel>
      </Tabs>
    </Modal>
  );
}
