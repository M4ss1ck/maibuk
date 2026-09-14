---
status: accepted (not implemented)
---

# Edit Session is a framework-free module

Save debouncing, Flush registration, Save Status timing, and unmount behavior are copied into `BookEditor` and `NoteEditor`, and fixes keep landing in one copy only (the #162 status-timer fix never reached `NoteEditor`). The Edit Session will be one plain TypeScript module (`createEditSession`) with an injected `save` and clock, wrapped by a thin React hook; closing an Edit Session always Flushes. It will be generic over content so Chapters, Notes, and Canvases share it, and its tests will run with fake timers and no React or module mocks.

## Considered Options

- A React hook owning the timers in refs: rejected because every test needs `renderHook`, and unmount-time flushing stays tied to React effect ordering.

## Consequences

- Every editor and its tests are written against the injected-clock contract and `dispose()` flushing, so moving the logic back into components later means rewriting all of them.
