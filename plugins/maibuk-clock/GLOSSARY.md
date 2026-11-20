# Clock

Clock is a Built-in Plugin that times the author's work: Pomodoro Cycles, a Timer, a Stopwatch, and Alarms, each announced by an Alert. These terms bind only inside `plugins/maibuk-clock/`; Maibuk's own terms come from the root `GLOSSARY.md`.

**Pomodoro**:
One timed stretch of work, 25 minutes unless the author changed it, followed by a Short Break or a Long Break.
_UI_: en "Pomodoro" / es "Pomodoro"
_Avoid_: focus, focus session (Focus Mode is Maibuk's), session, sprint, interval, Pomodoro for the Plugin (the Plugin is Clock)

**Short Break**:
The rest after a Pomodoro that does not end a Pomodoro Cycle, 5 minutes unless the author changed it.
_UI_: en "Short break" / es "Descanso corto"

**Long Break**:
The rest that ends a Pomodoro Cycle, 15 minutes unless the author changed it.
_UI_: en "Long break" / es "Descanso largo"

**Pomodoro Cycle**:
The Pomodoros, with their Short Breaks, that lead up to one Long Break: 4 Pomodoros unless the author changed it.
_Avoid_: round (close to Draft Round), set, session

**Timer**:
A countdown from a length the author sets, ending in an Alert.
_UI_: en "Timer" / es "Temporizador"
_Avoid_: countdown (as a noun), pomodoro (for a free countdown)

**Stopwatch**:
A clock that counts up from zero until the author stops it, marking Laps on the way.
_UI_: en "Stopwatch" / es "Cronómetro"

**Lap**:
One stretch of a Stopwatch's time, marked by the author, kept with its length and the total at the moment it was marked.
_UI_: en "Lap" / es "Vuelta"
_Avoid_: split

**Alarm**:
A time of day, with an optional label and optional repeat on chosen weekdays, at which an Alert fires on this device.
_UI_: en "Alarm" / es "Alarma"
_Avoid_: reminder, alert (for the Alarm itself)

**Alert**:
What fires when a Pomodoro, a break, a Timer, or an Alarm ends: a System Notification, or Maibuk's own notice when the device refuses one.
_Avoid_: alarm (for the end of a Timer or Pomodoro), ring, notification (alone)

## Relationships

- A **Pomodoro Cycle** holds one or more **Pomodoros**; each Pomodoro is followed by a **Short Break**, except the last, which is followed by the **Long Break**.
- A **Pomodoro Cycle**, a **Timer**, and a **Stopwatch** can each run at once, one of each; any number of **Alarms** can be set beside them.
- Every ending except a **Stopwatch**'s raises an **Alert**.
- Alarms and settings stay on this device: Plugin data is backed up, not synced.
