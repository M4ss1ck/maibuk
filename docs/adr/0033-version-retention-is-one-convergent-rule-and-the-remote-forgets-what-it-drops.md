---
status: accepted
---

# Version Retention is one convergent rule, and the remote forgets what it drops

Pruning Checkpoints on one device never freed anything: the next sync pulled every pruned Checkpoint back from the server, which kept them all forever (63 of 101 Checkpoints in one Library were over the cap this way). Version Retention is now one pure function over the Version metadata a device can see, its own plus the remote list, which carries no content. A sync downloads only Versions the rule keeps, every device drops what it does not keep, and the remote Version is tombstoned: marked deleted with its content cleared. The rule is monotone (newest Version per fixed UTC bin, bins nested day inside week): once a Version falls outside it, no later Version and no passing of time brings it back, so every device converges on the same set without remembering what it pruned. Named Versions, and Checkpoints taken before a Restore or by a Plugin, are always kept; renaming a Version makes a new Named Version, because Version metadata never changes on the server. This supersedes the append-only union in ADR 0007 for Versions.

## Considered Options

- A device-local list of pruned Version ids: rejected. A new device, or one after a Reset, starts with an empty list and downloads the whole remote history before pruning it.
- Hard-deleting remote Versions: rejected. A device still holding a copy sees it as local-only and pushes it back.
- A per-Book byte budget: rejected. With shared content, what a Version costs depends on which other Versions a device holds, so devices would drop different Versions.

## Consequences

- A remote tombstone wins over a local copy: a Version brought back by restoring an old Backup is removed again on the next sync.
- Clock skew between devices can only make a Version drop sooner, never come back. A Version stamped in the future ranks after every real one and counts as taken now, so it fills only slots no real Version wants and cannot hold future bins.
- Nothing drops a Version, locally or on the server, while the Library still holds Versions older than this rule: the upgrade first takes a safety Backup, and only then prunes and converts them.
- A device on a Release from before this rule keeps re-pushing the Checkpoints a newer device tombstoned, and the server refuses each one. That costs upload bandwidth on every sync until the device updates; nothing is lost.
