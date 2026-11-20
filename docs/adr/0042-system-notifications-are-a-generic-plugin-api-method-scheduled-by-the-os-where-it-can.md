---
status: accepted
---

# System Notifications are a generic Plugin API method, scheduled by the OS where it can

A Plugin that holds the `system-notifications` Plugin Permission sends a System Notification with `notifications.system({ id, title, body, at? })` and withdraws one with `notifications.cancel({ id })`. Each Plugin has its own `id` namespace, and a second send with the same `id` replaces the first. Built-in Plugins start with the permission granted, like their others. The existing `notifications.show` toast is unchanged. Both methods are additive, so they ship as a Plugin API patch (ADR 0029). The host owns delivery: `tauri-plugin-notification` on desktop and Android, and the Web Notifications API on the web. Where the OS can hold a future notification, the host hands it `at` and the notification fires without Maibuk. Where it can't, the host keeps the deadline itself and fires it only while Maibuk is running. The Plugin's page tells the author which case applies.

Decided while designing the Clock Built-in Plugin (Pomodoro Cycles, Timer, Stopwatch, Alarms), its first user. Per "plugins get no host accommodation", the method is generic and nothing in it is specific to Clock.

| Platform | Maibuk in the background | Maibuk closed |
| --- | --- | --- |
| Android | fires (OS-scheduled) | fires (OS-scheduled) |
| Desktop | fires | does not fire |
| Web, desktop browser | fires while the tab is open | does not fire |
| Web, mobile browser | toast only | does not fire |

## Considered Options

- **Toast only (`notifications.show`)**: rejected. It is invisible while Maibuk is in the background, and an Alert nobody sees has failed.
- **Clock-specific host code** (a host timer service or alarm store): rejected. It would be a host accommodation for one Plugin. A notification with an optional time is the smallest generic capability that serves a reminder or a timer.
- **The Plugin's own timers only, with no `at`**: rejected for Android. The WebView and its Plugin Worker are suspended in the background, so a Pomodoro end would be missed until the author came back.
- **A service worker so mobile browsers can notify**: rejected for now. Chrome on Android refuses `new Notification()` outside a service worker, and adding one to the web build brings caching and update behavior that should be its own decision.
- **`USE_EXACT_ALARM` on Android**: rejected. Play allows it only for alarm-clock apps. The host asks for `SCHEDULE_EXACT_ALARM`, which the user can grant, and falls back to inexact scheduling, which can fire minutes late.

## Consequences

- Asking the OS for notification permission is a user action, like `files.pick`: it is refused unless the author's click, key press, or Command run caused it. When the OS refuses or hasn't been asked, the host falls back to the toast.
- Limits: at most 1 immediate System Notification per second per Plugin (extras are queued, not dropped) and at most 20 pending scheduled ones per Plugin.
- Clicking a System Notification brings Maibuk to the front and gives focus to the sending Plugin's page. There are no action buttons, because `tauri-plugin-notification` supports them on mobile only.
- Disabling or removing a Plugin, or revoking its permission, cancels its pending scheduled notifications.
