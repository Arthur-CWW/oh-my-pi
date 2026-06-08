use std::cmp::Ordering;
use std::collections::{BTreeSet, BinaryHeap};
use std::env;
use std::time::Instant;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Mode {
    Buggy,
    Fixed,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
enum Node {
    N0 = 0,
    N1 = 1,
    N2 = 2,
}

impl Node {
    const ALL: [Node; 3] = [Node::N0, Node::N1, Node::N2];

    fn idx(self) -> usize {
        self as usize
    }

    fn name(self) -> &'static str {
        match self {
            Node::N0 => "n0",
            Node::N1 => "n1",
            Node::N2 => "n2",
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Message {
    Append { write_id: u32 },
    AppendAck { write_id: u32, from: Node },
}

impl Message {
    fn write_id(self) -> u32 {
        match self {
            Message::Append { write_id } | Message::AppendAck { write_id, .. } => write_id,
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum PersistPurpose {
    Primary,
    ReplicaAck { from: Node },
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Action {
    WorkloadStep,
    Deliver { to: Node, payload: Message },
    Persist {
        node: Node,
        write_id: u32,
        purpose: PersistPurpose,
    },
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct Event {
    at: u64,
    order: u64,
    action: Action,
}

impl Ord for Event {
    fn cmp(&self, other: &Self) -> Ordering {
        other
            .at
            .cmp(&self.at)
            .then_with(|| other.order.cmp(&self.order))
    }
}

impl PartialOrd for Event {
    fn partial_cmp(&self, other: &Self) -> Option<Ordering> {
        Some(self.cmp(other))
    }
}

#[derive(Clone, Debug)]
struct XorShift32 {
    state: u32,
}

impl XorShift32 {
    fn new(seed: u32) -> Self {
        Self {
            state: if seed == 0 { 0x9e37_79b9 } else { seed },
        }
    }

    fn next_u32(&mut self) -> u32 {
        let mut x = self.state;
        x ^= x << 13;
        x ^= x >> 17;
        x ^= x << 5;
        self.state = x;
        x
    }

    fn float(&mut self) -> f64 {
        self.next_u32() as f64 / 4_294_967_296.0
    }

    fn int(&mut self, max_exclusive: u32) -> u32 {
        assert!(max_exclusive > 0);
        (self.float() * max_exclusive as f64).floor() as u32
    }

    fn chance(&mut self, probability: f64) -> bool {
        self.float() < probability
    }

    fn node(&mut self) -> Node {
        Node::ALL[self.int(3) as usize]
    }

    fn other_node(&mut self, node: Node) -> Node {
        loop {
            let other = self.node();
            if other != node {
                return other;
            }
        }
    }
}

#[derive(Clone, Debug)]
struct NodeState {
    up: bool,
    persisted: BTreeSet<u32>,
}

#[derive(Clone, Debug)]
struct PendingWrite {
    acks: [bool; 3],
    acked: bool,
}

impl PendingWrite {
    fn new() -> Self {
        Self {
            acks: [false; 3],
            acked: false,
        }
    }

    fn ack_count(&self) -> usize {
        self.acks.iter().filter(|ack| **ack).count()
    }
}

#[derive(Clone, Debug)]
struct RunResult {
    ok: bool,
    seed: u32,
    failures: usize,
    acked_writes: usize,
    trace: Vec<String>,
}

struct Simulation {
    mode: Mode,
    rng: XorShift32,
    now: u64,
    events: BinaryHeap<Event>,
    next_order: u64,
    verbose: bool,
    trace: Vec<String>,
    drop_rate: f64,
    nodes: [NodeState; 3],
    blocked: [[bool; 3]; 3],
    pending: Vec<PendingWrite>,
    next_write_id: u32,
    acked_writes: Vec<u32>,
    primary: Node,
}

impl Simulation {
    fn new(seed: u32, mode: Mode, verbose: bool) -> Self {
        Self {
            mode,
            rng: XorShift32::new(seed),
            now: 0,
            events: BinaryHeap::new(),
            next_order: 0,
            verbose,
            trace: Vec::new(),
            drop_rate: 0.03,
            nodes: [
                NodeState {
                    up: true,
                    persisted: BTreeSet::new(),
                },
                NodeState {
                    up: true,
                    persisted: BTreeSet::new(),
                },
                NodeState {
                    up: true,
                    persisted: BTreeSet::new(),
                },
            ],
            blocked: [[false; 3]; 3],
            pending: Vec::new(),
            next_write_id: 0,
            acked_writes: Vec::new(),
            primary: Node::N0,
        }
    }

    fn schedule(&mut self, delay: u64, action: Action) {
        self.events.push(Event {
            at: self.now + delay,
            order: self.next_order,
            action,
        });
        self.next_order += 1;
    }

    fn run_next(&mut self) -> bool {
        let Some(event) = self.events.pop() else {
            return false;
        };
        self.now = event.at;
        self.log(format!("@{} {:?}", self.now, event.action));
        self.process(event.action);
        true
    }

    fn run_until_idle(&mut self) {
        let mut processed = 0usize;
        while self.run_next() {
            processed += 1;
            assert!(processed < 100_000, "simulation exceeded event limit");
        }
    }

    fn process(&mut self, action: Action) {
        match action {
            Action::WorkloadStep => self.workload_step(),
            Action::Deliver { to, payload } => self.receive(to, payload),
            Action::Persist {
                node,
                write_id,
                purpose,
            } => self.finish_persist(node, write_id, purpose),
        }
    }

    fn workload_step(&mut self) {
        let choice = self.rng.int(100);
        if choice < 45 {
            self.append();
        } else if choice < 62 {
            let node = self.rng.node();
            self.crash(node);
        } else if choice < 79 {
            let node = self.rng.node();
            self.recover(node);
        } else if choice < 91 {
            let a = self.rng.node();
            let b = self.rng.other_node(a);
            self.partition(a, b);
        } else {
            self.heal();
        }
    }

    fn append(&mut self) {
        if !self.nodes[self.primary.idx()].up {
            self.log("client write failed: primary down".to_string());
            return;
        }

        self.next_write_id += 1;
        let write_id = self.next_write_id;
        self.pending.push(PendingWrite::new());

        if self.mode == Mode::Buggy {
            self.ack_client(write_id, "buggy-pre-durable-ack");
        }

        self.persist_later(self.primary, write_id, PersistPurpose::Primary);
        for replica in Node::ALL {
            if replica != self.primary {
                self.send(
                    self.primary,
                    replica,
                    Message::Append { write_id },
                );
            }
        }
    }

    fn crash(&mut self, node: Node) {
        self.nodes[node.idx()].up = false;
        self.log(format!("crash {}", node.name()));
    }

    fn recover(&mut self, node: Node) {
        self.nodes[node.idx()].up = true;
        self.log(format!("recover {}", node.name()));
    }

    fn partition(&mut self, a: Node, b: Node) {
        self.blocked[a.idx()][b.idx()] = true;
        self.blocked[b.idx()][a.idx()] = true;
        self.log(format!("partition {}<->{}", a.name(), b.name()));
    }

    fn heal(&mut self) {
        self.blocked = [[false; 3]; 3];
        self.log("network healed".to_string());
    }

    fn send(&mut self, from: Node, to: Node, payload: Message) {
        if self.blocked[from.idx()][to.idx()] {
            self.log(format!(
                "net block {}->{} {:?}:{}",
                from.name(),
                to.name(),
                payload,
                payload.write_id()
            ));
            return;
        }
        if self.rng.chance(self.drop_rate) {
            self.log(format!(
                "net drop {}->{} {:?}:{}",
                from.name(),
                to.name(),
                payload,
                payload.write_id()
            ));
            return;
        }

        let delay = 1 + self.rng.int(7) as u64;
        self.schedule(delay, Action::Deliver { to, payload });
        if self.rng.chance(0.05) {
            let duplicate_delay = delay + 1 + self.rng.int(5) as u64;
            self.schedule(duplicate_delay, Action::Deliver { to, payload });
        }
    }

    fn receive(&mut self, to: Node, payload: Message) {
        if !self.nodes[to.idx()].up {
            self.log(format!(
                "message lost at down node {}: {:?}:{}",
                to.name(),
                payload,
                payload.write_id()
            ));
            return;
        }

        match payload {
            Message::Append { write_id } => {
                self.persist_later(to, write_id, PersistPurpose::ReplicaAck { from: to });
            }
            Message::AppendAck { write_id, from } => {
                let Some(pending) = self.pending.get_mut((write_id - 1) as usize) else {
                    return;
                };
                pending.acks[from.idx()] = true;
                self.maybe_ack_fixed(write_id);
            }
        }
    }

    fn persist_later(&mut self, node: Node, write_id: u32, purpose: PersistPurpose) {
        let delay = 1 + self.rng.int(5) as u64;
        self.schedule(
            delay,
            Action::Persist {
                node,
                write_id,
                purpose,
            },
        );
    }

    fn finish_persist(&mut self, node: Node, write_id: u32, purpose: PersistPurpose) {
        if !self.nodes[node.idx()].up {
            self.log(format!("persist lost: {} down for write {}", node.name(), write_id));
            return;
        }
        self.nodes[node.idx()].persisted.insert(write_id);
        self.log(format!("persisted {} on {}", write_id, node.name()));

        match purpose {
            PersistPurpose::Primary => {
                let Some(pending) = self.pending.get_mut((write_id - 1) as usize) else {
                    return;
                };
                pending.acks[self.primary.idx()] = true;
                self.maybe_ack_fixed(write_id);
            }
            PersistPurpose::ReplicaAck { from } => {
                self.send(
                    from,
                    self.primary,
                    Message::AppendAck { write_id, from },
                );
            }
        }
    }

    fn maybe_ack_fixed(&mut self, write_id: u32) {
        if self.mode != Mode::Fixed || !self.nodes[self.primary.idx()].up {
            return;
        }
        let Some(pending) = self.pending.get((write_id - 1) as usize) else {
            return;
        };
        if !pending.acked && pending.ack_count() >= 2 {
            self.ack_client(write_id, "fixed-quorum-ack");
        }
    }

    fn ack_client(&mut self, write_id: u32, reason: &str) {
        if let Some(pending) = self.pending.get_mut((write_id - 1) as usize) {
            pending.acked = true;
        }
        if !self.acked_writes.contains(&write_id) {
            self.acked_writes.push(write_id);
        }
        self.log(format!("ack {} {}", write_id, reason));
    }

    fn heal_and_recover_all(&mut self) {
        self.heal();
        for node in Node::ALL {
            self.recover(node);
        }
    }

    fn count_failures(&self) -> usize {
        self.acked_writes
            .iter()
            .filter(|write_id| {
                Node::ALL
                    .iter()
                    .filter(|node| self.nodes[node.idx()].persisted.contains(write_id))
                    .count()
                    < 2
            })
            .count()
    }

    fn log(&mut self, line: String) {
        if self.verbose {
            self.trace.push(line);
        }
    }
}

fn run(seed: u32, mode: Mode, steps: u32, verbose: bool) -> RunResult {
    let mut sim = Simulation::new(seed, mode, verbose);
    for _ in 0..steps {
        let delay = 1 + sim.rng.int(4) as u64;
        sim.schedule(delay, Action::WorkloadStep);
        sim.run_next();
    }
    sim.run_until_idle();
    sim.heal_and_recover_all();
    sim.run_until_idle();

    let failures = sim.count_failures();
    RunResult {
        ok: failures == 0,
        seed,
        failures,
        acked_writes: sim.acked_writes.len(),
        trace: sim.trace,
    }
}

#[derive(Debug)]
struct Cli {
    mode: Mode,
    seed: Option<u32>,
    seeds: u32,
    steps: u32,
    verbose: bool,
    bench: bool,
    json: bool,
}

fn parse_args() -> Cli {
    let mut cli = Cli {
        mode: Mode::Buggy,
        seed: None,
        seeds: 100,
        steps: 80,
        verbose: false,
        bench: false,
        json: false,
    };
    let args: Vec<String> = env::args().skip(1).collect();
    let mut i = 0;
    while i < args.len() {
        match args[i].as_str() {
            "--buggy" => cli.mode = Mode::Buggy,
            "--fixed" => cli.mode = Mode::Fixed,
            "--verbose" => cli.verbose = true,
            "--bench" => cli.bench = true,
            "--json" => cli.json = true,
            "--seed" => {
                i += 1;
                cli.seed = Some(args[i].parse().expect("--seed must be an integer"));
            }
            "--seeds" => {
                i += 1;
                cli.seeds = args[i].parse().expect("--seeds must be an integer");
            }
            "--steps" => {
                i += 1;
                cli.steps = args[i].parse().expect("--steps must be an integer");
            }
            "--help" | "-h" => {
                print_help();
                std::process::exit(0);
            }
            other => panic!("unknown argument: {other}"),
        }
        i += 1;
    }
    cli
}

fn print_help() {
    println!(
        "dst-mini-rs\n\nUsage:\n  cargo run --release -- --fixed --bench --seeds 10000\n  cargo run --release -- --buggy --seed 1 --verbose\n\nOptions:\n  --buggy | --fixed\n  --seed N\n  --seeds N\n  --steps N\n  --bench      run all seeds and report throughput\n  --verbose\n  --json"
    );
}

fn main() {
    let cli = parse_args();
    if let Some(seed) = cli.seed {
        let result = run(seed, cli.mode, cli.steps, cli.verbose);
        if cli.json {
            println!(
                "{{\"ok\":{},\"seed\":{},\"failures\":{},\"ackedWrites\":{},\"traceEvents\":{}}}",
                result.ok,
                result.seed,
                result.failures,
                result.acked_writes,
                result.trace.len()
            );
        } else {
            println!(
                "{}: seed={} failures={} ackedWrites={}",
                if result.ok { "ok" } else { "failed" },
                result.seed,
                result.failures,
                result.acked_writes
            );
            println!(
                "replay: cargo run --release --manifest-path packages/dst-mini-rs/Cargo.toml -- --{} --seed {} --steps {} --verbose",
                match cli.mode {
                    Mode::Buggy => "buggy",
                    Mode::Fixed => "fixed",
                },
                result.seed,
                cli.steps
            );
            for line in result.trace.iter().take(300) {
                println!("  {line}");
            }
            if result.trace.len() > 300 {
                println!("  ... {} more trace lines", result.trace.len() - 300);
            }
        }
        std::process::exit(if result.ok { 0 } else { 1 });
    }

    let start = Instant::now();
    let mut failures = 0usize;
    let mut checked = 0u32;
    let mut first_failure: Option<RunResult> = None;
    for seed in 1..=cli.seeds {
        let result = run(seed, cli.mode, cli.steps, false);
        checked += 1;
        if !result.ok {
            failures += 1;
            if first_failure.is_none() {
                first_failure = Some(result.clone());
            }
            if !cli.bench {
                break;
            }
        }
    }
    let elapsed = start.elapsed().as_secs_f64();
    let seeds_per_second = checked as f64 / elapsed;

    if cli.json || cli.bench {
        println!(
            "{{\"mode\":\"{}\",\"checked\":{},\"failures\":{},\"seconds\":{:.6},\"seedsPerSecond\":{:.2}}}",
            match cli.mode {
                Mode::Buggy => "buggy",
                Mode::Fixed => "fixed",
            },
            checked,
            failures,
            elapsed,
            seeds_per_second
        );
    } else if let Some(failure) = first_failure {
        println!("failed: found invariant failure after {checked} seed(s)");
        println!(
            "replay: cargo run --release --manifest-path packages/dst-mini-rs/Cargo.toml -- --{} --seed {} --steps {} --verbose",
            match cli.mode {
                Mode::Buggy => "buggy",
                Mode::Fixed => "fixed",
            },
            failure.seed,
            cli.steps
        );
    } else {
        println!("ok: checked {checked} seeds without invariant failures");
    }
}
