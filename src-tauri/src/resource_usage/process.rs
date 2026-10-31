//! Maibuk's own CPU and memory: this process plus every descendant.
//!
//! The tree is found through parent PIDs, never process names, so it covers
//! the WebKitGTK web and network processes and the WebView2 tree, and never
//! picks up another app's processes that happen to share a name.
//!
//! Memory is PSS on Linux (summed `/proc/<pid>/smaps_rollup`) and the private
//! working set on Windows (what Task Manager's Memory column shows), never
//! RSS: RSS counts every shared library once per process and would overstate
//! a multi-process tree. A process that can't be read is left out rather than
//! estimated.

use std::collections::{HashMap, HashSet, VecDeque};

/// One process of the tree at one moment.
#[derive(Clone, Debug, PartialEq)]
pub struct ProcessSample {
    pub pid: u32,
    /// Distinguishes a reused PID from the process that had it before.
    pub started: u64,
    /// CPU time used so far, in the same unit as `Sample::machine_time`.
    pub cpu_time: u64,
    /// PSS (Linux) or private working set (Windows); `None` when unreadable.
    pub memory: Option<u64>,
}

#[derive(Clone, Debug, Default, PartialEq)]
pub struct Sample {
    pub processes: Vec<ProcessSample>,
    /// CPU time all of the machine's cores have spent, busy or idle.
    pub machine_time: u64,
    pub machine_memory: Option<u64>,
}

impl Sample {
    /// Bytes in use and their fraction of the machine's RAM. `None` when no
    /// process could be read.
    pub fn memory(&self) -> Option<(u64, f64)> {
        let readable: Vec<u64> = self.processes.iter().filter_map(|p| p.memory).collect();
        if readable.is_empty() {
            return None;
        }
        let bytes = readable.iter().sum();
        let total = self.machine_memory.filter(|&total| total > 0)?;
        Some((bytes, bytes as f64 / total as f64))
    }
}

/// `root` and every process descending from it, given `(pid, parent)` pairs.
/// Root first; a cycle in corrupt input cannot loop.
pub fn descendants(root: u32, pairs: &[(u32, u32)]) -> Vec<u32> {
    let mut children: HashMap<u32, Vec<u32>> = HashMap::new();
    for &(pid, parent) in pairs {
        if pid != parent {
            children.entry(parent).or_default().push(pid);
        }
    }
    let mut seen = HashSet::from([root]);
    let mut order = vec![root];
    let mut queue = VecDeque::from([root]);
    while let Some(pid) = queue.pop_front() {
        for &child in children.get(&pid).into_iter().flatten() {
            if seen.insert(child) {
                order.push(child);
                queue.push_back(child);
            }
        }
    }
    order
}

/// CPU time so far per process, keyed by PID and start time.
type CpuTimes = HashMap<(u32, u64), u64>;

/// Turns successive samples into the tree's share of the whole machine's CPU.
#[derive(Default)]
pub struct CpuMeter {
    previous: Option<(CpuTimes, u64)>,
}

impl CpuMeter {
    /// The share, 0.0 to 1.0, since the previous sample; `None` for the first.
    /// A process that appeared since then counts all its time (it started
    /// inside the interval); one that exited takes its time with it.
    pub fn share(&mut self, sample: &Sample) -> Option<f64> {
        let times: CpuTimes = sample
            .processes
            .iter()
            .map(|p| ((p.pid, p.started), p.cpu_time))
            .collect();
        let previous = self.previous.replace((times.clone(), sample.machine_time));
        let (before, machine_before) = previous?;
        let elapsed = sample.machine_time.checked_sub(machine_before)?;
        if elapsed == 0 {
            return None;
        }
        let used: u64 = times
            .iter()
            .map(|(key, &time)| time.saturating_sub(before.get(key).copied().unwrap_or(0)))
            .sum();
        Some((used as f64 / elapsed as f64).min(1.0))
    }
}

#[cfg(any(target_os = "linux", test))]
pub mod linux {
    //! `/proc` parsing. Process CPU times and `/proc/stat` are both in
    //! USER_HZ ticks, so their ratio needs no conversion.

    pub struct Stat {
        pub parent: u32,
        pub started: u64,
        pub cpu_time: u64,
    }

    /// `/proc/<pid>/stat`. The command name is in parentheses and may hold
    /// spaces or `)`, so fields are counted from the last `)`.
    pub fn parse_stat(text: &str) -> Option<Stat> {
        let rest = &text[text.rfind(')')? + 1..];
        let fields: Vec<&str> = rest.split_whitespace().collect();
        // After the name: state(3) ppid(4) ... utime(14) stime(15) ... starttime(22).
        let field = |n: usize| fields.get(n - 3)?.parse::<u64>().ok();
        Some(Stat {
            parent: u32::try_from(field(4)?).ok()?,
            cpu_time: field(14)? + field(15)?,
            started: field(22)?,
        })
    }

    /// Total of the `cpu` line of `/proc/stat`. Guest time is already inside
    /// user and nice, so only the first eight columns are summed.
    pub fn parse_machine_time(text: &str) -> Option<u64> {
        let line = text.lines().find(|line| line.starts_with("cpu "))?;
        let columns: Option<Vec<u64>> = line
            .split_whitespace()
            .skip(1)
            .take(8)
            .map(|n| n.parse().ok())
            .collect();
        Some(columns?.iter().sum())
    }

    fn kb_field(text: &str, key: &str) -> Option<u64> {
        let line = text.lines().find(|line| line.starts_with(key))?;
        let kb: u64 = line[key.len()..].split_whitespace().next()?.parse().ok()?;
        Some(kb * 1024)
    }

    /// Bytes of `Pss:` in `/proc/<pid>/smaps_rollup`.
    pub fn parse_pss(text: &str) -> Option<u64> {
        kb_field(text, "Pss:")
    }

    /// Bytes of `MemTotal:` in `/proc/meminfo`.
    pub fn parse_mem_total(text: &str) -> Option<u64> {
        kb_field(text, "MemTotal:")
    }
}

#[cfg(target_os = "linux")]
pub fn sample(root: u32) -> Sample {
    use std::fs::read_to_string;

    let mut stats = HashMap::new();
    if let Ok(entries) = std::fs::read_dir("/proc") {
        for entry in entries.flatten() {
            let Some(pid) = entry
                .file_name()
                .to_str()
                .and_then(|n| n.parse::<u32>().ok())
            else {
                continue;
            };
            if let Some(stat) = read_to_string(format!("/proc/{pid}/stat"))
                .ok()
                .and_then(|text| linux::parse_stat(&text))
            {
                stats.insert(pid, stat);
            }
        }
    }
    let pairs: Vec<(u32, u32)> = stats.iter().map(|(&pid, s)| (pid, s.parent)).collect();
    let processes = descendants(root, &pairs)
        .into_iter()
        .filter_map(|pid| {
            let stat = stats.get(&pid)?;
            Some(ProcessSample {
                pid,
                started: stat.started,
                cpu_time: stat.cpu_time,
                memory: read_to_string(format!("/proc/{pid}/smaps_rollup"))
                    .ok()
                    .and_then(|text| linux::parse_pss(&text)),
            })
        })
        .collect();
    Sample {
        processes,
        machine_time: read_to_string("/proc/stat")
            .ok()
            .and_then(|text| linux::parse_machine_time(&text))
            .unwrap_or(0),
        machine_memory: read_to_string("/proc/meminfo")
            .ok()
            .and_then(|text| linux::parse_mem_total(&text)),
    }
}

#[cfg(any(all(target_os = "windows", target_pointer_width = "64"), test))]
pub mod windows {
    //! The `SystemProcessInformation` table from `NtQuerySystemInformation`:
    //! one call returns every process's parent, CPU times, and private working
    //! set. The record layout is the 64-bit `SYSTEM_PROCESS_INFORMATION`,
    //! unchanged since Windows Vista; `windows-sys` hides these fields in
    //! `Reserved1`, so they are read at their offsets.

    pub const NEXT_ENTRY: usize = 0;
    pub const PRIVATE_WORKING_SET: usize = 8;
    pub const CREATE_TIME: usize = 32;
    pub const USER_TIME: usize = 40;
    pub const KERNEL_TIME: usize = 48;
    pub const PROCESS_ID: usize = 80;
    pub const PARENT_ID: usize = 88;
    pub const MIN_RECORD: usize = 96;

    #[derive(Debug, PartialEq)]
    pub struct Record {
        pub pid: u32,
        pub parent: u32,
        pub started: u64,
        /// Kernel plus user time, in 100 ns units like `GetSystemTimes`.
        pub cpu_time: u64,
        pub private_working_set: u64,
    }

    fn u64_at(buffer: &[u8], at: usize) -> Option<u64> {
        Some(u64::from_le_bytes(buffer.get(at..at + 8)?.try_into().ok()?))
    }

    /// Walks the linked records; stops at a malformed one instead of reading
    /// past the buffer.
    pub fn parse(buffer: &[u8]) -> Vec<Record> {
        let mut records = Vec::new();
        let mut at = 0usize;
        while let Some(record) = buffer.get(at..).filter(|r| r.len() >= MIN_RECORD) {
            let read = |offset| u64_at(record, offset).unwrap_or(0);
            records.push(Record {
                pid: read(PROCESS_ID) as u32,
                parent: read(PARENT_ID) as u32,
                started: read(CREATE_TIME),
                cpu_time: read(USER_TIME).saturating_add(read(KERNEL_TIME)),
                private_working_set: read(PRIVATE_WORKING_SET),
            });
            let next = u32::from_le_bytes(record[NEXT_ENTRY..4].try_into().unwrap()) as usize;
            if next == 0 {
                break;
            }
            at += next;
        }
        records
    }
}

#[cfg(all(target_os = "windows", target_pointer_width = "64"))]
pub fn sample(root: u32) -> Sample {
    use windows_sys::Wdk::System::SystemInformation::{
        NtQuerySystemInformation, SystemProcessInformation,
    };
    use windows_sys::Win32::Foundation::FILETIME;
    use windows_sys::Win32::System::SystemInformation::{GlobalMemoryStatusEx, MEMORYSTATUSEX};
    use windows_sys::Win32::System::Threading::GetSystemTimes;

    const STATUS_INFO_LENGTH_MISMATCH: i32 = 0xC000_0004_u32 as i32;

    // The table grows between the size query and the read, so retry with
    // headroom; u64 storage keeps the records 8-byte aligned.
    let mut buffer: Vec<u64> = vec![0; 64 * 1024];
    let mut records = Vec::new();
    for _ in 0..4 {
        let mut needed = 0u32;
        let bytes = (buffer.len() * 8) as u32;
        let status = unsafe {
            NtQuerySystemInformation(
                SystemProcessInformation,
                buffer.as_mut_ptr().cast(),
                bytes,
                &mut needed,
            )
        };
        if status == STATUS_INFO_LENGTH_MISMATCH {
            buffer.resize((needed as usize / 8) + 16 * 1024, 0);
            continue;
        }
        if status >= 0 {
            let raw =
                unsafe { std::slice::from_raw_parts(buffer.as_ptr().cast::<u8>(), bytes as usize) };
            records = windows::parse(raw);
        }
        break;
    }

    let pairs: Vec<(u32, u32)> = records.iter().map(|r| (r.pid, r.parent)).collect();
    let by_pid: HashMap<u32, &windows::Record> = records.iter().map(|r| (r.pid, r)).collect();
    let processes = descendants(root, &pairs)
        .into_iter()
        .filter_map(|pid| {
            let record = by_pid.get(&pid)?;
            // A child whose parent exited and whose PID was reused by an
            // unrelated process still names the old parent; a real child
            // never starts before its parent.
            let parent_started = by_pid.get(&record.parent).map(|p| p.started);
            if pid != root && parent_started.is_some_and(|started| record.started < started) {
                return None;
            }
            Some(ProcessSample {
                pid,
                started: record.started,
                cpu_time: record.cpu_time,
                memory: Some(record.private_working_set),
            })
        })
        .collect();

    let to_u64 = |t: FILETIME| (u64::from(t.dwHighDateTime) << 32) | u64::from(t.dwLowDateTime);
    let zero = FILETIME {
        dwLowDateTime: 0,
        dwHighDateTime: 0,
    };
    let (mut idle, mut kernel, mut user) = (zero, zero, zero);
    // Kernel time already includes idle time.
    let machine_time = if unsafe { GetSystemTimes(&mut idle, &mut kernel, &mut user) } != 0 {
        to_u64(kernel) + to_u64(user)
    } else {
        0
    };
    let mut status: MEMORYSTATUSEX = unsafe { std::mem::zeroed() };
    status.dwLength = std::mem::size_of::<MEMORYSTATUSEX>() as u32;
    let machine_memory =
        (unsafe { GlobalMemoryStatusEx(&mut status) } != 0).then_some(status.ullTotalPhys);

    Sample {
        processes,
        machine_time,
        machine_memory,
    }
}

#[cfg(not(any(
    target_os = "linux",
    all(target_os = "windows", target_pointer_width = "64")
)))]
pub fn sample(_root: u32) -> Sample {
    Sample::default()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn process(pid: u32, cpu_time: u64, memory: Option<u64>) -> ProcessSample {
        ProcessSample {
            pid,
            started: 1,
            cpu_time,
            memory,
        }
    }

    #[test]
    fn the_tree_is_the_root_and_every_descendant_by_parent_pid() {
        // 100 is Maibuk; 101 the WebKit web process, 102 its network process,
        // 103 a grandchild; 200 and 201 are another app's processes.
        let pairs = [
            (1, 0),
            (100, 1),
            (101, 100),
            (102, 100),
            (103, 101),
            (200, 1),
            (201, 200),
        ];
        assert_eq!(descendants(100, &pairs), [100, 101, 102, 103]);
    }

    #[test]
    fn the_tree_survives_cycles_and_self_parents_in_corrupt_input() {
        let pairs = [(100, 100), (101, 100), (100, 101), (102, 102)];
        assert_eq!(descendants(100, &pairs), [100, 101]);
    }

    #[test]
    fn a_root_with_no_children_is_alone() {
        assert_eq!(descendants(7, &[]), [7]);
    }

    #[test]
    fn cpu_share_is_tree_time_over_machine_time_between_samples() {
        let mut meter = CpuMeter::default();
        let first = Sample {
            processes: vec![process(100, 50, None), process(101, 20, None)],
            machine_time: 10_000,
            machine_memory: None,
        };
        assert_eq!(meter.share(&first), None, "one sample has no interval");
        let second = Sample {
            processes: vec![process(100, 80, None), process(101, 30, None)],
            machine_time: 11_000,
            machine_memory: None,
        };
        assert_eq!(meter.share(&second), Some(0.04));
    }

    #[test]
    fn cpu_counts_a_new_process_whole_and_never_goes_negative_when_one_exits() {
        let mut meter = CpuMeter::default();
        meter.share(&Sample {
            processes: vec![process(100, 50, None), process(101, 500, None)],
            machine_time: 1_000,
            machine_memory: None,
        });
        // 101 exited; 102 started inside the interval.
        let share = meter.share(&Sample {
            processes: vec![process(100, 60, None), process(102, 30, None)],
            machine_time: 2_000,
            machine_memory: None,
        });
        assert_eq!(share, Some(0.04));
    }

    #[test]
    fn a_reused_pid_is_a_new_process() {
        let mut meter = CpuMeter::default();
        let old = ProcessSample {
            started: 1,
            ..process(101, 900, None)
        };
        meter.share(&Sample {
            processes: vec![old],
            machine_time: 1_000,
            machine_memory: None,
        });
        let reused = ProcessSample {
            started: 2,
            ..process(101, 10, None)
        };
        let share = meter.share(&Sample {
            processes: vec![reused],
            machine_time: 2_000,
            machine_memory: None,
        });
        assert_eq!(share, Some(0.01));
    }

    #[test]
    fn memory_sums_readable_processes_and_skips_the_rest() {
        let sample = Sample {
            processes: vec![
                process(100, 0, Some(300)),
                process(101, 0, None),
                process(102, 0, Some(100)),
            ],
            machine_time: 0,
            machine_memory: Some(1_000),
        };
        assert_eq!(sample.memory(), Some((400, 0.4)));
        let unreadable = Sample {
            processes: vec![process(100, 0, None)],
            machine_memory: Some(1_000),
            ..Sample::default()
        };
        assert_eq!(unreadable.memory(), None);
    }

    #[test]
    fn proc_stat_fields_are_counted_after_the_last_parenthesis() {
        let text = "4242 (Web Content) (x)) S 4200 4242 4200 0 -1 4194304 99 0 0 0 \
                    1500 250 0 0 20 0 1 0 6177470 11235328 499";
        let stat = linux::parse_stat(text).unwrap();
        assert_eq!(stat.parent, 4200);
        assert_eq!(stat.cpu_time, 1750);
        assert_eq!(stat.started, 6177470);
        assert!(linux::parse_stat("garbage").is_none());
    }

    #[test]
    fn machine_time_sums_the_first_eight_cpu_columns() {
        let text = "cpu  3692446 1100 1026750 93574019 131631 0 44051 0 777 777\n\
                    cpu0 1 2 3 4 5 6 7 8 9 10\n";
        assert_eq!(
            linux::parse_machine_time(text),
            Some(3692446 + 1100 + 1026750 + 93574019 + 131631 + 44051)
        );
    }

    #[test]
    fn smaps_rollup_reads_pss_not_rss() {
        let text =
            "5d0d187ff000-7ffd12540000 ---p 00000000 00:00 0                          [rollup]\n\
                    Rss:                2176 kB\n\
                    Pss:                 137 kB\n\
                    Pss_Dirty:           116 kB\n\
                    Pss_Anon:            116 kB\n\
                    Shared_Clean:       2060 kB\n";
        assert_eq!(linux::parse_pss(text), Some(137 * 1024));
        assert_eq!(linux::parse_pss("Rss: 10 kB\n"), None);
        assert_eq!(
            linux::parse_mem_total("MemTotal:       31977284 kB\nMemFree: 1 kB\n"),
            Some(31977284 * 1024)
        );
    }

    fn windows_record(
        next: u32,
        pid: u64,
        parent: u64,
        user: u64,
        kernel: u64,
        ws: u64,
    ) -> Vec<u8> {
        use windows::*;
        let mut record = vec![0u8; MIN_RECORD + 16];
        let mut put =
            |at: usize, value: u64| record[at..at + 8].copy_from_slice(&value.to_le_bytes());
        put(PRIVATE_WORKING_SET, ws);
        put(CREATE_TIME, 5);
        put(USER_TIME, user);
        put(KERNEL_TIME, kernel);
        put(PROCESS_ID, pid);
        put(PARENT_ID, parent);
        record[NEXT_ENTRY..4].copy_from_slice(&next.to_le_bytes());
        record
    }

    #[test]
    fn windows_records_follow_next_entry_offsets() {
        let first = windows_record((windows::MIN_RECORD + 16) as u32, 100, 4, 30, 70, 4096);
        let mut buffer = first;
        buffer.extend(windows_record(0, 101, 100, 1, 2, 8192));
        let records = windows::parse(&buffer);
        assert_eq!(
            records,
            [
                windows::Record {
                    pid: 100,
                    parent: 4,
                    started: 5,
                    cpu_time: 100,
                    private_working_set: 4096
                },
                windows::Record {
                    pid: 101,
                    parent: 100,
                    started: 5,
                    cpu_time: 3,
                    private_working_set: 8192
                },
            ]
        );
    }

    #[test]
    fn windows_parsing_stops_at_a_truncated_record() {
        let mut buffer = windows_record(500, 100, 4, 0, 0, 0);
        buffer.extend([0u8; 10]);
        assert_eq!(windows::parse(&buffer).len(), 1);
        assert!(windows::parse(&[0u8; 20]).is_empty());
    }
}
