// @ts-check
/* The Clock Frame's shell (#886): the Pomodoro and Timer tabs, the section bar
   they share, the notifications banner, and the live region. The Frame's only
   host channel is `window.maibuk.port`: the Worker sends the localized labels
   and the whole state as raw JSON, and the Frame answers with one control
   message per press. Labels may arrive after the first state, so the page stays
   empty until both have arrived.

   The Stopwatch and Alarms tabs' own panels are unit 2b; this script draws
   their tabs and running dots and leaves the panels empty.

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
   * @typedef {{ kind: "state", timer: TimerSnapshot, pomodoro: PomodoroSnapshot, stopwatch: StopwatchState, alarms: Alarm[], notifications: FrameNotificationStatus | null }} FrameStateMessage
   * @typedef {FrameLabelsMessage | FrameStateMessage} WorkerToFrameMessage
   * @typedef {{ progress: number, title: string, subtitle: string, target: "pomodoro" | "stopwatch" }} AlsoData
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
  const TICK_MS = 1_000;

  const PLAY_PATH = "M7 4.5v15a1 1 0 0 0 1.5.86l12-7.5a1 1 0 0 0 0-1.72l-12-7.5A1 1 0 0 0 7 4.5z";

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
    return `${hours12}:${pad2(minutes)} ${hours < 12 ? "AM" : "PM"}`;
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
  let activeTab = "timer";
  let tickHandle = 0;
  let alsoKeys = "";

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
    if (focus) el(`tab-${name}`).focus();
    scheduleTick();
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
    setText(
      "cycle-lengths",
      settings.autoStartBreaks ? `${lengths}, ${label("breaksStartOnTheirOwn")}` : lengths
    );
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
    button.addEventListener("click", () => selectTab(data.target, true));

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

  function drawTimed() {
    if (!labels || !frameState) return;
    drawLive();
    drawToday();
    drawPomodoro();
    drawTimerTime();
    drawAlsoRunning();
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
    scheduleTick();
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
    selectTab(next, true);
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

  for (const key of TABS) {
    el(`tab-${key}`).addEventListener("click", () => selectTab(key, false));
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

  for (const key of ["timer-hours", "timer-minutes", "timer-seconds"]) {
    el(key).addEventListener("input", postLength);
  }

  el("allow-notifications").addEventListener("click", () => post({ kind: "notifications.allow" }));

  window.addEventListener("pagehide", () => {
    if (tickHandle !== 0) {
      clearInterval(tickHandle);
      tickHandle = 0;
    }
    post({ kind: "closed" });
  });

  selectTab("timer", false);

  if (port) {
    port.onmessage = (event) => onMessage(event);
    port.start();
  }
})();
