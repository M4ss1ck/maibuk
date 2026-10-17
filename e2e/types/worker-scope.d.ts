// The Worker global scope's constructor. The DOM lib does not declare it, and
// the Plugin fixtures guard their entry with `self instanceof WorkerGlobalScope`
// exactly as a Plugin Worker does (the guard is what the QuickJS scope answers,
// #516). The lib that declares it (webworker) conflicts with DOM here.
declare var WorkerGlobalScope: { new (): object; prototype: object };
