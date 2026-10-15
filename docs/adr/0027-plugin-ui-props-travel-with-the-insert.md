---
status: accepted
---

# Plugin UI props travel with the insert

The Plugin SDK renders Host-rendered UI so that each element's props are already set when its insert is sent to Maibuk. It does not use `@remote-dom/react`'s `createRemoteComponent`, which sets props in a layout effect after the commit has inserted every element. On the desktop Worker path, that order sent a large render as thousands of prop-less inserts followed by thousands of prop updates. The host checks each batch on its own (required props, `maxRecordsPerBatch`), so the Plugin was refused and stopped: first open of the Echoes report sent 13,118 records in one flush, and switching Book split an insert from its required `id`. With props on the insert, every insert is complete when it arrives, a flush carries one record per element instead of one per element plus one per prop, and the SDK can cut an oversized flush into in-order batches at any point.

Found while fixing the Echoes report page on desktop (PR #504).

## Considered options

- Fold later prop updates into earlier inserts in the SDK before cutting the flush into batches: rejected. A flush that removes and inserts rows (switching Book) needs a shadow of every parent's children to know which folded inserts are still attached, and the extra pass runs on every oversized flush.
- Check required props at the end of a flush instead of per batch on the host: rejected. The host cannot see where a flush ends, and holding a half-valid tree until it does weakens the validator that keeps a Plugin from breaking the page.

## Consequences

- The SDK owns the React-to-element binding: props, events, and slots. A Remote DOM upgrade that changes element internals is checked against the SDK's binding, not picked up for free.
- The host's per-batch checks stay strict. A Plugin built against an older SDK still sends prop-less inserts and is still refused on a large flush; it needs the new SDK.
- Tests for Plugin UI limits run on the Worker path (Remote DOM's polyfill). The jsdom test host coalesces a render into a few records and cannot show this failure.
