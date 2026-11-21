// @ts-check
/* The Clock Frame (#886): the four panels (Pomodoro, Timer, Stopwatch, Alarms),
   the section bar they share, the notifications banner, the live region, and the
   three modal dialogs (the Alarms' editor, the Alarm delete confirmation, and
   the Pomodoro settings). The Frame's only host channel is `window.maibuk.port`: the Worker sends the localized
   labels and the whole state as raw JSON, and the Frame answers with one control
   message per press. Labels may arrive after the first state, so the page stays
   empty until both have arrived.

   The Frame owns its keyboard: the tabs, the dialogs' focus trap and Escape, and
   nothing else, so every other key reaches the host's Commands.

   The wire shapes mirror `frame-protocol.ts`. It is a classic script, not a
   module: a relative `import` cannot resolve in the Frame's opaque origin. */

(() => {
  // biome-ignore lint/suspicious/noRedundantUseStrict: the Frame loads this file as a classic script, not a module.
  "use strict";

  /**
   * @typedef {{ status: "idle", length: number } | { status: "running", length: number, endsAt: number } | { status: "paused", length: number, remaining: number } | { status: "ended", length: number, endedAt: number }} TimerState
   * @typedef {{ state: TimerState, recent: number[] }} TimerSnapshot
   * @typedef {"pomodoro" | "shortBreak" | "longBreak"} Phase
   * @typedef {{ pomodoroMinutes: number, shortBreakMinutes: number, longBreakMinutes: number, longBreakEvery: number, autoStartBreaks: boolean, autoStartPomodoros: boolean }} PomodoroSettings
   * @typedef {{ phase: Phase, pomodoro: number } & ({ status: "idle" } | { status: "running", endsAt: number } | { status: "paused", remaining: number } | { status: "ended", endedAt: number })} CycleState
   * @typedef {{ day: number, count: number }} TodayCount
   * @typedef {{ state: CycleState, settings: PomodoroSettings, today: TodayCount }} PomodoroSnapshot
   * @typedef {{ length: number, total: number }} Lap
   * @typedef {{ status: "idle" } | { status: "running", startedAt: number, banked: number, laps: Lap[] } | { status: "paused", banked: number, laps: Lap[] }} StopwatchState
   * @typedef {{ id: string, hour: number, minute: number, label: string, weekdays: number[], enabled: boolean, nextAt: number | null }} Alarm
   * @typedef {{ permission: string, canScheduleWhileClosed: boolean, exactTiming: boolean }} FrameNotificationStatus
   * @typedef {{ kind: "labels", language: string, hourCycle: 12 | 24, labels: Record<string, string> }} FrameLabelsMessage
   * @typedef {{ kind: "state", timer: TimerSnapshot, pomodoro: PomodoroSnapshot, stopwatch: StopwatchState, alarms: Alarm[], notifications: FrameNotificationStatus | null, tab: string }} FrameStateMessage
   * @typedef {FrameLabelsMessage | FrameStateMessage | FrameOpenSettingsMessage} WorkerToFrameMessage
   * @typedef {{ progress: number, title: string, subtitle: string, target: "pomodoro" | "stopwatch" }} AlsoData
   * @typedef {{ id: string | null, hour: number, minute: number, label: string, weekdays: number[], time: string | null }} AlarmDraft
   * @typedef {{ id: string, opener: HTMLElement | null, backdrop: "focus" | "close", close: () => void }} OpenDialog
   * @typedef {{ kind: "pomodoro.openSettings" }} FrameOpenSettingsMessage
   */

  const SVG_NS = "http://www.w3.org/2000/svg";
  const TABS = ["pomodoro", "timer", "stopwatch", "alarms"];
  const TICK_COUNT = 60;
  const TICK_MAJOR_EVERY = 5;
  const TICK_OUTER = 152;
  const TICK_MAJOR_INNER = 142;
  const TICK_MINOR_INNER = 147;
  const RING_CIRCUMFERENCE = 804.2;
  const MINI_CIRCUMFERENCE = 113.1;
  const MS_PER_SECOND = 1_000;
  const MS_PER_MINUTE = 60_000;
  const MS_PER_HOUR = 3_600_000;
  const MS_PER_DAY = 86_400_000;
  const SECONDS_PER_MINUTE = 60;
  const MINUTES_PER_HOUR = 60;
  const HOURS_PER_DAY = 24;
  const SECONDS_PER_HOUR = 3_600;
  const MAX_HOURS = 99;
  const MAX_MINUTES = 59;
  const MAX_SECONDS = 59;
  const MAX_ALARM_HOUR = 23;
  const TICK_MS = 1_000;
  const HUNDREDTH_MS = 10;
  const DAYS_PER_WEEK = 7;
  const EPOCH_WEEKDAY = 4;

  const WEEKDAY_KEYS = [
    "weekdaySun",
    "weekdayMon",
    "weekdayTue",
    "weekdayWed",
    "weekdayThu",
    "weekdayFri",
    "weekdaySat",
  ];

  const PLAY_PATH = "M7 4.5v15a1 1 0 0 0 1.5.86l12-7.5a1 1 0 0 0 0-1.72l-12-7.5A1 1 0 0 0 7 4.5z";

  /** The elements' icon paths the Alarms' edit and delete buttons draw. */
  const ICON_PATHS = {
    edit: ["M12 20h9", "M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"],
    remove: ["M3 6h18", "M8 6V4h8v2", "M19 6l-1 14H6L5 6"],
  };

  /** The settings Reset fills, mirroring `DEFAULT_POMODORO_SETTINGS` in `cycle.ts`. */
  const DEFAULT_POMODORO_SETTINGS = {
    pomodoroMinutes: 25,
    shortBreakMinutes: 5,
    longBreakMinutes: 15,
    longBreakEvery: 4,
    autoStartBreaks: false,
    autoStartPomodoros: false,
  };

  /** The Frame's mirror of the Worker's `POMODORO_LIMITS` (`cycle.ts`): the range each field takes. */
  const POMODORO_LIMITS = {
    minutes: { min: 1, max: 99 },
    longBreakEvery: { min: 1, max: 12 },
  };

  /** The settings dialog's number fields: the setting each edits, the range it takes, and the message key an invalid one shows. */
  const SETTINGS_FIELDS = [
    ["settings-pomodoro", "pomodoroMinutes", POMODORO_LIMITS.minutes, "minutesRange"],
    ["settings-short", "shortBreakMinutes", POMODORO_LIMITS.minutes, "minutesRange"],
    ["settings-long", "longBreakMinutes", POMODORO_LIMITS.minutes, "minutesRange"],
    ["settings-every", "longBreakEvery", POMODORO_LIMITS.longBreakEvery, "countRange"],
  ];

  /** The Alarm editor's time fields: the range each takes and the message key an invalid one shows. */
  const ALARM_FIELDS = [
    ["alarm-hour", { min: 0, max: MAX_ALARM_HOUR }, "countRange"],
    ["alarm-minute", { min: 0, max: MAX_MINUTES }, "countRange"],
  ];

  /** The settings dialog's switches and the setting each toggles. */
  const SETTINGS_SWITCHES = [
    ["settings-auto-breaks", "autoStartBreaks"],
    ["settings-auto-pomodoros", "autoStartPomodoros"],
  ];

  /** The class that hides Reset without taking it out of the row's layout. */
  const RESET_HIDDEN_CLASS = "reset-hidden";

  /** @param {string} id @returns {HTMLElement} */
  function el(id) {
    const node = document.getElementById(id);
    if (node === null) throw new Error(`missing #${id}`);
    return /** @type {HTMLElement} */ (node);
  }

  /** @param {string} id @returns {SVGElement} */
  function svgElement(id) {
    const node = document.getElementById(id);
    if (node === null) throw new Error(`missing #${id}`);
    return /** @type {SVGElement} */ (node);
  }

  /**
   * Replaces each `{name}` hole in a localized string.
   * @param {string} template
   * @param {Record<string, string | number>} values
   * @returns {string}
   */
  function fill(template, values) {
    return template.replace(/\{(\w+)\}/g, (match, name) =>
      Object.hasOwn(values, name) ? String(values[name]) : match
    );
  }

  /** @param {number} value @returns {string} */
  function pad2(value) {
    return value < 10 ? `0${value}` : `${value}`;
  }

  /** @param {number} total @returns {string} */
  function formatWholeSeconds(total) {
    const seconds = total % SECONDS_PER_MINUTE;
    const minutes = Math.floor(total / SECONDS_PER_MINUTE) % MINUTES_PER_HOUR;
    const hours = Math.floor(total / SECONDS_PER_HOUR);
    if (hours === 0) return `${minutes}:${pad2(seconds)}`;
    return `${hours}:${pad2(minutes)}:${pad2(seconds)}`;
  }

  /** @param {number} ms @returns {string} */
  function formatDuration(ms) {
    return formatWholeSeconds(Math.ceil(Math.max(0, ms) / MS_PER_SECOND));
  }

  /** @param {number} ms @returns {string} */
  function formatElapsed(ms) {
    return formatWholeSeconds(Math.floor(Math.max(0, ms) / MS_PER_SECOND));
  }

  /** The Stopwatch's "hh:mm:ss" digits, counted down to the whole second. @param {number} ms @returns {string} */
  function formatStopwatch(ms) {
    const total = Math.floor(Math.max(0, ms) / MS_PER_SECOND);
    const hours = Math.floor(total / SECONDS_PER_HOUR);
    const minutes = Math.floor(total / SECONDS_PER_MINUTE) % MINUTES_PER_HOUR;
    return `${pad2(hours)}:${pad2(minutes)}:${pad2(total % SECONDS_PER_MINUTE)}`;
  }

  /** The Stopwatch's ".cc" hundredths. @param {number} ms @returns {string} */
  function formatHundredths(ms) {
    const hundredths = Math.floor((Math.max(0, ms) % MS_PER_SECOND) / HUNDREDTH_MS);
    return `.${pad2(hundredths)}`;
  }

  /** A Lap or a Stopwatch instant as the Laps table reads it: "hh:mm:ss.cc". @param {number} ms @returns {string} */
  function formatLap(ms) {
    return `${formatStopwatch(ms)}${formatHundredths(ms)}`;
  }

  /** @param {number} day 0=Sunday through 6 @returns {string} */
  function weekdayName(day) {
    const key = WEEKDAY_KEYS[((day % DAYS_PER_WEEK) + DAYS_PER_WEEK) % DAYS_PER_WEEK];
    return key === undefined ? "" : label(key);
  }

  /** @param {Alarm} alarm @returns {string} */
  function alarmTimeText(alarm) {
    const at = new Date(2000, 0, 1, alarm.hour, alarm.minute).getTime();
    return formatClockTime(at, new Date(at).getTimezoneOffset(), hourCycle);
  }

  /** @param {Alarm} alarm @returns {string} */
  function alarmRepeatText(alarm) {
    if (alarm.weekdays.length === 0) return label("repeatOnce");
    const days = [];
    for (let day = 0; day < DAYS_PER_WEEK; day++) {
      if (alarm.weekdays.includes(day)) days.push(weekdayName(day));
    }
    return days.join(", ");
  }

  /**
   * The Alarm's name for its controls: its time alone, or its time, label, and
   * weekdays when another Alarm shares the time and the bare time would be
   * ambiguous.
   * @param {Alarm} alarm
   * @param {Alarm[]} list
   * @returns {string}
   */
  function alarmName(alarm, list) {
    const time = alarmTimeText(alarm);
    const shared = list.some(
      (other) => other.id !== alarm.id && other.hour === alarm.hour && other.minute === alarm.minute
    );
    if (!shared) return time;
    return [time, alarm.label, alarmRepeatText(alarm)].filter((part) => part !== "").join(", ");
  }

  /**
   * The "Next alarm ..." line for the nearest enabled Alarm, or null when none
   * is on.
   * @param {number} now
   * @returns {string | null}
   */
  function nextAlarmText(now) {
    if (!frameState) return null;
    /** @type {number | null} */
    let soonest = null;
    for (const alarm of frameState.alarms) {
      if (!alarm.enabled || alarm.nextAt === null) continue;
      if (soonest === null || alarm.nextAt < soonest) soonest = alarm.nextAt;
    }
    if (soonest === null) return null;
    const offset = offsetNow();
    const today = Math.floor((now - offset * MS_PER_MINUTE) / MS_PER_DAY);
    const day = Math.floor(
      (soonest - new Date(soonest).getTimezoneOffset() * MS_PER_MINUTE) / MS_PER_DAY
    );
    const ahead = day - today;
    /** @type {string} */
    let dayWord;
    if (ahead <= 0) dayWord = label("today");
    else if (ahead === 1) dayWord = label("tomorrow");
    else dayWord = weekdayName(day + EPOCH_WEEKDAY);
    return fill(label("nextAlarm"), {
      day: dayWord,
      time: formatClockTime(soonest, new Date(soonest).getTimezoneOffset(), hourCycle),
      in: timeUntilText(Math.max(0, Math.ceil((soonest - now) / MS_PER_MINUTE))),
    });
  }

  /**
   * How long until the next Alarm, writing only the parts above zero: "2 h",
   * "2 h 5 min", or "5 min".
   * @param {number} minutes
   * @returns {string}
   */
  function timeUntilText(minutes) {
    const h = Math.floor(minutes / MINUTES_PER_HOUR);
    const m = minutes % MINUTES_PER_HOUR;
    if (h === 0) return fill(label("inMinutes"), { m });
    if (m === 0) return fill(label("inHours"), { h });
    return fill(label("inHoursMinutes"), { h, m });
  }

  /**
   * The Lap indexes the Laps table tags, or -1 for each when there are fewer
   * than two Laps or every Lap took the same time. A tie keeps the first Lap.
   * @param {Lap[]} laps
   * @returns {{ fastest: number, slowest: number }}
   */
  function lapBounds(laps) {
    if (laps.length < 2) return { fastest: -1, slowest: -1 };
    let fastest = 0;
    let slowest = 0;
    laps.forEach((lap, index) => {
      if (lap.length < laps[fastest].length) fastest = index;
      if (lap.length > laps[slowest].length) slowest = index;
    });
    if (fastest === slowest) return { fastest: -1, slowest: -1 };
    return { fastest, slowest };
  }

  /** @param {number} value @param {number} max @returns {number} */
  function clamp(value, max) {
    return Math.min(Math.max(Number.isFinite(value) ? Math.trunc(value) : 0, 0), max);
  }

  /**
   * @param {number} ms
   * @returns {{ hours: number, minutes: number, seconds: number }}
   */
  function splitDuration(ms) {
    const total = Math.max(0, Math.ceil(ms / MS_PER_SECOND));
    return {
      hours: Math.min(Math.floor(total / SECONDS_PER_HOUR), MAX_HOURS),
      minutes: Math.floor(total / SECONDS_PER_MINUTE) % MINUTES_PER_HOUR,
      seconds: total % SECONDS_PER_MINUTE,
    };
  }

  /**
   * @param {number} hours
   * @param {number} minutes
   * @param {number} seconds
   * @returns {number}
   */
  function joinDuration(hours, minutes, seconds) {
    return Math.round(
      clamp(hours, MAX_HOURS) * MS_PER_HOUR +
        clamp(minutes, MAX_MINUTES) * MS_PER_MINUTE +
        clamp(seconds, MAX_SECONDS) * MS_PER_SECOND
    );
  }

  /**
   * @param {number} epochMs
   * @param {number} offsetMinutes
   * @param {12 | 24} hourCycle
   * @returns {string}
   */
  function formatClockTime(epochMs, offsetMinutes, hourCycle) {
    const localMs = epochMs - offsetMinutes * MS_PER_MINUTE;
    const minutesOfDay =
      ((Math.floor(localMs / MS_PER_MINUTE) % (HOURS_PER_DAY * MINUTES_PER_HOUR)) +
        HOURS_PER_DAY * MINUTES_PER_HOUR) %
      (HOURS_PER_DAY * MINUTES_PER_HOUR);
    const hours = Math.floor(minutesOfDay / MINUTES_PER_HOUR);
    const minutes = minutesOfDay % MINUTES_PER_HOUR;
    if (hourCycle === 24) return `${pad2(hours)}:${pad2(minutes)}`;
    const hours12 = hours % 12 === 0 ? 12 : hours % 12;
    return `${hours12}:${pad2(minutes)} ${hours < 12 ? label("am") : label("pm")}`;
  }

  /** @returns {number} */
  function offsetNow() {
    return new Date().getTimezoneOffset();
  }

  /**
   * @param {TimerState} state
   * @param {number} now
   * @returns {number}
   */
  function remainingTimer(state, now) {
    switch (state.status) {
      case "running":
        return Math.max(0, state.endsAt - now);
      case "paused":
        return state.remaining;
      case "idle":
        return state.length;
      case "ended":
        return 0;
    }
  }

  /**
   * @param {CycleState} state
   * @param {PomodoroSettings} settings
   * @param {number} now
   * @returns {number}
   */
  function remainingCycle(state, settings, now) {
    switch (state.status) {
      case "idle":
        return phaseLength(state.phase, settings);
      case "running":
        return Math.max(0, state.endsAt - now);
      case "paused":
        return state.remaining;
      case "ended":
        return 0;
    }
  }

  /**
   * @param {Phase} phase
   * @param {PomodoroSettings} settings
   * @returns {number}
   */
  function phaseLength(phase, settings) {
    switch (phase) {
      case "pomodoro":
        return settings.pomodoroMinutes * MS_PER_MINUTE;
      case "shortBreak":
        return settings.shortBreakMinutes * MS_PER_MINUTE;
      case "longBreak":
        return settings.longBreakMinutes * MS_PER_MINUTE;
    }
  }

  /** @param {StopwatchState} state @param {number} now @returns {number} */
  function elapsedStopwatch(state, now) {
    switch (state.status) {
      case "running":
        return state.banked + Math.max(0, now - state.startedAt);
      case "paused":
        return state.banked;
      case "idle":
        return 0;
    }
  }

  /**
   * @param {TodayCount} today
   * @param {number} now
   * @param {number} offsetMinutes
   * @returns {number}
   */
  function todayCount(today, now, offsetMinutes) {
    const day = Math.floor((now - offsetMinutes * MS_PER_MINUTE) / MS_PER_DAY);
    return today.day === day ? today.count : 0;
  }

  /**
   * @param {number} every
   * @returns {Phase[]}
   */
  function cycleSteps(every) {
    const steps = [];
    const count = Math.max(1, Math.trunc(every));
    for (let index = 1; index <= count; index++) {
      steps.push("pomodoro");
      steps.push(index === count ? "longBreak" : "shortBreak");
    }
    return steps;
  }

  /**
   * @param {CycleState} state
   * @param {number} every
   * @returns {number}
   */
  function cycleIndex(state, every) {
    if (state.phase === "pomodoro") return (state.pomodoro - 1) * 2;
    if (state.phase === "shortBreak") return (state.pomodoro - 1) * 2 + 1;
    return Math.max(0, (Math.trunc(every) - 1) * 2 + 1);
  }

  const port = window.maibuk ? window.maibuk.port : null;

  /** @type {Record<string, string> | null} */
  let labels = null;
  /** @type {12 | 24} */
  let hourCycle = 24;
  /** @type {FrameStateMessage | null} */
  let frameState = null;
  /** @type {string} */
  let activeTab = "pomodoro";
  /** True until the author picks a tab here; until then the Frame follows the Worker's stored tab. */
  let followStoredTab = true;
  let tickHandle = 0;
  let rafHandle = 0;
  let alsoKeys = "";
  let alarmKeys = "";
  let lapKeys = "";
  let lapBarKeys = "";
  let daysKey = "";
  let stopwatchIcon = "";
  /** @type {AlarmDraft | null} */
  let editor = null;
  /** The modal dialog that is open, if any: one at a time. @type {OpenDialog | null} */
  let dialog = null;
  /** The Alarm the delete confirmation asks about, or null while it is closed. @type {string | null} */
  let deleteId = null;
  /** The Alarm just deleted, kept until the redrawn list can take focus. @type {{ id: string, index: number } | null} */
  let pendingRemoveFocus = null;

  /** @param {string} key @returns {string} */
  function label(key) {
    const value = labels ? labels[key] : undefined;
    return typeof value === "string" ? value : "";
  }

  /** @param {string} id @param {string} text */
  function setText(id, text) {
    const node = el(id);
    if (node.textContent !== text) node.textContent = text;
  }

  /** @param {string} id @param {string} name @param {string} value */
  function setAttr(id, name, value) {
    const node = el(id);
    if (node.getAttribute(name) !== value) node.setAttribute(name, value);
  }

  /** @param {string} phase @returns {string} */
  function phaseLabel(phase) {
    if (phase === "pomodoro") return label("pomodoro");
    if (phase === "shortBreak") return label("shortBreak");
    return label("longBreak");
  }

  /** @param {Record<string, unknown>} message */
  function post(message) {
    if (port) port.postMessage(message);
  }

  /** @param {string} id @param {string} kind */
  function drawIcon(id, kind) {
    const icon = svgElement(id);
    icon.replaceChildren();
    if (kind === "pause") {
      for (const x of [6, 14]) {
        const rect = document.createElementNS(SVG_NS, "rect");
        rect.setAttribute("x", String(x));
        rect.setAttribute("y", "4");
        rect.setAttribute("width", "4");
        rect.setAttribute("height", "16");
        rect.setAttribute("rx", "1.5");
        icon.append(rect);
      }
      return;
    }
    const path = document.createElementNS(SVG_NS, "path");
    path.setAttribute("d", PLAY_PATH);
    icon.append(path);
  }

  /** @param {string} id @param {number} progress */
  function drawRing(id, progress) {
    const ring = /** @type {SVGCircleElement} */ (svgElement(id));
    ring.setAttribute("stroke-dashoffset", String(RING_CIRCUMFERENCE * (1 - progress)));
  }

  /** @param {string} id @param {number} progress */
  function drawTicks(id, progress) {
    const group = svgElement(id);
    if (group.childElementCount === 0) {
      for (let index = 0; index < TICK_COUNT; index++) {
        const angle = (index / TICK_COUNT) * Math.PI * 2;
        const major = index % TICK_MAJOR_EVERY === 0;
        const outer = TICK_OUTER;
        const inner = major ? TICK_MAJOR_INNER : TICK_MINOR_INNER;
        const line = document.createElementNS(SVG_NS, "line");
        line.setAttribute("x1", String(Math.round((160 + outer * Math.sin(angle)) * 10) / 10));
        line.setAttribute("y1", String(Math.round((160 - outer * Math.cos(angle)) * 10) / 10));
        line.setAttribute("x2", String(Math.round((160 + inner * Math.sin(angle)) * 10) / 10));
        line.setAttribute("y2", String(Math.round((160 - inner * Math.cos(angle)) * 10) / 10));
        line.setAttribute("stroke-width", major ? "2" : "1");
        group.append(line);
      }
    }
    for (let index = 0; index < group.children.length; index++) {
      const passed = index / TICK_COUNT < 1 - progress;
      group.children[index].setAttribute("stroke-opacity", passed ? "0.3" : "0.75");
    }
  }

  /** @param {string} name @param {boolean} focus */
  function selectTab(name, focus) {
    activeTab = name;
    for (const key of TABS) {
      const selected = key === name;
      const tab = el(`tab-${key}`);
      tab.setAttribute("aria-selected", selected ? "true" : "false");
      tab.tabIndex = selected ? 0 : -1;
      el(`panel-${key}`).hidden = !selected;
    }
    const alarms = name === "alarms";
    el("add-alarm").hidden = !alarms;
    el("pomodoros-today").hidden = alarms;
    if (focus) el(`tab-${name}`).focus();
    scheduleTick();
    scheduleAnimation();
  }

  /** The author picked a tab: show it and have the Worker keep it for this device. @param {string} name @param {boolean} focus */
  function chooseTab(name, focus) {
    followStoredTab = false;
    selectTab(name, focus);
    post({ kind: "tab.select", tab: name });
  }

  function drawStatic() {
    el("sections").setAttribute("aria-label", label("tabs"));
    setText("tab-pomodoro-label", label("pomodoro"));
    setText("tab-timer-label", label("timer"));
    setText("tab-stopwatch-label", label("stopwatch"));
    setText("tab-alarms-label", label("alarms"));
    setText("cycle-title", label("thisCycle"));
    setText("also-running-title", label("alsoRunning"));
    setText("recent-label", label("recent"));
    setText("timer-length-legend", label("timerLength"));
    setText("timer-hours-label", label("hours"));
    setText("timer-minutes-label", label("minutes"));
    setText("timer-seconds-label", label("seconds"));
    setText("alerts-title", label("alertsHeading"));
    el("pomodoro-reset").setAttribute("aria-label", label("resetCycle"));
    el("pomodoro-skip").setAttribute("aria-label", label("skip"));
    el("timer-reset").setAttribute("aria-label", label("reset"));
    setText("laps-title", label("laps"));
    setText("laps-col-lap", label("lap"));
    setText("laps-col-lap-time", label("lapTime"));
    setText("laps-col-total", label("total"));
    setText("stopwatch-lap-label", label("lap"));
    el("stopwatch-reset").setAttribute("aria-label", label("reset"));
    setText("add-alarm-label", label("addAlarm"));
    setText("alarm-hour-label", label("hour"));
    setText("alarm-minute-label", label("minute"));
    setText("alarm-label-caption", label("alarmLabel"));
    setText("alarm-repeat-legend", label("repeat"));
    setText("alarm-repeat-hint", label("repeatHint"));
    setText("alarm-cancel", label("cancel"));
    setText("alarm-save", label("save"));
    el("alarm-editor-close").setAttribute("aria-label", label("cancel"));
    setText("alarm-delete-title", label("deleteAlarmTitle"));
    setText("alarm-delete-cancel", label("cancel"));
    setText("alarm-delete-confirm", label("delete"));
    setText("pomodoro-settings-title", label("pomodoroSettings"));
    setText("settings-pomodoro-label", label("pomodoroMinutes"));
    setText("settings-short-label", label("shortBreakMinutes"));
    setText("settings-long-label", label("longBreakMinutes"));
    setText("settings-every-label", label("longBreakEvery"));
    setText("settings-auto-breaks-label", label("autoStartBreaks"));
    setText("settings-auto-pomodoros-label", label("autoStartPomodoros"));
    setText("pomodoro-settings-reset", label("resetToDefaults"));
    setText("pomodoro-settings-cancel", label("cancel"));
    setText("pomodoro-settings-save", label("save"));
    el("pomodoro-settings-close").setAttribute("aria-label", label("cancel"));
    for (const [id, , limits] of SETTINGS_FIELDS) {
      const input = /** @type {HTMLInputElement} */ (el(id));
      input.min = String(limits.min);
      input.max = String(limits.max);
    }
    drawDays();
    drawEditorTitle();
  }

  function drawTabs() {
    if (!frameState) return;
    /** @type {Record<string, string>} */
    const statuses = {
      pomodoro: frameState.pomodoro.state.status,
      timer: frameState.timer.state.status,
      stopwatch: frameState.stopwatch.status,
    };
    for (const key of TABS) {
      const dot = el(`dot-${key}`);
      dot.hidden = statuses[key] !== "running";
      const sr = dot.querySelector(".sr-only");
      if (sr) sr.textContent = label("running");
    }
  }

  function drawBanner() {
    if (!frameState) return;
    const notifications = frameState.notifications;
    const show = notifications !== null && notifications.permission !== "granted";
    el("banner").hidden = !show;
    if (!show) return;
    setText("banner-text", label("notificationsOff"));
    setText("allow-notifications", label("allowNotifications"));
  }

  function drawLive() {
    if (!frameState) return;
    /** @type {string} */
    let text = "";
    const timerState = frameState.timer.state;
    if (timerState.status === "ended") {
      text = label("timerEndedAnnounce");
    } else if (timerState.status === "running" || timerState.status === "paused") {
      const minutes = Math.ceil(remainingTimer(timerState, Date.now()) / MS_PER_MINUTE);
      text = minutes <= 1 ? label("oneMinuteLeft") : fill(label("minutesLeft"), { n: minutes });
    }
    const live = el("live");
    if (live.textContent !== text) live.textContent = text;
  }

  function drawToday() {
    if (!frameState) return;
    const count = todayCount(frameState.pomodoro.today, Date.now(), offsetNow());
    setText("pomodoros-today", fill(label("pomodorosToday"), { n: count }));
  }

  /** @param {CycleState} state @param {PomodoroSettings} settings @param {number} remaining */
  function drawCycle(state, settings, remaining) {
    const current = cycleIndex(state, settings.longBreakEvery);
    const items = cycleSteps(settings.longBreakEvery).map((phase, index) => {
      const item = document.createElement("li");
      item.className =
        "cycle-step " +
        (phase === "pomodoro" ? "pomodoro" : "break") +
        (index < current ? " done" : index === current ? " now" : " next");
      const dot = document.createElement("span");
      dot.className = "step-dot";
      const name = document.createElement("span");
      name.className = "step-label";
      name.textContent = phaseLabel(phase);
      const length = document.createElement("span");
      length.className = "step-length";
      if (index === current) {
        length.textContent = fill(label("timeLeft"), { time: formatDuration(remaining) });
      } else {
        length.textContent = formatDuration(phaseLength(phase, settings));
      }
      item.append(dot, name, length);
      return item;
    });
    el("cycle-list").replaceChildren(...items);
  }

  function drawPomodoro() {
    if (!frameState) return;
    const snapshot = frameState.pomodoro;
    const state = snapshot.state;
    const settings = snapshot.settings;
    const now = Date.now();
    const remaining = remainingCycle(state, settings, now);
    const length = phaseLength(state.phase, settings);
    const progress = length > 0 ? remaining / length : 0;
    const digits = formatDuration(remaining);

    setText(
      "pomodoro-phase",
      fill(label("pomodoroOfCycle"), { n: state.pomodoro, total: settings.longBreakEvery })
    );

    setText("pomodoro-time", digits);
    el("pomodoro-time").setAttribute("aria-label", fill(label("timeLeft"), { time: digits }));

    /** @type {string} */
    let sub;
    if (state.status === "ended") {
      sub = fill(label("phaseEnded"), { phase: phaseLabel(state.phase) });
    } else {
      sub = fill(label("ofLength"), { length: formatDuration(length) });
      if (state.status === "running") {
        sub +=
          " · " +
          fill(label("endsAt"), {
            time: formatClockTime(state.endsAt, offsetNow(), hourCycle),
          });
      }
    }
    setText("pomodoro-sub", sub);

    drawRing("pomodoro-ring", progress);
    drawTicks("pomodoro-ticks", progress);

    const running = state.status === "running";
    setText(
      "pomodoro-primary-label",
      label(running ? "pause" : state.status === "paused" ? "resume" : "start")
    );
    drawIcon("pomodoro-primary-icon", running ? "pause" : "play");

    drawCycle(state, settings, remaining);

    const lengths = fill(label("cycleLengths"), {
      pomodoro: settings.pomodoroMinutes,
      short: settings.shortBreakMinutes,
      long: settings.longBreakMinutes,
    });
    const summary = settings.autoStartBreaks
      ? `${lengths}, ${label("breaksStartOnTheirOwn")}`
      : lengths;
    setText("cycle-lengths", summary);
    setAttr("pomodoro-settings-open", "aria-label", `${label("pomodoroSettings")}, ${summary}`);
  }

  /** @param {string} id @param {number} value */
  function setInput(id, value) {
    /** @type {HTMLInputElement} */ (el(id)).value = pad2(value);
  }

  /** @param {string} id @returns {number} */
  function readInput(id) {
    const value = Number.parseInt(/** @type {HTMLInputElement} */ (el(id)).value, 10);
    return Number.isFinite(value) ? value : 0;
  }

  /** @param {number[]} recent @param {number} length */
  function drawRecent(recent, length) {
    el("recent-block").hidden = recent.length === 0;
    const chips = recent.map((value) => {
      const chip = document.createElement("button");
      chip.type = "button";
      chip.className = "chip";
      chip.textContent = formatDuration(value);
      chip.setAttribute("aria-pressed", value === length ? "true" : "false");
      chip.addEventListener("click", () => post({ kind: "timer.setLength", length: value }));
      return chip;
    });
    el("recent-list").replaceChildren(...chips);
  }

  function drawTimerTime() {
    if (!frameState) return;
    const state = frameState.timer.state;
    if (state.status === "idle" || state.status === "ended") return;
    const remaining = remainingTimer(state, Date.now());
    const length = state.length;
    const progress = length > 0 ? remaining / length : 0;
    const digits = formatDuration(remaining);
    setText("timer-time", digits);
    el("timer-time").setAttribute("aria-label", fill(label("timeLeft"), { time: digits }));
    setText(
      "timer-sub",
      state.status === "running"
        ? fill(label("endsAt"), {
            time: formatClockTime(state.endsAt, offsetNow(), hourCycle),
          })
        : ""
    );
    drawRing("timer-ring", progress);
    drawTicks("timer-ticks", progress);
  }

  function drawTimer() {
    if (!frameState) return;
    const state = frameState.timer.state;
    const setup = state.status === "idle" || state.status === "ended";
    el("timer-setup").hidden = !setup;
    el("timer-run").hidden = setup;

    if (setup) {
      const parts = splitDuration(state.length);
      const editing =
        document.activeElement === el("timer-hours") ||
        document.activeElement === el("timer-minutes") ||
        document.activeElement === el("timer-seconds");
      if (!editing) {
        setInput("timer-hours", parts.hours);
        setInput("timer-minutes", parts.minutes);
        setInput("timer-seconds", parts.seconds);
      }
      drawRecent(frameState.timer.recent, state.length);
      setText(
        "timer-primary-label",
        fill(label("startLength"), { length: formatDuration(state.length) })
      );
      drawIcon("timer-primary-icon", "play");
      el("timer-reset").hidden = state.status !== "ended";
      return;
    }

    drawTimerTime();
    const running = state.status === "running";
    setText("timer-primary-label", label(running ? "pause" : "resume"));
    drawIcon("timer-primary-icon", running ? "pause" : "play");
    el("timer-reset").hidden = false;
  }

  /**
   * Draws the Laps table, newest first, with the Fastest and Slowest Lap tagged.
   * @param {Lap[]} laps
   */
  function drawLaps(laps) {
    const shown = laps.length > 0;
    el("laps-panel").hidden = !shown;
    el("laps-card").hidden = !shown;
    const bounds = lapBounds(laps);
    const key = `${laps.map((lap) => `${lap.length}:${lap.total}`).join(",")}|${label("fastest")}|${label("slowest")}`;
    if (key === lapKeys) return;
    lapKeys = key;
    const rows = [];
    for (let index = laps.length - 1; index >= 0; index--) {
      const lap = laps[index];
      const row = document.createElement("tr");
      const number = document.createElement("td");
      const group = document.createElement("span");
      group.className = "lap-number";
      const ordinal = document.createElement("span");
      ordinal.className = "number";
      ordinal.textContent = String(index + 1);
      group.append(ordinal);
      /** @type {"fastest" | "slowest" | null} */
      let tag = null;
      if (index === bounds.fastest) tag = "fastest";
      else if (index === bounds.slowest) tag = "slowest";
      if (tag !== null) {
        const badge = document.createElement("span");
        badge.className = `tag ${tag}`;
        badge.textContent = label(tag);
        group.append(badge);
      }
      number.append(group);
      const lapCell = document.createElement("td");
      lapCell.className = "numeric";
      lapCell.textContent = formatLap(lap.length);
      const totalCell = document.createElement("td");
      totalCell.className = "numeric total";
      totalCell.textContent = formatLap(lap.total);
      row.append(number, lapCell, totalCell);
      rows.push(row);
    }
    el("laps-body").replaceChildren(...rows);
  }

  /**
   * Draws one bar per Lap, with the Lap in progress in the primary color.
   * @param {Lap[]} laps
   * @param {boolean} running
   * @param {number} current
   */
  function drawLapBars(laps, running, current) {
    /** @param {number} ms @returns {number} */
    const flexOf = (ms) => Math.max(1, Math.floor(ms / MS_PER_SECOND));
    const strip = el("stopwatch-bars");
    const key = `${laps.map((lap) => Math.round(lap.length)).join(",")}|${running}`;
    if (key === lapBarKeys) {
      if (running) {
        const bar = strip.lastElementChild;
        if (bar instanceof HTMLElement) bar.style.flexGrow = String(flexOf(current));
      }
      return;
    }
    lapBarKeys = key;
    /** @type {number[]} */
    const lengths = laps.map((lap) => lap.length);
    if (running) lengths.push(current);
    strip.hidden = lengths.length === 0;
    strip.replaceChildren(
      ...lengths.map((length, index) => {
        const bar = document.createElement("span");
        const last = index === lengths.length - 1;
        bar.className = running && last ? "lap-bar current" : "lap-bar";
        bar.style.flexGrow = String(flexOf(length));
        return bar;
      })
    );
  }

  function drawStopwatch() {
    if (!frameState) return;
    const state = frameState.stopwatch;
    const now = Date.now();
    const elapsed = elapsedStopwatch(state, now);
    const laps = state.status === "idle" ? [] : state.laps;
    const running = state.status === "running";

    setText("stopwatch-digits", formatStopwatch(elapsed));
    setText("stopwatch-hundredths", formatHundredths(elapsed));
    setAttr(
      "stopwatch-time",
      "aria-label",
      fill(label("timeElapsed"), { time: formatStopwatch(elapsed) })
    );

    el("stopwatch-lap").hidden = !running;
    el("stopwatch-reset").hidden = state.status !== "paused";
    setText(
      "stopwatch-primary-label",
      label(running ? "pause" : state.status === "paused" ? "resume" : "start")
    );
    const icon = running ? "pause" : "play";
    if (icon !== stopwatchIcon) {
      stopwatchIcon = icon;
      drawIcon("stopwatch-primary-icon", icon);
    }

    const lastTotal = laps.length > 0 ? laps[laps.length - 1].total : 0;
    const current = Math.max(0, elapsed - lastTotal);
    el("stopwatch-lap-line").hidden = !running;
    if (running) {
      setText("stopwatch-lap-pill", fill(label("lapNumber"), { n: laps.length + 1 }));
      setText("stopwatch-lap-time", fill(label("thisLap"), { time: formatLap(current) }));
    }

    drawLapBars(laps, running, current);
    drawLaps(laps);
  }

  /**
   * @param {AlsoData} data
   * @returns {HTMLElement}
   */
  function buildAlsoRow(data) {
    const row = document.createElement("div");
    row.className = "also-row";
    const svg = document.createElementNS(SVG_NS, "svg");
    svg.setAttribute("aria-hidden", "true");
    svg.setAttribute("width", "44");
    svg.setAttribute("height", "44");
    svg.setAttribute("viewBox", "0 0 44 44");
    const track = document.createElementNS(SVG_NS, "circle");
    track.setAttribute("class", "mini-track");
    track.setAttribute("cx", "22");
    track.setAttribute("cy", "22");
    track.setAttribute("r", "18");
    track.setAttribute("fill", "none");
    track.setAttribute("stroke-width", "4");
    const value = document.createElementNS(SVG_NS, "circle");
    value.setAttribute("class", "mini-value");
    value.setAttribute("cx", "22");
    value.setAttribute("cy", "22");
    value.setAttribute("r", "18");
    value.setAttribute("fill", "none");
    value.setAttribute("stroke-width", "4");
    value.setAttribute("stroke-linecap", "round");
    value.setAttribute("stroke-dasharray", String(MINI_CIRCUMFERENCE));
    value.setAttribute("transform", "rotate(-90 22 22)");
    svg.append(track, value);

    const text = document.createElement("div");
    text.className = "also-text";
    const title = document.createElement("span");
    title.className = "also-title";
    const subtitle = document.createElement("span");
    subtitle.className = "also-sub";
    text.append(title, subtitle);

    const button = document.createElement("button");
    button.type = "button";
    button.className = "link-button";
    button.addEventListener("click", () => chooseTab(data.target, true));

    row.append(svg, text, button);
    applyAlsoRow(row, data);
    return row;
  }

  /**
   * @param {HTMLElement} row
   * @param {AlsoData} data
   */
  function applyAlsoRow(row, data) {
    const title = row.querySelector(".also-title");
    if (title) title.textContent = data.title;
    const subtitle = row.querySelector(".also-sub");
    if (subtitle) subtitle.textContent = data.subtitle;
    const value = row.querySelector(".mini-value");
    if (value) {
      value.setAttribute("stroke-dashoffset", String(MINI_CIRCUMFERENCE * (1 - data.progress)));
    }
    const button = /** @type {HTMLButtonElement | null} */ (row.querySelector("button"));
    if (button) {
      button.textContent = label("open");
      button.setAttribute("aria-label", `${label("open")}: ${data.title}`);
    }
  }

  /** @returns {AlsoData[]} */
  function alsoData() {
    if (!frameState) return [];
    const now = Date.now();
    /** @type {AlsoData[]} */
    const rows = [];
    const pomodoro = frameState.pomodoro;
    if (pomodoro.state.status === "running" || pomodoro.state.status === "paused") {
      const remaining = remainingCycle(pomodoro.state, pomodoro.settings, now);
      const length = phaseLength(pomodoro.state.phase, pomodoro.settings);
      rows.push({
        progress: length > 0 ? remaining / length : 0,
        title: fill(label("pomodoroOfCycle"), {
          n: pomodoro.state.pomodoro,
          total: pomodoro.settings.longBreakEvery,
        }),
        subtitle: fill(label("timeLeft"), { time: formatDuration(remaining) }),
        target: "pomodoro",
      });
    }
    const stopwatch = frameState.stopwatch;
    if (stopwatch.status === "running" || stopwatch.status === "paused") {
      const elapsed = elapsedStopwatch(stopwatch, now);
      rows.push({
        progress: (elapsed % MS_PER_MINUTE) / MS_PER_MINUTE,
        title: label("stopwatch"),
        subtitle: fill(label("timeElapsed"), { time: formatElapsed(elapsed) }),
        target: "stopwatch",
      });
    }
    return rows;
  }

  function drawAlsoRunning() {
    if (!frameState) return;
    const rows = alsoData();
    const card = el("also-running");
    card.hidden = rows.length === 0;
    if (rows.length === 0) {
      alsoKeys = "";
      el("also-running-list").replaceChildren();
      return;
    }
    const keys = rows.map((data) => data.target).join(",");
    const list = el("also-running-list");
    if (keys === alsoKeys) {
      rows.forEach((data, index) => {
        applyAlsoRow(/** @type {HTMLElement} */ (list.children[index]), data);
      });
      return;
    }
    alsoKeys = keys;
    list.replaceChildren(...rows.map((data) => buildAlsoRow(data)));
  }

  function drawAlerts() {
    if (!frameState) return;
    const notifications = frameState.notifications;
    /** @type {string | null} */
    let message = null;
    if (notifications) {
      if (!notifications.canScheduleWhileClosed) message = label("alertsNeedOpen");
      else if (!notifications.exactTiming) message = label("alertsMayBeLate");
    }
    el("alerts-card").hidden = message === null;
    if (message !== null) setText("alerts-text", message);
  }

  /** @param {keyof typeof ICON_PATHS} kind @returns {HTMLButtonElement} */
  function iconButton(kind) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "icon-button";
    const svg = document.createElementNS(SVG_NS, "svg");
    svg.setAttribute("aria-hidden", "true");
    svg.setAttribute("width", "18");
    svg.setAttribute("height", "18");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("fill", "none");
    svg.setAttribute("stroke", "currentColor");
    svg.setAttribute("stroke-width", "2");
    svg.setAttribute("stroke-linecap", "round");
    svg.setAttribute("stroke-linejoin", "round");
    for (const path of ICON_PATHS[kind]) {
      const shape = document.createElementNS(SVG_NS, "path");
      shape.setAttribute("d", path);
      svg.append(shape);
    }
    button.append(svg);
    return button;
  }

  /** @param {string} id @returns {Alarm | null} */
  function currentAlarm(id) {
    if (!frameState) return null;
    return frameState.alarms.find((alarm) => alarm.id === id) ?? null;
  }

  /** @param {Alarm} alarm @returns {AlarmDraft} */
  function alarmDraft(alarm) {
    return {
      id: alarm.id,
      hour: alarm.hour,
      minute: alarm.minute,
      label: alarm.label,
      weekdays: [...alarm.weekdays],
      time: alarmTimeText(alarm),
    };
  }

  /**
   * @param {Alarm} alarm
   * @returns {HTMLElement}
   */
  function buildAlarmRow(alarm) {
    const item = document.createElement("li");
    item.className = "alarm";

    const top = document.createElement("div");
    top.className = "alarm-top";
    const text = document.createElement("div");
    text.className = "alarm-text";
    const time = document.createElement("span");
    time.className = "alarm-time";
    const caption = document.createElement("span");
    caption.className = "alarm-label";
    text.append(time, caption);

    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "switch";
    toggle.setAttribute("role", "switch");
    const track = document.createElement("span");
    track.className = "track";
    const knob = document.createElement("span");
    knob.className = "knob";
    track.append(knob);
    toggle.append(track);
    toggle.addEventListener("click", () => {
      const current = currentAlarm(alarm.id);
      if (current !== null) {
        post({ kind: "alarm.setEnabled", id: alarm.id, enabled: !current.enabled });
      }
    });
    top.append(text, toggle);

    const foot = document.createElement("div");
    foot.className = "alarm-foot";
    const repeat = document.createElement("span");
    repeat.className = "alarm-repeat";
    const actions = document.createElement("span");
    actions.className = "alarm-actions";
    const edit = iconButton("edit");
    edit.addEventListener("click", () => {
      const current = currentAlarm(alarm.id);
      if (current !== null) openEditor(alarmDraft(current), edit);
    });
    const remove = iconButton("remove");
    remove.className = "icon-button destructive";
    remove.addEventListener("click", () => openDeleteConfirm(alarm.id, remove));
    actions.append(edit, remove);
    foot.append(repeat, actions);

    item.append(top, foot);
    return item;
  }

  /**
   * The seven weekday chips, on for the days the Alarm repeats on. Each letter
   * is the first character of the localized short weekday name.
   * @param {Alarm} alarm
   * @returns {HTMLElement[]}
   */
  function repeatChips(alarm) {
    return WEEKDAY_KEYS.map((name, day) => {
      const chip = document.createElement("span");
      chip.className = alarm.weekdays.includes(day) ? "day-chip on" : "day-chip";
      chip.setAttribute("aria-hidden", "true");
      chip.textContent = label(name).slice(0, 1);
      return chip;
    });
  }

  /**
   * @param {HTMLElement} repeat the row's repeat container
   * @param {Alarm} alarm
   */
  function applyRepeat(repeat, alarm) {
    const text = alarmRepeatText(alarm);
    const key = `${alarm.weekdays.join(",")}|${text}`;
    if (repeat.dataset.key === key) return;
    repeat.dataset.key = key;
    if (alarm.weekdays.length === 0) {
      repeat.removeAttribute("aria-label");
      repeat.textContent = text;
      return;
    }
    repeat.setAttribute("aria-label", text);
    repeat.replaceChildren(...repeatChips(alarm));
  }

  /**
   * @param {HTMLElement} row
   * @param {Alarm} alarm
   * @param {Alarm[]} list
   */
  function applyAlarmRow(row, alarm, list) {
    row.className = alarm.enabled ? "alarm" : "alarm off";
    const time = row.querySelector(".alarm-time");
    if (time !== null) time.textContent = alarmTimeText(alarm);
    const caption = row.querySelector(".alarm-label");
    if (caption !== null) {
      caption.textContent = alarm.label;
      caption.hidden = alarm.label === "";
    }
    const name = alarmName(alarm, list);
    const toggle = row.querySelector(".switch");
    if (toggle !== null) {
      toggle.setAttribute("aria-checked", alarm.enabled ? "true" : "false");
      toggle.setAttribute("aria-label", fill(label("alarmSwitch"), { time: name }));
    }
    const repeat = row.querySelector(".alarm-repeat");
    if (repeat instanceof HTMLElement) applyRepeat(repeat, alarm);
    const actions = row.querySelectorAll(".icon-button");
    const edit = actions[0];
    if (edit !== undefined) {
      edit.setAttribute("aria-label", fill(label("editAlarm"), { time: name }));
    }
    const remove = actions[1];
    if (remove !== undefined) {
      remove.setAttribute("aria-label", fill(label("deleteAlarm"), { time: name }));
    }
  }

  /**
   * Puts focus on the Delete button of the row that took the deleted Alarm's
   * place, else on the row before it, so a deletion never drops focus to body.
   * @param {number} index
   */
  function focusAfterRemove(index) {
    const rows = el("alarm-list").querySelectorAll("li");
    const row = rows[index] instanceof HTMLElement ? rows[index] : rows[index - 1];
    const remove =
      row instanceof HTMLElement ? row.querySelector(".icon-button.destructive") : null;
    if (remove instanceof HTMLElement) {
      remove.focus();
      return;
    }
    el("add-alarm").focus();
  }

  function drawAlarms() {
    if (!frameState) return;
    const list = frameState.alarms;
    const next = nextAlarmText(Date.now());
    el("next-alarm").hidden = next === null;
    if (next !== null) setText("next-alarm", next);

    el("no-alarms").hidden = list.length > 0;
    setText("no-alarms", label("noAlarms"));

    const items = el("alarm-list");
    const key = list.map((alarm) => alarm.id).join(",");
    if (key !== alarmKeys) {
      alarmKeys = key;
      items.replaceChildren(...list.map((alarm) => buildAlarmRow(alarm)));
    }
    list.forEach((alarm, index) => {
      const row = items.children[index];
      if (row instanceof HTMLElement) applyAlarmRow(row, alarm, list);
    });

    const removed = pendingRemoveFocus;
    if (removed !== null && !list.some((alarm) => alarm.id === removed.id)) {
      pendingRemoveFocus = null;
      focusAfterRemove(removed.index);
    }
  }

  /** @returns {HTMLInputElement[]} */
  function dayInputs() {
    return Array.from(el("alarm-days").querySelectorAll("input"));
  }

  /** Draws the seven weekday toggles, keeping the ones already checked. */
  function drawDays() {
    const key = WEEKDAY_KEYS.map((name) => label(name)).join("|");
    if (key === daysKey) return;
    daysKey = key;
    const checked = new Set(
      dayInputs()
        .filter((input) => input.checked)
        .map((input) => input.value)
    );
    const days = WEEKDAY_KEYS.map((name, day) => {
      const wrapper = document.createElement("label");
      wrapper.className = "day";
      const input = document.createElement("input");
      input.type = "checkbox";
      input.value = String(day);
      input.checked = checked.has(input.value);
      const text = document.createElement("span");
      text.textContent = label(name);
      wrapper.append(input, text);
      return wrapper;
    });
    el("alarm-days").replaceChildren(...days);
  }

  function drawEditorTitle() {
    if (editor === null) return;
    setText(
      "alarm-editor-title",
      editor.id === null ? label("addAlarm") : fill(label("editAlarm"), { time: editor.time ?? "" })
    );
  }

  /** @returns {AlarmDraft} */
  function newAlarmDraft() {
    const local = new Date();
    return {
      id: null,
      hour: local.getHours(),
      minute: local.getMinutes(),
      label: "",
      weekdays: [],
      time: null,
    };
  }

  /**
   * Shows a modal dialog, remembering what opened it and how it closes.
   * @param {OpenDialog} next
   */
  function showDialog(next) {
    dialog = next;
    el(next.id).hidden = false;
  }

  /** Hides the open dialog and gives focus back to the control that opened it. */
  function hideDialog() {
    if (dialog === null) return;
    const { id, opener } = dialog;
    dialog = null;
    el(id).hidden = true;
    if (opener !== null && document.contains(opener)) opener.focus();
  }

  /**
   * Opens the editor with a draft, and remembers the control to give focus back
   * to once it closes.
   * @param {AlarmDraft} draft
   * @param {HTMLElement | null} opener
   */
  function openEditor(draft, opener) {
    editor = { ...draft };
    /** @type {HTMLInputElement} */ (el("alarm-hour")).value = pad2(draft.hour);
    /** @type {HTMLInputElement} */ (el("alarm-minute")).value = pad2(draft.minute);
    /** @type {HTMLInputElement} */ (el("alarm-label")).value = draft.label;
    for (const input of dayInputs()) input.checked = draft.weekdays.includes(Number(input.value));
    for (const [id] of ALARM_FIELDS) setFieldError(id, "");
    showDialog({ id: "alarm-editor", opener, backdrop: "focus", close: closeEditor });
    drawEditorTitle();
    el("alarm-label").focus();
  }

  function closeEditor() {
    if (editor === null) return;
    editor = null;
    hideDialog();
  }

  /**
   * Posts the editor's Alarm, or, when the hour or minute is out of range,
   * shows each field's message, focuses the first, and stays open: Save never
   * corrects a value the author typed.
   */
  function saveEditor() {
    if (editor === null) return;
    const firstInvalid = firstInvalidField(ALARM_FIELDS);
    if (firstInvalid !== null) {
      el(firstInvalid).focus();
      return;
    }
    const input = {
      // Parsed as the check read them, so "1e1" posts the 10 it was checked as.
      hour: Number(/** @type {HTMLInputElement} */ (el("alarm-hour")).value),
      minute: Number(/** @type {HTMLInputElement} */ (el("alarm-minute")).value),
      label: /** @type {HTMLInputElement} */ (el("alarm-label")).value,
      weekdays: dayInputs()
        .filter((input) => input.checked)
        .map((input) => Number(input.value))
        .sort((a, b) => a - b),
    };
    if (editor.id === null) post({ kind: "alarm.add", input });
    else post({ kind: "alarm.edit", id: editor.id, input });
    closeEditor();
  }

  /**
   * Asks before deleting: the confirmation names the Alarm, and its focus
   * starts on Cancel so a stray Enter keeps the Alarm.
   * @param {string} id
   * @param {HTMLElement} opener the row's Delete button, which focus returns to on Cancel
   */
  function openDeleteConfirm(id, opener) {
    const alarm = currentAlarm(id);
    if (alarm === null || frameState === null) return;
    deleteId = id;
    setText(
      "alarm-delete-body",
      fill(label("deleteAlarmBody"), { time: alarmName(alarm, frameState.alarms) })
    );
    showDialog({ id: "alarm-delete", opener, backdrop: "close", close: closeDeleteConfirm });
    el("alarm-delete-cancel").focus();
  }

  function closeDeleteConfirm() {
    if (deleteId === null) return;
    deleteId = null;
    hideDialog();
  }

  /** Deletes the Alarm; focus lands where `focusAfterRemove` puts it once the Worker drops the row. */
  function confirmDelete() {
    const id = deleteId;
    if (id === null) return;
    // The Alarm may have gone while the question was open: nothing to delete,
    // and no redraw will come to take focus, so Cancel's path closes it.
    if (currentAlarm(id) === null) {
      closeDeleteConfirm();
      return;
    }
    const index = frameState === null ? -1 : frameState.alarms.findIndex((a) => a.id === id);
    pendingRemoveFocus = { id, index: Math.max(0, index) };
    post({ kind: "alarm.remove", id });
    closeDeleteConfirm();
  }

  /**
   * The controls a dialog's Tab key reaches: not hidden, not out of the Tab
   * order, and not a Hidden Reset, which keeps its box but leaves the keyboard.
   * @param {HTMLElement} root
   * @returns {HTMLElement[]}
   */
  function focusableIn(root) {
    /** @type {HTMLElement[]} */
    const items = [];
    for (const node of root.querySelectorAll("button, input, [tabindex]")) {
      if (!(node instanceof HTMLElement) || node.hidden) continue;
      if (node.getAttribute("tabindex") === "-1") continue;
      if (node instanceof HTMLInputElement && node.type === "hidden") continue;
      // Reset is hidden by a class: check it beside the computed style, so the
      // Tab order never depends on the style block alone.
      if (node.classList.contains(RESET_HIDDEN_CLASS)) continue;
      if (window.getComputedStyle(node).visibility === "hidden") continue;
      items.push(node);
    }
    return items;
  }

  /** @param {KeyboardEvent} event */
  function onDialogKeyDown(event) {
    if (dialog === null) return;
    if (event.key === "Escape") {
      event.preventDefault();
      dialog.close();
      return;
    }
    if (event.key !== "Tab") return;
    const root = el(dialog.id);
    const items = focusableIn(root);
    if (items.length === 0) return;
    const first = items[0];
    const last = items[items.length - 1];
    const active = document.activeElement;
    if (!(active instanceof HTMLElement) || !root.contains(active)) {
      // A click on the backdrop leaves focus on the body: Tab comes back in.
      event.preventDefault();
      first.focus();
    } else if (event.shiftKey && active === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus();
    }
  }

  /**
   * A press on a dialog's backdrop is that dialog's own business: the Alarm
   * editor pulls focus back onto its first control and stays open, while the
   * Pomodoro settings close and discard their edits, and the delete
   * confirmation closes as Cancel would.
   * @param {PointerEvent} event
   */
  function onBackdropPointerDown(event) {
    if (dialog === null || !(event.target instanceof HTMLElement)) return;
    if (event.target !== el(dialog.id)) return;
    // A press on the backdrop must never take focus off the dialog's opener.
    event.preventDefault();
    if (dialog.backdrop === "close") {
      dialog.close();
      return;
    }
    const items = focusableIn(el(dialog.id));
    if (items.length > 0) items[0].focus();
  }

  /**
   * True when two settings hold the same six values.
   * @param {PomodoroSettings} a
   * @param {PomodoroSettings} b
   * @returns {boolean}
   */
  function sameSettings(a, b) {
    return (
      a.pomodoroMinutes === b.pomodoroMinutes &&
      a.shortBreakMinutes === b.shortBreakMinutes &&
      a.longBreakMinutes === b.longBreakMinutes &&
      a.longBreakEvery === b.longBreakEvery &&
      a.autoStartBreaks === b.autoStartBreaks &&
      a.autoStartPomodoros === b.autoStartPomodoros
    );
  }

  /** @param {string} id @returns {boolean} */
  function switchOn(id) {
    return el(id).getAttribute("aria-checked") === "true";
  }

  /** @param {string} id @param {boolean} on */
  function setSwitch(id, on) {
    el(id).setAttribute("aria-checked", on ? "true" : "false");
  }

  /** @param {string} value @param {{ min: number, max: number }} range @returns {boolean} */
  function isFieldValueValid(value, range) {
    if (value.trim() === "") return false;
    const number = Number(value);
    return Number.isInteger(number) && number >= range.min && number <= range.max;
  }

  /**
   * Marks one dialog field invalid or clears it: the input's aria-invalid,
   * the message under it, and the aria-describedby link between the two.
   * @param {string} id
   * @param {string} message
   */
  function setFieldError(id, message) {
    const input = /** @type {HTMLInputElement} */ (el(id));
    const node = el(`${id}-error`);
    if (message === "") {
      input.removeAttribute("aria-invalid");
      input.removeAttribute("aria-describedby");
      node.textContent = "";
      return;
    }
    input.setAttribute("aria-invalid", "true");
    input.setAttribute("aria-describedby", node.id);
    node.textContent = message;
  }

  /**
   * Re-checks one dialog field and refreshes its error. A keystroke passes
   * `show` false, so a field whose error is hidden never raises a new one
   * mid-typing; a shown error still clears the moment the value is valid.
   * @param {string} id
   * @param {{ min: number, max: number }} range
   * @param {string} messageKey
   * @param {boolean} show
   * @returns {boolean}
   */
  function checkField(id, range, messageKey, show) {
    const value = /** @type {HTMLInputElement} */ (el(id)).value;
    const valid = isFieldValueValid(value, range);
    if (valid) setFieldError(id, "");
    else if (show) setFieldError(id, fill(label(messageKey), { min: range.min, max: range.max }));
    return valid;
  }

  /**
   * Checks every field of one dialog, showing each one's message, and returns
   * the first invalid field's id, or null when all hold valid values.
   * @param {ReadonlyArray<readonly [string, { min: number, max: number }, string]>} fields
   * @returns {string | null}
   */
  function firstInvalidField(fields) {
    /** @type {string | null} */
    let first = null;
    for (const [id, range, messageKey] of fields) {
      if (!checkField(id, range, messageKey, true) && first === null) first = id;
    }
    return first;
  }

  /** Clears every settings field's error, which opening and Reset both do. */
  function clearSettingsErrors() {
    for (const [id] of SETTINGS_FIELDS) setFieldError(id, "");
  }

  /** What the settings dialog's fields hold right now, parsed the way Save posts it. */
  function settingsFromFields() {
    /** @type {PomodoroSettings} */
    const settings = { ...DEFAULT_POMODORO_SETTINGS };
    for (const [id, key] of SETTINGS_FIELDS) {
      settings[key] = Number(/** @type {HTMLInputElement} */ (el(id)).value);
    }
    for (const [id, key] of SETTINGS_SWITCHES) {
      settings[key] = switchOn(id);
    }
    return settings;
  }

  /** @param {PomodoroSettings} settings */
  function fillSettings(settings) {
    for (const [id, key] of SETTINGS_FIELDS) {
      /** @type {HTMLInputElement} */ (el(id)).value = String(settings[key]);
    }
    for (const [id, key] of SETTINGS_SWITCHES) {
      setSwitch(id, settings[key]);
    }
  }

  /** Shows Reset only while the fields hold something other than the defaults. */
  function drawResetButton() {
    el("pomodoro-settings-reset").classList.toggle(
      RESET_HIDDEN_CLASS,
      sameSettings(settingsFromFields(), DEFAULT_POMODORO_SETTINGS)
    );
  }

  /** @param {HTMLElement | null} opener */
  function openSettings(opener) {
    if (!frameState) return;
    fillSettings(frameState.pomodoro.settings);
    clearSettingsErrors();
    showDialog({ id: "pomodoro-settings", opener, backdrop: "close", close: hideDialog });
    drawResetButton();
    el("settings-pomodoro").focus();
  }

  function saveSettings() {
    if (dialog === null) return;
    const firstInvalid = firstInvalidField(
      SETTINGS_FIELDS.map(([id, , range, messageKey]) => [id, range, messageKey])
    );
    if (firstInvalid !== null) {
      el(firstInvalid).focus();
      return;
    }
    post({ kind: "pomodoro.setSettings", settings: settingsFromFields() });
    hideDialog();
  }

  /** Fills the defaults and posts nothing; Reset has just left the Tab order. */
  function resetSettings() {
    if (dialog === null) return;
    fillSettings(DEFAULT_POMODORO_SETTINGS);
    clearSettingsErrors();
    drawResetButton();
    el("settings-pomodoro").focus();
  }

  function drawTimed() {
    if (!labels || !frameState) return;
    drawLive();
    drawToday();
    drawPomodoro();
    drawTimerTime();
    drawAlsoRunning();
    drawStopwatch();
    drawAlarms();
  }

  function scheduleTick() {
    if (tickHandle !== 0) {
      clearInterval(tickHandle);
      tickHandle = 0;
    }
    if (!frameState) return;
    const running =
      frameState.timer.state.status === "running" ||
      frameState.pomodoro.state.status === "running" ||
      frameState.stopwatch.status === "running";
    if (running || activeTab === "pomodoro") {
      tickHandle = window.setInterval(drawTimed, TICK_MS);
    }
  }

  /** Draws each animation frame while the Stopwatch runs and its tab shows, and no other time. */
  function animationFrame() {
    rafHandle = 0;
    if (!frameState) return;
    if (frameState.stopwatch.status !== "running" || activeTab !== "stopwatch") return;
    drawStopwatch();
    rafHandle = window.requestAnimationFrame(animationFrame);
  }

  function scheduleAnimation() {
    if (rafHandle !== 0) {
      window.cancelAnimationFrame(rafHandle);
      rafHandle = 0;
    }
    if (!frameState) return;
    if (frameState.stopwatch.status === "running" && activeTab === "stopwatch") {
      rafHandle = window.requestAnimationFrame(animationFrame);
    }
  }

  function renderAll() {
    const ready = labels !== null && frameState !== null;
    el("clock").hidden = !ready;
    if (!ready) return;
    drawStatic();
    drawTabs();
    drawBanner();
    drawLive();
    drawToday();
    drawPomodoro();
    drawTimer();
    drawAlsoRunning();
    drawAlerts();
    drawStopwatch();
    drawAlarms();
    scheduleTick();
    scheduleAnimation();
  }

  /** @param {MessageEvent} event */
  function onMessage(event) {
    const data = /** @type {WorkerToFrameMessage} */ (event.data);
    if (!data || typeof data !== "object") return;
    if (data.kind === "labels") {
      labels = data.labels;
      hourCycle = data.hourCycle === 12 ? 12 : 24;
      if (typeof data.language === "string") document.documentElement.lang = data.language;
    } else if (data.kind === "state") {
      frameState = data;
      if (followStoredTab && TABS.includes(data.tab) && data.tab !== activeTab) {
        selectTab(data.tab, false);
      }
    } else if (data.kind === "pomodoro.openSettings") {
      // The Worker holds this until the labels and state are out, so the Frame
      // is already drawn: select the tab and open the dialog without a redraw.
      chooseTab("pomodoro", false);
      openSettings(el("pomodoro-settings-open"));
      return;
    } else {
      return;
    }
    renderAll();
  }

  /** @param {KeyboardEvent} event */
  function onTabKeyDown(event) {
    const index = TABS.indexOf(activeTab);
    /** @type {string | null} */
    let next = null;
    switch (event.key) {
      case "ArrowRight":
        next = TABS[(index + 1) % TABS.length];
        break;
      case "ArrowLeft":
        next = TABS[(index + TABS.length - 1) % TABS.length];
        break;
      case "Home":
        next = TABS[0];
        break;
      case "End":
        next = TABS[TABS.length - 1];
        break;
      default:
        return;
    }
    event.preventDefault();
    chooseTab(next, true);
  }

  function postLength() {
    post({
      kind: "timer.setLength",
      length: joinDuration(
        readInput("timer-hours"),
        readInput("timer-minutes"),
        readInput("timer-seconds")
      ),
    });
  }

  /** The keys a field keeps from the host, which would otherwise turn them into focus moves. */
  const FIELD_KEYS = ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Home", "End"];

  /**
   * Keeps the caret and step keys inside the Frame's own fields. preventDefault
   * also stops a number field's native step, so the Frame steps the value itself
   * and fires the same `input` a typed value would.
   * @param {KeyboardEvent} event
   */
  function onFieldKeyDown(event) {
    const target = event.target;
    if (!(target instanceof HTMLInputElement)) return;
    if (target.type !== "number" && target.type !== "text") return;
    if (!FIELD_KEYS.includes(event.key)) return;
    event.preventDefault();
    if (target.type !== "number") return;
    const step = event.key === "ArrowUp" ? 1 : event.key === "ArrowDown" ? -1 : 0;
    if (step === 0) return;
    const min = target.min === "" ? Number.NEGATIVE_INFINITY : Number(target.min);
    const max = target.max === "" ? Number.POSITIVE_INFINITY : Number(target.max);
    const typed = Number.parseInt(target.value, 10);
    const next = Math.min(Math.max((Number.isFinite(typed) ? typed : 0) + step, min), max);
    target.value = pad2(next);
    target.dispatchEvent(new Event("input", { bubbles: true }));
  }

  for (const key of TABS) {
    el(`tab-${key}`).addEventListener("click", () => chooseTab(key, false));
  }
  el("sections").addEventListener("keydown", onTabKeyDown);

  el("pomodoro-primary").addEventListener("click", () => {
    if (!frameState) return;
    post({
      kind: frameState.pomodoro.state.status === "running" ? "pomodoro.pause" : "pomodoro.start",
    });
  });
  el("pomodoro-reset").addEventListener("click", () => post({ kind: "pomodoro.reset" }));
  el("pomodoro-skip").addEventListener("click", () => post({ kind: "pomodoro.skip" }));

  el("timer-primary").addEventListener("click", () => {
    if (!frameState) return;
    post({ kind: frameState.timer.state.status === "running" ? "timer.pause" : "timer.start" });
  });
  el("timer-reset").addEventListener("click", () => post({ kind: "timer.reset" }));

  el("stopwatch-primary").addEventListener("click", () => {
    if (!frameState) return;
    post({
      kind: frameState.stopwatch.status === "running" ? "stopwatch.pause" : "stopwatch.start",
    });
  });
  el("stopwatch-lap").addEventListener("click", () => post({ kind: "stopwatch.lap" }));
  el("stopwatch-reset").addEventListener("click", () => post({ kind: "stopwatch.reset" }));

  el("add-alarm").addEventListener("click", () => openEditor(newAlarmDraft(), el("add-alarm")));
  el("alarm-editor-close").addEventListener("click", closeEditor);
  el("alarm-cancel").addEventListener("click", closeEditor);
  el("alarm-save").addEventListener("click", saveEditor);
  el("alarm-delete-cancel").addEventListener("click", closeDeleteConfirm);
  el("alarm-delete-confirm").addEventListener("click", confirmDelete);
  el("pomodoro-settings-open").addEventListener("click", () =>
    openSettings(el("pomodoro-settings-open"))
  );
  el("pomodoro-settings-close").addEventListener("click", hideDialog);
  el("pomodoro-settings-cancel").addEventListener("click", hideDialog);
  el("pomodoro-settings-save").addEventListener("click", saveSettings);
  el("pomodoro-settings-reset").addEventListener("click", resetSettings);
  for (const [id, , range, messageKey] of SETTINGS_FIELDS) {
    el(id).addEventListener("input", () => {
      drawResetButton();
      checkField(id, range, messageKey, false);
    });
    el(id).addEventListener("blur", () => checkField(id, range, messageKey, true));
  }
  for (const [id, range, messageKey] of ALARM_FIELDS) {
    el(id).addEventListener("input", () => checkField(id, range, messageKey, false));
    el(id).addEventListener("blur", () => checkField(id, range, messageKey, true));
  }
  for (const [id] of SETTINGS_SWITCHES) {
    el(id).addEventListener("click", () => {
      setSwitch(id, !switchOn(id));
      drawResetButton();
    });
  }
  document.addEventListener("keydown", onDialogKeyDown);
  el("alarm-editor").addEventListener("pointerdown", onBackdropPointerDown);
  el("pomodoro-settings").addEventListener("pointerdown", onBackdropPointerDown);
  el("alarm-delete").addEventListener("pointerdown", onBackdropPointerDown);
  document.addEventListener("keydown", onFieldKeyDown);

  for (const key of ["timer-hours", "timer-minutes", "timer-seconds"]) {
    el(key).addEventListener("input", postLength);
  }

  el("allow-notifications").addEventListener("click", () => post({ kind: "notifications.allow" }));

  window.addEventListener("pagehide", () => {
    document.removeEventListener("keydown", onDialogKeyDown);
    document.removeEventListener("keydown", onFieldKeyDown);
    if (tickHandle !== 0) {
      clearInterval(tickHandle);
      tickHandle = 0;
    }
    if (rafHandle !== 0) {
      window.cancelAnimationFrame(rafHandle);
      rafHandle = 0;
    }
    post({ kind: "closed" });
  });

  selectTab(activeTab, false);

  if (port) {
    port.onmessage = (event) => onMessage(event);
    port.start();
  }
})();
