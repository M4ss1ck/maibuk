---
status: accepted
---

# Before 1.0, a Plugin API patch is additive and a minor is breaking

The Plugin API keeps its own semver (ADR 0022), and a manifest's `apiVersion` is a caret range. Before 1.0, `^0.1` means `>=0.1.0 <0.2.0`, so a minor bump refuses every Plugin built for the previous minor. We follow the caret convention: an additive change (a new optional field, method, or UI prop) bumps the patch (0.1.0 to 0.1.1), and only a breaking change bumps the minor. A Plugin that needs the addition declares the patch it needs (`^0.1.1`), so an older app refuses it with the usual compatibility message.

Decided while adding per-range highlight colors, `Select` option swatches, and inline icon elements for Echoes 0.2.0.

## Considered Options

- Bump the minor for additive changes, as post-1.0 semver does: rejected. Every `^0.1` Plugin would stop loading for a change that cannot break it.
- Let manifests declare open ranges (`>=0.1`): rejected. Before 1.0 there is no compatibility promise, so an open range accepts the breaking minors it exists to keep out.
