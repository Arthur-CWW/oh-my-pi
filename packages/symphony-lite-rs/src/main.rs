use anyhow::{anyhow, bail, Context, Result};
use clap::{Args, Parser, Subcommand};
use crossterm::{
    event::{self, Event as CrosstermEvent, KeyCode, KeyEvent, KeyModifiers},
    execute,
    terminal::{disable_raw_mode, enable_raw_mode, EnterAlternateScreen, LeaveAlternateScreen},
};
use ratatui::{
    backend::CrosstermBackend,
    layout::{Constraint, Direction, Layout},
    style::{Color, Modifier, Style},
    text::{Line, Span},
    widgets::{Block, Borders, List, ListItem, ListState, Paragraph, Wrap},
    Frame, Terminal,
};
use rusqlite::{params, Connection, OptionalExtension};
use serde::Serialize;
use serde_json::{json, Value};
use std::fs::{self, File, OpenOptions};
use std::io::{self, BufRead, BufReader, IsTerminal, Write};
#[cfg(unix)]
use std::os::unix::process::CommandExt;
use std::path::{Path, PathBuf};
use std::process::{Child, ChildStderr, ChildStdin, ChildStdout, Command, Stdio};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::mpsc::{self, Receiver};
use std::thread;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

const SCHEMA_VERSION: i64 = 1;
static ID_COUNTER: AtomicU64 = AtomicU64::new(0);

#[derive(Parser, Debug)]
#[command(name = "symphonyx")]
#[command(about = "Local-first AI agent orchestration runner")]
struct Cli {
    #[arg(
        long,
        global = true,
        env = "SYMPHONYX_ROOT",
        default_value = "data/symphonyx"
    )]
    root: PathBuf,

    #[arg(long, global = true, env = "SYMPHONYX_DB")]
    db: Option<PathBuf>,

    #[command(subcommand)]
    command: Commands,
}

#[derive(Subcommand, Debug)]
enum Commands {
    Init(JsonFlag),
    Status(JsonFlag),
    Up(UpArgs),
    Down(JsonFlag),
    Run(RunArgs),
    Spike(SpikeArgs),
    Sync(JsonFlag),
    Watch(WatchArgs),
    Tui(WatchArgs),
    Events(EventsCommand),
    Search(SearchArgs),
    Ask(AskCommand),
    Open(OpenArgs),
    Restart(RestartArgs),
}

#[derive(Args, Debug)]
struct SpikeArgs {
    #[arg(long)]
    task_list: PathBuf,
    #[arg(long)]
    json: bool,
}

#[derive(Args, Debug, Clone, Copy)]
struct JsonFlag {
    #[arg(long)]
    json: bool,
}

#[derive(Args, Debug)]
struct UpArgs {
    #[arg(long)]
    foreground: bool,
    #[arg(long)]
    json: bool,
}

#[derive(Args, Debug)]
struct RunArgs {
    #[arg(long)]
    title: Option<String>,
    #[arg(long)]
    objective: Option<String>,
    #[arg(long)]
    prompt: PathBuf,
    #[arg(
        long,
        default_value = "reviewer-readonly",
        value_parser = ["reviewer-readonly", "implementer-ts"]
    )]
    tool_profile: String,
    #[arg(
        long,
        default_value = "pi-rpc",
        value_parser = ["pi-rpc", "codex-app-server"]
    )]
    runner: String,
    #[arg(long)]
    persona: Option<String>,
    #[arg(long)]
    role: Option<String>,
    #[arg(long)]
    model: Option<String>,
    #[arg(long, default_value = "prompt-only")]
    context_mode: String,
    #[arg(long)]
    json: bool,
    #[arg(long)]
    dry_run: bool,
    #[arg(long)]
    file_logs: bool,
    #[arg(long, default_value_t = 900)]
    timeout_seconds: u64,
}

#[derive(Args, Debug)]
struct WatchArgs {
    workflow_id: Option<String>,
    #[arg(long, default_value_t = 2)]
    interval: u64,
    #[arg(long, default_value_t = 20)]
    limit: i64,
}

#[derive(Subcommand, Debug)]
enum EventsSubcommand {
    Tail(EventsTailArgs),
}

#[derive(Args, Debug)]
struct EventsCommand {
    #[command(subcommand)]
    command: EventsSubcommand,
}

#[derive(Args, Debug)]
struct EventsTailArgs {
    workflow_id: Option<String>,
    #[arg(long, default_value_t = 0)]
    since: i64,
    #[arg(long, default_value_t = 100)]
    limit: i64,
    #[arg(long)]
    json: bool,
}

#[derive(Args, Debug)]
struct SearchArgs {
    query: String,
    #[arg(long)]
    workflow: Option<String>,
    #[arg(long)]
    agent: Option<String>,
    #[arg(long, default_value_t = 50)]
    limit: usize,
    #[arg(long)]
    json: bool,
}

#[derive(Subcommand, Debug)]
enum AskSubcommand {
    List(JsonFlag),
    Answer(AskAnswerArgs),
}

#[derive(Args, Debug)]
struct AskCommand {
    #[command(subcommand)]
    command: AskSubcommand,
}

#[derive(Args, Debug)]
struct AskAnswerArgs {
    question_id: String,
    answer: String,
    #[arg(long)]
    json: bool,
}

#[derive(Subcommand, Debug)]
enum OpenTarget {
    Agent {
        id: String,
        #[arg(long)]
        json: bool,
    },
    Session {
        provider: String,
        id: String,
        #[arg(long)]
        json: bool,
    },
}

#[derive(Args, Debug)]
struct OpenArgs {
    #[command(subcommand)]
    target: OpenTarget,
}

#[derive(Args, Debug)]
struct RestartArgs {
    #[arg(long)]
    agent: String,
    #[arg(long)]
    json: bool,
}

#[derive(Serialize)]
struct OpenOutput {
    kind: String,
    id: String,
    target: String,
    opened: bool,
}

#[derive(Debug, Serialize)]
struct RestartOutput {
    #[serde(flatten)]
    run: RunOutput,
    source_agent_id: String,
}

#[derive(Clone, Debug)]
struct Paths {
    root: PathBuf,
    db: PathBuf,
    run_dir: PathBuf,
    pid_file: PathBuf,
    stop_file: PathBuf,
    daemon_log: PathBuf,
    runs_dir: PathBuf,
}

#[derive(Serialize)]
struct Envelope<T: Serialize> {
    ok: bool,
    data: Option<T>,
    error: Option<ApiError>,
}

#[derive(Serialize)]
struct ApiError {
    code: String,
    message: String,
    retryable: bool,
    details: Value,
}

#[derive(Debug, Serialize)]
struct StatusOutput {
    daemon: DaemonStatus,
    counts: Counts,
    workflows: Vec<WorkflowSummary>,
    agents: Vec<AgentSummary>,
    sessions: Vec<ExternalSessionSummary>,
    questions: Vec<QuestionSummary>,
    events: Vec<EventRecord>,
    recommended_actions: Vec<String>,
    refreshed: String,
}

#[derive(Debug, Serialize)]
struct AgentSummary {
    id: String,
    workflow_id: String,
    status: String,
    role: String,
    persona: Option<String>,
    tool_profile: String,
    session_id: Option<String>,
    session_file: Option<String>,
    artifact_dir: String,
    summary: Option<String>,
    last_event_at: Option<String>,
    dry_run: bool,
}

#[derive(Debug, Serialize)]
struct WorkflowSummary {
    id: String,
    status: String,
    title: Option<String>,
    objective: Option<String>,
    updated_at: String,
}

#[derive(Debug, Serialize)]
struct DaemonStatus {
    running: bool,
    pid: Option<u32>,
    pid_file: PathBuf,
}

#[derive(Debug, Serialize, Default)]
struct Counts {
    workflows: i64,
    agents_planned: i64,
    agents_running: i64,
    agents_blocked: i64,
    agents_done: i64,
    agents_failed: i64,
    questions_open: i64,
    external_sessions: i64,
}

#[derive(Debug, Serialize)]
struct QuestionSummary {
    id: String,
    workflow_id: String,
    subagent_id: Option<String>,
    severity: String,
    status: String,
    question: String,
    recommended_option: Option<String>,
    updated_at: String,
}

#[derive(Debug, Serialize)]
struct ExternalSessionSummary {
    id: String,
    provider: String,
    status: String,
    title: Option<String>,
    cwd: Option<String>,
    session_file: Option<String>,
    updated_at: String,
}

#[derive(Serialize)]
struct SyncOutput {
    codex_sessions_indexed: usize,
}
#[derive(Debug, Serialize)]
struct RunOutput {
    workflow_id: String,
    subagent_id: String,
    status: String,
    artifact_dir: String,
    events_path: Option<String>,
    transcript_path: Option<String>,
    session_id: Option<String>,
    session_file: Option<String>,
    final_message_preview: Option<String>,
    file_logs: bool,
    dry_run: bool,
}

#[derive(Debug, Serialize)]
struct SpikeAgentInfo {
    agent_id: String,
    role: String,
    status: String,
}

#[derive(Debug, Serialize)]
struct SpikeOutput {
    workflow_id: String,
    done_agent_id: String,
    blocked_agent_id: String,
    failed_agent_id: String,
    status: StatusOutput,
    acceptance: Vec<String>,
    agents: Vec<SpikeAgentInfo>,
}

#[derive(Debug, Serialize)]
struct EventRecord {
    id: i64,
    workflow_id: String,
    subagent_id: Option<String>,
    ts: String,
    event_type: String,
    payload: Value,
}

#[derive(Debug, Serialize)]
struct SearchHit {
    source: String,
    path: Option<String>,
    event_id: Option<i64>,
    line: Option<usize>,
    preview: String,
}

fn main() {
    if let Err(error) = run_main() {
        let response: Envelope<Value> = Envelope {
            ok: false,
            data: None,
            error: Some(ApiError {
                code: "symphonyx_error".to_string(),
                message: error.to_string(),
                retryable: false,
                details: json!({}),
            }),
        };
        eprintln!(
            "{}",
            serde_json::to_string_pretty(&response).unwrap_or_else(|_| error.to_string())
        );
        std::process::exit(1);
    }
}

fn run_main() -> Result<()> {
    let cli = Cli::parse();
    let paths = Paths::new(cli.root, cli.db)?;

    match cli.command {
        Commands::Init(args) => {
            ensure_dirs(&paths)?;
            let conn = open_db(&paths)?;
            init_schema(&conn)?;
            print_output(
                args.json,
                json!({ "db": paths.db, "root": paths.root }),
                "initialized",
            )?;
        }
        Commands::Status(args) => {
            ensure_dirs(&paths)?;
            let conn = open_db(&paths)?;
            init_schema(&conn)?;
            let status = status_output(&paths, &conn)?;
            if args.json {
                print_json(&status)?;
            } else {
                print_status(&status);
            }
        }
        Commands::Up(args) => {
            ensure_dirs(&paths)?;
            let conn = open_db(&paths)?;
            init_schema(&conn)?;
            if args.foreground {
                run_daemon_foreground(&paths, args.json)?;
            } else {
                spawn_background_daemon(&paths)?;
                print_output(
                    args.json,
                    json!({ "pid_file": paths.pid_file, "log": paths.daemon_log }),
                    "daemon starting",
                )?;
            }
        }
        Commands::Down(args) => {
            ensure_dirs(&paths)?;
            fs::write(&paths.stop_file, now_iso())?;
            print_output(
                args.json,
                json!({ "stop_file": paths.stop_file }),
                "stop requested",
            )?;
        }
        Commands::Run(args) => {
            ensure_dirs(&paths)?;
            let json_mode = args.json;
            let conn = open_db(&paths)?;
            init_schema(&conn)?;
            let output = run_agent(&paths, &conn, args)?;
            if json_mode {
                print_json(&output)?;
            } else {
                println!("{} {}", output.workflow_id, output.status);
                println!("agent: {}", output.subagent_id);
                if let Some(message) = &output.final_message_preview {
                    println!("final: {message}");
                }
                if let Some(session_file) = &output.session_file {
                    println!("session: {session_file}");
                }
                println!("artifacts: {}", output.artifact_dir);
            }
        }
        Commands::Spike(args) => {
            ensure_dirs(&paths)?;
            let json_mode = args.json;
            let conn = open_db(&paths)?;
            init_schema(&conn)?;
            let output = run_spike(&paths, &conn, args)?;
            if json_mode {
                print_json(&output)?;
            } else {
                println!("spike workflow: {}", output.workflow_id);
                println!(
                    "done: {} blocked: {} failed: {}",
                    output.done_agent_id, output.blocked_agent_id, output.failed_agent_id
                );
                println!(
                    "workflows: {} agents: {}",
                    output.status.counts.workflows,
                    output.status.agents.len()
                );
            }
        }
        Commands::Sync(args) => {
            ensure_dirs(&paths)?;
            let conn = open_db(&paths)?;
            init_schema(&conn)?;
            let output = sync_external_sessions(&conn)?;
            if args.json {
                print_json(&output)?;
            } else {
                println!("indexed {} Codex sessions", output.codex_sessions_indexed);
            }
        }
        Commands::Watch(args) => {
            ensure_dirs(&paths)?;
            let conn = open_db(&paths)?;
            init_schema(&conn)?;
            let _ = sync_external_sessions(&conn);
            ensure_daemon_running(&paths)?;
            run_watch(&paths, &conn, &args)?;
        }
        Commands::Tui(args) => {
            ensure_dirs(&paths)?;
            ensure_interactive_terminal()?;
            let conn = open_db(&paths)?;
            init_schema(&conn)?;
            let _ = sync_external_sessions(&conn);
            ensure_daemon_running(&paths)?;
            run_tui(&paths, &conn, &args)?;
        }
        Commands::Events(command) => match command.command {
            EventsSubcommand::Tail(args) => {
                ensure_dirs(&paths)?;
                let conn = open_db(&paths)?;
                init_schema(&conn)?;
                let events =
                    tail_events(&conn, args.workflow_id.as_deref(), args.since, args.limit)?;
                if args.json {
                    print_json(&events)?;
                } else {
                    for event in events {
                        println!(
                            "#{:<5} {} {:<18} {}",
                            event.id,
                            event.ts,
                            event.event_type,
                            compact_json(&event.payload, 240)
                        );
                    }
                }
            }
        },
        Commands::Search(args) => {
            ensure_dirs(&paths)?;
            let conn = open_db(&paths)?;
            init_schema(&conn)?;
            let hits = search(&paths, &conn, &args)?;
            if args.json {
                print_json(&hits)?;
            } else {
                for hit in hits {
                    let loc = hit.path.unwrap_or_else(|| {
                        hit.event_id
                            .map(|id| format!("event#{id}"))
                            .unwrap_or_default()
                    });
                    println!("{} {}", hit.source, loc);
                    println!("  {}", hit.preview);
                }
            }
        }
        Commands::Ask(command) => match command.command {
            AskSubcommand::List(args) => {
                ensure_dirs(&paths)?;
                let conn = open_db(&paths)?;
                init_schema(&conn)?;
                let questions = list_questions(&conn)?;
                if args.json {
                    print_json(&questions)?;
                } else {
                    for q in questions {
                        println!("{} [{}] {}", q.id, q.severity, q.question);
                    }
                }
            }
            AskSubcommand::Answer(args) => {
                ensure_dirs(&paths)?;
                let conn = open_db(&paths)?;
                init_schema(&conn)?;
                answer_question(&conn, &args.question_id, &args.answer)?;
                print_output(
                    args.json,
                    json!({ "question_id": args.question_id }),
                    "answered",
                )?;
            }
        },
        Commands::Open(args) => {
            ensure_dirs(&paths)?;
            let conn = open_db(&paths)?;
            init_schema(&conn)?;
            let output = open_target(&paths, &conn, &args)?;
            let json_mode = open_args_json(&args);
            if json_mode {
                print_json(&output)?;
            } else if output.opened {
                println!("opened {}", output.target);
            } else {
                println!("{}", output.target);
            }
        }
        Commands::Restart(args) => {
            ensure_dirs(&paths)?;
            let json_mode = args.json;
            let conn = open_db(&paths)?;
            init_schema(&conn)?;
            let output = restart_agent(&paths, &conn, &args)?;
            if json_mode {
                print_json(&output)?;
            } else {
                println!("restarted {} -> {}", args.agent, output.run.subagent_id);
                println!(
                    "workflow: {} status: {}",
                    output.run.workflow_id, output.run.status
                );
                println!("artifacts: {}", output.run.artifact_dir);
            }
        }
    }

    Ok(())
}

impl Paths {
    fn new(root: PathBuf, db: Option<PathBuf>) -> Result<Self> {
        let db = db.unwrap_or_else(|| root.join("symphony.sqlite"));
        let run_dir = root.join("run");
        Ok(Self {
            runs_dir: root.join("runs"),
            daemon_log: root.join("logs").join("daemon.log"),
            pid_file: run_dir.join("symphonyx.pid"),
            stop_file: run_dir.join("stop"),
            run_dir,
            root,
            db,
        })
    }
}

fn ensure_dirs(paths: &Paths) -> Result<()> {
    fs::create_dir_all(&paths.root)?;
    fs::create_dir_all(paths.db.parent().unwrap_or(&paths.root))?;
    fs::create_dir_all(&paths.run_dir)?;
    fs::create_dir_all(paths.daemon_log.parent().unwrap_or(&paths.root))?;
    fs::create_dir_all(&paths.runs_dir)?;
    Ok(())
}

fn open_db(paths: &Paths) -> Result<Connection> {
    let conn = Connection::open(&paths.db)
        .with_context(|| format!("open sqlite db {}", paths.db.display()))?;
    conn.pragma_update(None, "journal_mode", "WAL")?;
    conn.pragma_update(None, "foreign_keys", "ON")?;
    Ok(conn)
}

fn init_schema(conn: &Connection) -> Result<()> {
    conn.execute_batch(
        "
        create table if not exists schema_meta (
          key text primary key,
          value text not null
        );
        ",
    )?;
    let existing_version: Option<String> = conn
        .query_row(
            "select value from schema_meta where key='schema_version'",
            [],
            |row| row.get(0),
        )
        .optional()?;
    if let Some(version) = existing_version.as_deref() {
        if version.parse::<i64>().unwrap_or_default() != SCHEMA_VERSION {
            bail!("unsupported schema version {version}");
        }
    } else {
        conn.execute(
            "insert into schema_meta(key, value) values ('schema_version', ?1)",
            [SCHEMA_VERSION.to_string()],
        )?;
    }

    conn.execute_batch(
        "
        create table if not exists workflow_runs(
          id text primary key,
          created_at text not null,
          updated_at text not null,
          status text not null,
          title text,
          objective text,
          parent_session_file text,
          parent_checkpoint text,
          workdir text not null,
          config_json text not null
        );

        create table if not exists subagents(
          id text primary key,
          workflow_id text not null,
          created_at text not null,
          updated_at text not null,
          status text not null,
          role text not null,
          persona text,
          tool_profile text not null,
          model text,
          context_mode text not null,
          runner_kind text not null,
          dry_run integer not null default 0,
          pid integer,
          session_file text,
          session_id text,
          artifact_dir text not null,
          last_event_at text,
          summary text,
          foreign key(workflow_id) references workflow_runs(id)
        );


        create table if not exists agent_events(
          id integer primary key autoincrement,
          workflow_id text not null,
          subagent_id text,
          ts text not null,
          type text not null,
          payload_json text not null
        );
        create index if not exists idx_agent_events_workflow_id on agent_events(workflow_id, id);
        create index if not exists idx_agent_events_subagent_id on agent_events(subagent_id, id);

        create table if not exists artifacts(
          id text primary key,
          workflow_id text not null,
          subagent_id text,
          kind text not null,
          role text,
          path text not null,
          sha256 text,
          mime text,
          created_at text not null,
          meta_json text not null
        );

        create table if not exists human_questions(
          id text primary key,
          workflow_id text not null,
          subagent_id text,
          created_at text not null,
          updated_at text not null,
          severity text not null,
          status text not null,
          question text not null,
          context text,
          options_json text not null,
          recommended_option text,
          default_if_no_answer text,
          answer text,
          answered_at text
        );

        create table if not exists external_sessions(
          id text not null,
          provider text not null,
          status text not null,
          title text,
          cwd text,
          session_file text,
          updated_at text not null,
          meta_json text not null,
          primary key(provider, id)
        );
        create index if not exists idx_external_sessions_updated_at on external_sessions(updated_at desc);
        create index if not exists idx_external_sessions_provider on external_sessions(provider, updated_at desc);
        ",
    )?;

    let dry_run_exists: bool = conn
        .query_row(
            "select 1 from pragma_table_info('subagents') where name='dry_run'",
            [],
            |_row| Ok(true),
        )
        .optional()?
        .unwrap_or(false);
    if !dry_run_exists {
        conn.execute(
            "alter table subagents add column dry_run integer not null default 0",
            [],
        )?;
    }

    Ok(())
}

fn status_output(paths: &Paths, conn: &Connection) -> Result<StatusOutput> {
    let daemon = daemon_status(paths);
    let counts = Counts {
        workflows: count(conn, "select count(*) from workflow_runs")?,
        agents_planned: count(conn, "select count(*) from subagents where status in ('planned','queued','starting')")?,
        agents_running: count(conn, "select count(*) from subagents where status in ('running','idle')")?,
        agents_blocked: count(conn, "select count(*) from subagents where status in ('blocked','needs_human','stale','offline')")?,
        agents_done: count(conn, "select count(*) from subagents where status='done'")?,
        agents_failed: count(conn, "select count(*) from subagents where status in ('failed','aborted')")?,
        questions_open: count(conn, "select count(*) from human_questions where status='open'")?,
        external_sessions: count(conn, "select count(*) from external_sessions")?,
    };

    let workflows = query_workflows(conn, 20)?;
    let agents = query_agents(conn, 20)?;
    let questions = list_questions(conn)?
        .into_iter()
        .take(10)
        .collect::<Vec<_>>();
    let sessions = query_external_sessions(conn, 30)?;
    let mut recommended_actions = Vec::new();
    if counts.questions_open > 0 {
        recommended_actions.push("answer pending ask_arthur questions".to_string());
    }
    if counts.agents_blocked > 0 {
        recommended_actions.push("inspect blocked/stale agents".to_string());
    }
    if !daemon.running {
        recommended_actions.push("run `symphonyx up` before mutating commands".to_string());
    }

    Ok(StatusOutput {
        daemon,
        counts,
        workflows,
        agents,
        sessions,
        questions,
        events: recent_events(conn, None, 20)?,
        recommended_actions,
        refreshed: now_iso(),
    })
}

fn count(conn: &Connection, sql: &str) -> Result<i64> {
    Ok(conn.query_row(sql, [], |row| row.get(0))?)
}

fn query_workflows(conn: &Connection, limit: i64) -> Result<Vec<WorkflowSummary>> {
    let mut stmt = conn.prepare(
        "select id, status, title, objective, updated_at from workflow_runs order by updated_at desc limit ?1",
    )?;
    let rows = stmt.query_map([limit], |row| {
        Ok(WorkflowSummary {
            id: row.get(0)?,
            status: row.get(1)?,
            title: row.get(2)?,
            objective: row.get(3)?,
            updated_at: row.get(4)?,
        })
    })?;
    rows.collect::<std::result::Result<Vec<_>, _>>()
        .map_err(Into::into)
}

fn query_agents(conn: &Connection, limit: i64) -> Result<Vec<AgentSummary>> {
    let mut stmt = conn.prepare(
        "select id, workflow_id, status, role, persona, tool_profile, session_id, session_file, artifact_dir, summary, last_event_at, dry_run from subagents order by updated_at desc limit ?1",
    )?;
    let rows = stmt.query_map([limit], |row| {
        Ok(AgentSummary {
            id: row.get(0)?,
            workflow_id: row.get(1)?,
            status: row.get(2)?,
            role: row.get(3)?,
            persona: row.get(4)?,
            tool_profile: row.get(5)?,
            session_id: row.get(6)?,
            session_file: row.get(7)?,
            artifact_dir: row.get(8)?,
            summary: row.get(9)?,
            last_event_at: row.get(10)?,
            dry_run: row.get(11)?,
        })
    })?;
    rows.collect::<std::result::Result<Vec<_>, _>>()
        .map_err(Into::into)
}

fn query_external_sessions(conn: &Connection, limit: i64) -> Result<Vec<ExternalSessionSummary>> {
    let mut stmt = conn.prepare(
        "select id, provider, status, title, cwd, session_file, updated_at from external_sessions order by updated_at desc limit ?1",
    )?;
    let rows = stmt.query_map([limit], |row| {
        Ok(ExternalSessionSummary {
            id: row.get(0)?,
            provider: row.get(1)?,
            status: row.get(2)?,
            title: row.get(3)?,
            cwd: row.get(4)?,
            session_file: row.get(5)?,
            updated_at: row.get(6)?,
        })
    })?;
    rows.collect::<std::result::Result<Vec<_>, _>>()
        .map_err(Into::into)
}

fn sync_external_sessions(conn: &Connection) -> Result<SyncOutput> {
    Ok(SyncOutput {
        codex_sessions_indexed: sync_codex_sessions(conn)?,
    })
}

fn sync_codex_sessions(conn: &Connection) -> Result<usize> {
    let home = std::env::var_os("CODEX_HOME")
        .map(PathBuf::from)
        .or_else(|| std::env::var_os("HOME").map(|home| PathBuf::from(home).join(".codex")));
    let Some(home) = home else {
        return Ok(0);
    };
    let sessions_dir = home.join("sessions");
    if !sessions_dir.exists() {
        return Ok(0);
    }
    let mut files = Vec::new();
    collect_jsonl_files(&sessions_dir, &mut files)?;
    files.sort_by(|a, b| b.cmp(a));
    let mut indexed = 0;
    for path in files.into_iter().take(500) {
        if let Some(session) = read_codex_session_summary(&path)? {
            conn.execute(
                "insert or replace into external_sessions(id, provider, status, title, cwd, session_file, updated_at, meta_json) values (?1, 'codex', ?2, ?3, ?4, ?5, ?6, ?7)",
                params![
                    session.id,
                    session.status,
                    session.title,
                    session.cwd,
                    session.session_file,
                    session.updated_at,
                    session.meta_json.to_string(),
                ],
            )?;
            indexed += 1;
        }
    }
    Ok(indexed)
}

fn collect_jsonl_files(root: &Path, out: &mut Vec<PathBuf>) -> Result<()> {
    for entry in fs::read_dir(root)? {
        let entry = entry?;
        let path = entry.path();
        if path.is_dir() {
            collect_jsonl_files(&path, out)?;
        } else if path.extension().and_then(|ext| ext.to_str()) == Some("jsonl") {
            out.push(path);
        }
    }
    Ok(())
}

struct IndexedExternalSession {
    id: String,
    status: String,
    title: Option<String>,
    cwd: Option<String>,
    session_file: Option<String>,
    updated_at: String,
    meta_json: Value,
}

fn read_codex_session_summary(path: &Path) -> Result<Option<IndexedExternalSession>> {
    let file = File::open(path)?;
    let mut id = None;
    let mut cwd = None;
    let mut title = None;
    let mut meta_json = json!({});
    for line in BufReader::new(file).lines().take(40) {
        let line = line?;
        let Ok(value) = serde_json::from_str::<Value>(&line) else {
            continue;
        };
        if value.get("type").and_then(Value::as_str) == Some("session_meta") {
            let payload = value.get("payload").cloned().unwrap_or_else(|| json!({}));
            id = payload
                .get("id")
                .and_then(Value::as_str)
                .map(str::to_string);
            cwd = payload
                .get("cwd")
                .and_then(Value::as_str)
                .map(str::to_string);
            title = cwd
                .as_deref()
                .and_then(|cwd| Path::new(cwd).file_name())
                .map(|name| name.to_string_lossy().to_string());
            meta_json = payload;
            break;
        }
    }
    let Some(id) = id.or_else(|| codex_session_id_from_path(path)) else {
        return Ok(None);
    };
    let updated_at = file_modified_iso(path).unwrap_or_else(now_iso);
    Ok(Some(IndexedExternalSession {
        id,
        status: "historical".to_string(),
        title,
        cwd,
        session_file: Some(path.display().to_string()),
        updated_at,
        meta_json,
    }))
}

fn codex_session_id_from_path(path: &Path) -> Option<String> {
    let stem = path.file_stem()?.to_string_lossy();
    if stem.len() >= 36 {
        Some(stem[stem.len() - 36..].to_string())
    } else {
        Some(stem.to_string())
    }
}

fn file_modified_iso(path: &Path) -> Option<String> {
    let modified = fs::metadata(path).ok()?.modified().ok()?;
    let duration = modified.duration_since(UNIX_EPOCH).ok()?;
    Some(format!(
        "{}.{:03}Z",
        duration.as_secs(),
        duration.subsec_millis()
    ))
}

fn run_watch(paths: &Paths, conn: &Connection, args: &WatchArgs) -> Result<()> {
    let mut since = 0_i64;
    loop {
        print!("\x1b[2J\x1b[H");
        println!(
            "SymphonyX watch | root={} | db={} | interval={}s",
            paths.root.display(),
            paths.db.display(),
            args.interval
        );
        if let Some(workflow_id) = &args.workflow_id {
            println!("workflow filter: {workflow_id}");
        }
        println!();

        let status = status_output(paths, conn)?;
        print_status(&status);
        println!();
        println!("recent events (Ctrl-C to exit):");
        let events = tail_events(conn, args.workflow_id.as_deref(), since, args.limit)?;
        if let Some(last) = events.last() {
            since = last.id;
        }
        for event in events {
            println!(
                "#{:<5} {} {:<32} {}",
                event.id,
                event.ts,
                event.event_type,
                compact_json(&event.payload, 180)
            );
        }
        std::io::stdout().flush()?;
        thread::sleep(Duration::from_secs(args.interval.max(1)));
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum TuiView {
    Workflows,
    Agents,
    Sessions,
    Events,
    Help,
}

impl TuiView {
    fn title(self) -> &'static str {
        match self {
            Self::Workflows => "Workflows",
            Self::Agents => "Agents",
            Self::Sessions => "Sessions",
            Self::Events => "Events",
            Self::Help => "Help",
        }
    }

    fn next(self) -> Self {
        match self {
            Self::Workflows => Self::Agents,
            Self::Agents => Self::Sessions,
            Self::Sessions => Self::Events,
            Self::Events => Self::Workflows,
            Self::Help => Self::Workflows,
        }
    }
}

struct TuiState {
    view: TuiView,
    workflow_filter: Option<String>,
    limit: i64,
    selected_workflow: usize,
    selected_agent: usize,
    selected_session: usize,
    selected_event: usize,
    status: Option<StatusOutput>,
    events: Vec<EventRecord>,
    last_refresh: String,
    status_message: String,
}

impl TuiState {
    fn new(args: &WatchArgs) -> Self {
        Self {
            view: TuiView::Workflows,
            workflow_filter: args.workflow_id.clone(),
            limit: args.limit,
            selected_workflow: 0,
            selected_agent: 0,
            selected_session: 0,
            selected_event: 0,
            status: None,
            events: Vec::new(),
            last_refresh: String::new(),
            status_message: String::new(),
        }
    }

    fn refresh(&mut self, paths: &Paths, conn: &Connection) -> Result<()> {
        self.status = Some(status_output(paths, conn)?);
        self.events = recent_events(conn, self.workflow_filter.as_deref(), self.limit)?;
        self.last_refresh = now_iso();
        self.clamp_selection();
        Ok(())
    }

    fn clamp_selection(&mut self) {
        if let Some(status) = &self.status {
            clamp_index(&mut self.selected_workflow, status.workflows.len());
            clamp_index(&mut self.selected_agent, status.agents.len());
            clamp_index(&mut self.selected_session, status.sessions.len());
        }
        clamp_index(&mut self.selected_event, self.events.len());
    }

    fn current_len(&self) -> usize {
        match (self.view, &self.status) {
            (TuiView::Workflows, Some(status)) => status.workflows.len(),
            (TuiView::Agents, Some(status)) => status.agents.len(),
            (TuiView::Sessions, Some(status)) => status.sessions.len(),
            (TuiView::Events, _) => self.events.len(),
            (TuiView::Help, _) | (_, None) => 0,
        }
    }

    fn selected_index_mut(&mut self) -> Option<&mut usize> {
        match self.view {
            TuiView::Workflows => Some(&mut self.selected_workflow),
            TuiView::Agents => Some(&mut self.selected_agent),
            TuiView::Sessions => Some(&mut self.selected_session),
            TuiView::Events => Some(&mut self.selected_event),
            TuiView::Help => None,
        }
    }

    fn selected_workflow_id(&self) -> Option<&str> {
        self.status
            .as_ref()?
            .workflows
            .get(self.selected_workflow)
            .map(|workflow| workflow.id.as_str())
    }

    fn selected_agent(&self) -> Option<&AgentSummary> {
        self.status
            .as_ref()?
            .agents
            .get(self.selected_agent)
    }

    fn selected_session(&self) -> Option<&ExternalSessionSummary> {
        self.status
            .as_ref()?
            .sessions
            .get(self.selected_session)
    }

    fn move_down(&mut self) {
        let len = self.current_len();
        if len == 0 {
            return;
        }
        if let Some(index) = self.selected_index_mut() {
            *index = (*index + 1).min(len - 1);
        }
    }

    fn move_up(&mut self) {
        if let Some(index) = self.selected_index_mut() {
            *index = index.saturating_sub(1);
        }
    }

    fn move_top(&mut self) {
        if let Some(index) = self.selected_index_mut() {
            *index = 0;
        }
    }

    fn move_bottom(&mut self) {
        let len = self.current_len();
        if len == 0 {
            return;
        }
        if let Some(index) = self.selected_index_mut() {
            *index = len - 1;
        }
    }
}

fn clamp_index(index: &mut usize, len: usize) {
    if len == 0 {
        *index = 0;
    } else if *index >= len {
        *index = len - 1;
    }
}

enum TuiAction {
    Continue,
    Refresh,
    Quit,
}

fn ensure_interactive_terminal() -> Result<()> {
    if !io::stdout().is_terminal() {
        bail!("symphonyx tui requires an interactive terminal; use `symphonyx watch` for non-interactive monitoring");
    }
    Ok(())
}

fn run_tui(paths: &Paths, conn: &Connection, args: &WatchArgs) -> Result<()> {
    let mut state = TuiState::new(args);
    state.refresh(paths, conn)?;

    enable_raw_mode()?;
    let mut stdout = io::stdout();
    execute!(stdout, EnterAlternateScreen)?;
    let backend = CrosstermBackend::new(stdout);
    let mut terminal = Terminal::new(backend)?;

    let result = run_tui_loop(&mut terminal, paths, conn, args, &mut state);

    disable_raw_mode()?;
    execute!(terminal.backend_mut(), LeaveAlternateScreen)?;
    terminal.show_cursor()?;
    result
}

fn run_tui_loop(
    terminal: &mut Terminal<CrosstermBackend<io::Stdout>>,
    paths: &Paths,
    conn: &Connection,
    args: &WatchArgs,
    state: &mut TuiState,
) -> Result<()> {
    let tick_rate = Duration::from_secs(args.interval.max(1));
    let mut last_tick = Instant::now();
    loop {
        terminal.draw(|frame| render_tui(frame, state))?;
        let timeout = tick_rate
            .checked_sub(last_tick.elapsed())
            .unwrap_or(Duration::ZERO);
        if event::poll(timeout)? {
            if let CrosstermEvent::Key(key) = event::read()? {
                match handle_tui_key(state, key, paths, conn) {
                    TuiAction::Quit => return Ok(()),
                    TuiAction::Refresh => {
                        state.refresh(paths, conn)?;
                        last_tick = Instant::now();
                    }
                    TuiAction::Continue => {}
                }
            }
        }
        if last_tick.elapsed() >= tick_rate {
            state.refresh(paths, conn)?;
            last_tick = Instant::now();
        }
    }
}

fn handle_tui_key(
    state: &mut TuiState,
    key: KeyEvent,
    paths: &Paths,
    conn: &Connection,
) -> TuiAction {
    if key.modifiers.contains(KeyModifiers::CONTROL) && key.code == KeyCode::Char('c') {
        return TuiAction::Quit;
    }
    match key.code {
        KeyCode::Char('q') | KeyCode::Esc => TuiAction::Quit,
        KeyCode::Tab => {
            state.view = state.view.next();
            TuiAction::Continue
        }
        KeyCode::Char('w') => {
            state.view = TuiView::Workflows;
            TuiAction::Continue
        }
        KeyCode::Char('a') => {
            state.view = TuiView::Agents;
            TuiAction::Continue
        }
        KeyCode::Char('s') => {
            state.view = TuiView::Sessions;
            TuiAction::Continue
        }
        KeyCode::Char('e') => {
            state.view = TuiView::Events;
            TuiAction::Continue
        }
        KeyCode::Char('?') | KeyCode::Char('h') => {
            state.view = TuiView::Help;
            TuiAction::Continue
        }
        KeyCode::Char('r') => TuiAction::Refresh,
        KeyCode::Char('c') => {
            state.workflow_filter = None;
            TuiAction::Refresh
        }
        KeyCode::Enter => {
            if state.view == TuiView::Workflows {
                if let Some(workflow_id) = state.selected_workflow_id() {
                    state.workflow_filter = Some(workflow_id.to_string());
                    state.view = TuiView::Events;
                    return TuiAction::Refresh;
                }
            }
            TuiAction::Continue
        }
        KeyCode::Char('o') => {
            let result = tui_open_selected(state, paths, conn);
            state.status_message = match result {
                Ok(msg) => msg,
                Err(err) => format!("open error: {err}"),
            };
            TuiAction::Continue
        }
        KeyCode::Char('R') => {
            let result = tui_restart_selected_agent(state, paths, conn);
            state.status_message = match result {
                Ok(msg) => msg,
                Err(err) => format!("restart error: {err}"),
            };
            TuiAction::Continue
        }
        KeyCode::Char('j') | KeyCode::Down => {
            state.move_down();
            TuiAction::Continue
        }
        KeyCode::Char('k') | KeyCode::Up => {
            state.move_up();
            TuiAction::Continue
        }
        KeyCode::Char('g') | KeyCode::Home => {
            state.move_top();
            TuiAction::Continue
        }
        KeyCode::Char('G') | KeyCode::End => {
            state.move_bottom();
            TuiAction::Continue
        }
        _ => TuiAction::Continue,
    }
}

fn tui_open_selected(state: &mut TuiState, _paths: &Paths, conn: &Connection) -> Result<String> {
    match state.view {
        TuiView::Workflows => {
            let workflow_id = state
                .selected_workflow_id()
                .ok_or_else(|| anyhow!("no workflow selected"))?
                .to_string();
            let workdir: String = conn.query_row(
                "select workdir from workflow_runs where id=?1",
                [&workflow_id],
                |row| row.get(0),
            )?;
            let path = PathBuf::from(workdir);
            os_open(&path)?;
            Ok(format!("opened workflow dir: {}", path.display()))
        }
        TuiView::Agents => {
            let agent = state
                .selected_agent()
                .ok_or_else(|| anyhow!("no agent selected"))?;
            let target = agent
                .session_file
                .as_ref()
                .filter(|p| !p.is_empty() && Path::new(p).exists())
                .map(PathBuf::from)
                .unwrap_or_else(|| PathBuf::from(&agent.artifact_dir));
            os_open(&target)?;
            Ok(format!("opened agent {}: {}", agent.id, target.display()))
        }
        TuiView::Sessions => {
            let session = state
                .selected_session()
                .ok_or_else(|| anyhow!("no session selected"))?;
            let target = session
                .session_file
                .as_ref()
                .filter(|p| !p.is_empty() && Path::new(p).exists())
                .map(PathBuf::from)
                .or_else(|| {
                    session
                        .cwd
                        .as_ref()
                        .filter(|p| !p.is_empty())
                        .map(PathBuf::from)
                })
                .ok_or_else(|| anyhow!("session has no openable target"))?;
            os_open(&target)?;
            Ok(format!(
                "opened session {}: {}",
                session.id,
                target.display()
            ))
        }
        _ => Ok("open: select a workflow, agent, or session".to_string()),
    }
}

fn tui_restart_selected_agent(
    state: &mut TuiState,
    paths: &Paths,
    conn: &Connection,
) -> Result<String> {
    let agent = state
        .selected_agent()
        .ok_or_else(|| anyhow!("no agent selected"))?;
    if !agent.dry_run {
        bail!(
            "restarting live agent {} from the TUI is not supported; use `symphonyx restart --agent {}` from the CLI",
            agent.id, agent.id
        );
    }
    let args = RestartArgs {
        agent: agent.id.clone(),
        json: false,
    };
    let output = restart_agent(paths, conn, &args)?;
    Ok(format!(
        "restarted {} -> {} in workflow {}",
        output.source_agent_id, output.run.subagent_id, output.run.workflow_id
    ))
}

fn render_tui(frame: &mut Frame<'_>, state: &TuiState) {
    let area = frame.area();
    let chunks = Layout::default()
        .direction(Direction::Vertical)
        .constraints([
            Constraint::Length(3),
            Constraint::Min(10),
            Constraint::Length(7),
            Constraint::Length(2),
        ])
        .split(area);

    render_tui_header(frame, chunks[0], state);
    let main = Layout::default()
        .direction(Direction::Horizontal)
        .constraints([Constraint::Percentage(42), Constraint::Percentage(58)])
        .split(chunks[1]);
    render_tui_list(frame, main[0], state);
    render_tui_detail(frame, main[1], state);
    render_tui_event_stream(frame, chunks[2], state);
    render_tui_footer(frame, chunks[3], state);
}

fn render_tui_header(frame: &mut Frame<'_>, area: ratatui::layout::Rect, state: &TuiState) {
    let (daemon, counts) = if let Some(status) = &state.status {
        (
            if status.daemon.running {
                format!(
                    "daemon running pid={}",
                    status.daemon.pid.unwrap_or_default()
                )
            } else {
                "daemon stopped".to_string()
            },
            format!(
                "wf={} sessions={} agents done/run/block/fail={}/{}/{}/{} questions={}",
                status.counts.workflows,
                status.counts.external_sessions,
                status.counts.agents_done,
                status.counts.agents_running,
                status.counts.agents_blocked,
                status.counts.agents_failed,
                status.counts.questions_open
            ),
        )
    } else {
        ("daemon unknown".to_string(), "loading".to_string())
    };
    let filter = state
        .workflow_filter
        .as_deref()
        .map(|id| format!("filter={id}"))
        .unwrap_or_else(|| "filter=all".to_string());
    let text = vec![
        Line::from(vec![
            Span::styled(
                "SymphonyX",
                Style::default()
                    .fg(Color::Cyan)
                    .add_modifier(Modifier::BOLD),
            ),
            Span::raw("  "),
            Span::raw(daemon),
            Span::raw("  "),
            Span::styled(filter, Style::default().fg(Color::Yellow)),
        ]),
        Line::from(format!("{counts} | refreshed {}", state.last_refresh)),
    ];
    let paragraph = Paragraph::new(text).block(Block::default().borders(Borders::ALL));
    frame.render_widget(paragraph, area);
}

fn render_tui_list(frame: &mut Frame<'_>, area: ratatui::layout::Rect, state: &TuiState) {
    let items = match (state.view, &state.status) {
        (TuiView::Workflows, Some(status)) => status
            .workflows
            .iter()
            .map(|workflow| {
                ListItem::new(Line::from(format!(
                    "{:<8} {}  {}",
                    workflow.status,
                    workflow.id,
                    workflow.title.clone().unwrap_or_default()
                )))
            })
            .collect::<Vec<_>>(),
        (TuiView::Agents, Some(status)) => status
            .agents
            .iter()
            .map(|agent| {
                ListItem::new(Line::from(format!(
                    "{:<8} {:<18} {}",
                    agent.status,
                    agent.tool_profile,
                    agent.summary.clone().unwrap_or_else(|| agent.id.clone())
                )))
            })
            .collect::<Vec<_>>(),
        (TuiView::Sessions, Some(status)) => status
            .sessions
            .iter()
            .map(|session| {
                ListItem::new(Line::from(format!(
                    "{:<6} {:<10} {}  {}",
                    session.provider,
                    session.status,
                    session.title.clone().unwrap_or_else(|| session.id.clone()),
                    session.cwd.clone().unwrap_or_default()
                )))
            })
            .collect::<Vec<_>>(),
        (TuiView::Events, _) => state
            .events
            .iter()
            .map(|event| {
                ListItem::new(Line::from(format!(
                    "#{:<5} {:<28} {}",
                    event.id,
                    event.event_type,
                    compact_json(&event.payload, 80)
                )))
            })
            .collect::<Vec<_>>(),
        (TuiView::Help, _) | (_, None) => vec![ListItem::new(Line::from("Press ? for help"))],
    };
    let selected = match state.view {
        TuiView::Workflows => state.selected_workflow,
        TuiView::Agents => state.selected_agent,
        TuiView::Sessions => state.selected_session,
        TuiView::Events => state.selected_event,
        TuiView::Help => 0,
    };
    let mut list_state = ListState::default();
    if !items.is_empty() && state.view != TuiView::Help {
        list_state.select(Some(selected));
    }
    let title = format!(" {} ", state.view.title());
    let list = List::new(items)
        .block(Block::default().borders(Borders::ALL).title(title))
        .highlight_style(
            Style::default()
                .fg(Color::Black)
                .bg(Color::Cyan)
                .add_modifier(Modifier::BOLD),
        )
        .highlight_symbol("› ");
    frame.render_stateful_widget(list, area, &mut list_state);
}

fn render_tui_detail(frame: &mut Frame<'_>, area: ratatui::layout::Rect, state: &TuiState) {
    let text = selected_detail_text(state);
    let paragraph = Paragraph::new(text)
        .block(Block::default().borders(Borders::ALL).title(" Detail "))
        .wrap(Wrap { trim: false });
    frame.render_widget(paragraph, area);
}

fn render_tui_event_stream(frame: &mut Frame<'_>, area: ratatui::layout::Rect, state: &TuiState) {
    let items = state
        .events
        .iter()
        .rev()
        .take(area.height.saturating_sub(2) as usize)
        .collect::<Vec<_>>()
        .into_iter()
        .rev()
        .map(|event| {
            ListItem::new(Line::from(format!(
                "#{:<5} {} {:<28} {}",
                event.id,
                event.ts,
                event.event_type,
                compact_json(&event.payload, 120)
            )))
        })
        .collect::<Vec<_>>();
    let list = List::new(items).block(Block::default().borders(Borders::ALL).title(" Events "));
    frame.render_widget(list, area);
}

fn render_tui_footer(frame: &mut Frame<'_>, area: ratatui::layout::Rect, state: &TuiState) {
    let keys = Line::from(vec![
        Span::styled(
            "q",
            Style::default()
                .fg(Color::Cyan)
                .add_modifier(Modifier::BOLD),
        ),
        Span::raw(" quit  "),
        Span::styled(
            "j/k",
            Style::default()
                .fg(Color::Cyan)
                .add_modifier(Modifier::BOLD),
        ),
        Span::raw(" move  "),
        Span::styled(
            "g/G",
            Style::default()
                .fg(Color::Cyan)
                .add_modifier(Modifier::BOLD),
        ),
        Span::raw(" top/bottom  "),
        Span::styled(
            "w/a/s/e",
            Style::default()
                .fg(Color::Cyan)
                .add_modifier(Modifier::BOLD),
        ),
        Span::raw(" views  "),
        Span::styled(
            "o",
            Style::default()
                .fg(Color::Cyan)
                .add_modifier(Modifier::BOLD),
        ),
        Span::raw(" open  "),
        Span::styled(
            "R",
            Style::default()
                .fg(Color::Cyan)
                .add_modifier(Modifier::BOLD),
        ),
        Span::raw(" restart dry-run  "),
        Span::styled(
            "r",
            Style::default()
                .fg(Color::Cyan)
                .add_modifier(Modifier::BOLD),
        ),
        Span::raw(format!(" refresh  view={}", state.view.title())),
    ]);
    let message_style = if state.status_message.starts_with("error:") || state.status_message.starts_with("open error:") || state.status_message.starts_with("restart error:") {
        Style::default().fg(Color::Red)
    } else {
        Style::default().fg(Color::Yellow)
    };
    let message = Line::from(vec![
        Span::styled(
            "status:",
            Style::default()
                .fg(Color::DarkGray)
                .add_modifier(Modifier::BOLD),
        ),
        Span::styled(
            if state.status_message.is_empty() {
                " ready"
            } else {
                &state.status_message
            },
            message_style,
        ),
    ]);
    let text = vec![keys, message];
    frame.render_widget(Paragraph::new(text), area);
}

fn selected_detail_text(state: &TuiState) -> String {
    match (state.view, &state.status) {
        (TuiView::Workflows, Some(status)) => status
            .workflows
            .get(state.selected_workflow)
            .map(|workflow| {
                format!(
                    "Workflow\n\nid: {}\nstatus: {}\ntitle: {}\nobjective: {}\nupdated: {}\n\nEnter filters events to this workflow.",
                    workflow.id,
                    workflow.status,
                    workflow.title.clone().unwrap_or_default(),
                    workflow.objective.clone().unwrap_or_default(),
                    workflow.updated_at
                )
            })
            .unwrap_or_else(|| "No workflows yet.".to_string()),
        (TuiView::Agents, Some(status)) => status
            .agents
            .get(state.selected_agent)
            .map(|agent| {
                format!(
                    "Agent\n\nid: {}\nworkflow: {}\nstatus: {}\nrole: {}\npersona: {}\ntool profile: {}\nsession id: {}\nsession file: {}\nartifact dir: {}\nlast event: {}\n\nsummary:\n{}",
                    agent.id,
                    agent.workflow_id,
                    agent.status,
                    agent.role,
                    agent.persona.clone().unwrap_or_default(),
                    agent.tool_profile,
                    agent.session_id.clone().unwrap_or_default(),
                    agent.session_file.clone().unwrap_or_default(),
                    agent.artifact_dir,
                    agent.last_event_at.clone().unwrap_or_default(),
                    agent.summary.clone().unwrap_or_default()
                )
            })
            .unwrap_or_else(|| "No agents yet.".to_string()),
        (TuiView::Sessions, Some(status)) => status
            .sessions
            .get(state.selected_session)
            .map(|session| {
                format!(
                    "Session\n\nid: {}\nprovider: {}\nstatus: {}\ntitle: {}\ncwd: {}\nsession file: {}\nupdated: {}",
                    session.id,
                    session.provider,
                    session.status,
                    session.title.clone().unwrap_or_default(),
                    session.cwd.clone().unwrap_or_default(),
                    session.session_file.clone().unwrap_or_default(),
                    session.updated_at
                )
            })
            .unwrap_or_else(|| "No external sessions indexed yet. Run `symphonyx sync`.".to_string()),
        (TuiView::Events, _) => state
            .events
            .get(state.selected_event)
            .map(|event| serde_json::to_string_pretty(event).unwrap_or_else(|_| "event".to_string()))
            .unwrap_or_else(|| "No events yet.".to_string()),
        (TuiView::Help, _) => "Keyboard\n\nq / Esc / Ctrl-C  quit\nj/k or ↑/↓       move selection\ng / G             jump top/bottom\nw                 workflows view\na                 agents view\ns                 sessions view\ne                 events view\no                 open selected workflow/agent/session\nR                 restart selected dry-run agent\nTab               cycle view\nEnter             filter events to selected workflow\nc                 clear workflow filter\nr                 refresh now\n? / h             help\n\nThe TUI auto-starts the repo-local SymphonyX daemon and syncs local sessions when needed.".to_string(),
        (_, None) => "Loading…".to_string(),
    }
}

fn list_questions(conn: &Connection) -> Result<Vec<QuestionSummary>> {
    let mut stmt = conn.prepare(
        "select id, workflow_id, subagent_id, severity, status, question, recommended_option, updated_at from human_questions where status='open' order by updated_at desc limit 50",
    )?;
    let rows = stmt.query_map([], |row| {
        Ok(QuestionSummary {
            id: row.get(0)?,
            workflow_id: row.get(1)?,
            subagent_id: row.get(2)?,
            severity: row.get(3)?,
            status: row.get(4)?,
            question: row.get(5)?,
            recommended_option: row.get(6)?,
            updated_at: row.get(7)?,
        })
    })?;
    rows.collect::<std::result::Result<Vec<_>, _>>()
        .map_err(Into::into)
}

fn answer_question(conn: &Connection, question_id: &str, answer: &str) -> Result<()> {
    let now = now_iso();
    let changed = conn.execute(
        "update human_questions set status='answered', answer=?1, answered_at=?2, updated_at=?2 where id=?3",
        params![answer, now, question_id],
    )?;
    if changed == 0 {
        bail!("question not found: {question_id}");
    }
    Ok(())
}
fn is_terminal_status(status: &str) -> bool {
    matches!(
        status,
        "done" | "failed" | "aborted" | "blocked" | "stale" | "offline"
    )
}

fn os_open(path: &Path) -> Result<()> {
    let path_str = path.display().to_string();
    #[cfg(target_os = "macos")]
    {
        Command::new("open").arg(&path_str).spawn()?.wait()?;
    }
    #[cfg(target_os = "linux")]
    {
        Command::new("xdg-open").arg(&path_str).spawn()?.wait()?;
    }
    #[cfg(target_os = "windows")]
    {
        Command::new("cmd").args(["/C", "start", "", &path_str]).spawn()?.wait()?;
    }
    #[cfg(not(any(target_os = "macos", target_os = "linux", target_os = "windows")))]
    {
        bail!("os open not supported on this platform");
    }
    Ok(())
}

fn open_args_json(args: &OpenArgs) -> bool {
    match &args.target {
        OpenTarget::Agent { json, .. } | OpenTarget::Session { json, .. } => *json,
    }
}


fn open_target(_paths: &Paths, conn: &Connection, args: &OpenArgs) -> Result<OpenOutput> {
    match &args.target {
        OpenTarget::Agent { id, json } => {
            let row: (Option<String>, String) = conn.query_row(
                "select session_file, artifact_dir from subagents where id=?1",
                [id],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )?;
            let target = row
                .0
                .filter(|p| !p.is_empty() && Path::new(p).exists())
                .map(PathBuf::from)
                .unwrap_or_else(|| PathBuf::from(&row.1));
            let opened = if *json {
                false
            } else {
                os_open(&target)?;
                true
            };
            Ok(OpenOutput {
                kind: "agent".to_string(),
                id: id.clone(),
                target: target.display().to_string(),
                opened,
            })
        }
        OpenTarget::Session { provider, id, json } => {
            let row: (Option<String>, Option<String>) = conn.query_row(
                "select session_file, cwd from external_sessions where provider=?1 and id=?2",
                [provider, id],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )?;
            let target = row
                .0
                .filter(|p| !p.is_empty() && Path::new(p).exists())
                .map(PathBuf::from)
                .or_else(|| row.1.filter(|p| !p.is_empty()).map(PathBuf::from))
                .ok_or_else(|| anyhow!("session has no session_file or cwd: {provider}/{id}"))?;
            let opened = if *json {
                false
            } else {
                os_open(&target)?;
                true
            };
            Ok(OpenOutput {
                kind: "session".to_string(),
                id: id.clone(),
                target: target.display().to_string(),
                opened,
            })
        }
    }
}

fn restart_agent(paths: &Paths, conn: &Connection, args: &RestartArgs) -> Result<RestartOutput> {
    let source_id = args.agent.clone();
    let row: (String, String, String, Option<String>, String, Option<String>, String, i64, String) = conn.query_row(
        "select workflow_id, status, role, persona, tool_profile, model, context_mode, dry_run, runner_kind from subagents where id=?1",
        [&source_id],
        |row| {
            Ok((
                row.get(0)?,
                row.get(1)?,
                row.get(2)?,
                row.get(3)?,
                row.get(4)?,
                row.get(5)?,
                row.get(6)?,
                row.get(7)?,
                row.get(8)?,
            ))
        },
    )?;
    let (
        source_workflow_id,
        source_status,
        role,
        persona,
        tool_profile,
        model,
        context_mode,
        dry_run_flag,
        runner_kind,
    ) = row;
    let dry_run = dry_run_flag != 0;

    if !is_terminal_status(&source_status) {
        bail!(
            "cannot restart agent {source_id}: status is {source_status}; restart is only allowed for terminal statuses (done, failed, aborted, blocked, stale, offline)"
        );
    }

    let source_artifact_dir: String = conn.query_row(
        "select artifact_dir from subagents where id=?1",
        [&source_id],
        |row| row.get(0),
    )?;
    let prompt_path = PathBuf::from(source_artifact_dir).join("prompt.md");
    if !prompt_path.is_file() {
        bail!(
            "cannot restart agent {source_id}: prompt artifact not readable at {}",
            prompt_path.display()
        );
    }

    let source_title: Option<String> = conn.query_row(
        "select title from workflow_runs where id=?1",
        [source_workflow_id.clone()],
        |row| row.get::<_, Option<String>>(0),
    )?;
    let runner = if dry_run {
        "pi-rpc".to_string()
    } else {
        runner_kind.clone()
    };

    let title = Some(format!(
        "restart of {} ({})",
        source_id,
        source_title.unwrap_or_else(|| "untitled".to_string())
    ));
    let objective = Some(format!(
        "re-run agent {source_id} from workflow {source_workflow_id} with runner {runner_kind}"
    ));

    let run_args = RunArgs {
        title,
        objective,
        prompt: prompt_path,
        tool_profile,
        runner,
        persona,
        role: Some(role),
        model,
        context_mode,
        json: args.json,
        dry_run,
        file_logs: false,
        timeout_seconds: 900,
    };
    let output = run_agent(paths, conn, run_args)?;
    Ok(RestartOutput {
        run: output,
        source_agent_id: source_id,
    })
}

fn run_agent(paths: &Paths, conn: &Connection, args: RunArgs) -> Result<RunOutput> {
    let profile = ToolProfile::from_name(&args.tool_profile)?;
    let runner = RunnerKind::from_name(&args.runner)?;
    let prompt_text = fs::read_to_string(&args.prompt)
        .with_context(|| format!("read prompt file {}", args.prompt.display()))?;
    if prompt_text.trim().is_empty() {
        bail!("prompt file is empty: {}", args.prompt.display());
    }

    let workflow_id = new_id("wf");
    let agent_id = new_id("agent");
    let now = now_iso();
    let title = args
        .title
        .clone()
        .or_else(|| Some("ad hoc SymphonyX run".to_string()));
    let role = args.role.clone().unwrap_or_else(|| "worker".to_string());
    let artifact_dir = paths.runs_dir.join(&workflow_id).join(&agent_id);
    fs::create_dir_all(&artifact_dir)?;
    let prompt_path = artifact_dir.join("prompt.md");
    fs::write(&prompt_path, &prompt_text)?;

    conn.execute(
        "insert into workflow_runs(id, created_at, updated_at, status, title, objective, workdir, config_json) values (?1, ?2, ?2, 'running', ?3, ?4, ?5, ?6)",
        params![workflow_id, now, title, args.objective, std::env::current_dir()?.display().to_string(), json!({"schema":"symphonyx.workflow/v0"}).to_string()],
    )?;
    conn.execute(
        "insert into subagents(id, workflow_id, created_at, updated_at, status, role, persona, tool_profile, model, context_mode, runner_kind, dry_run, artifact_dir, summary) values (?1, ?2, ?3, ?3, 'planned', ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, 'planned')",
        params![agent_id, workflow_id, now, role, args.persona, args.tool_profile, args.model, args.context_mode, runner.as_str(), args.dry_run as i64, artifact_dir.display().to_string()],
    )?;

    append_event(
        conn,
        &workflow_id,
        Some(&agent_id),
        "agent.planned",
        json!({
            "tool_profile": args.tool_profile,
            "runner": runner.as_str(),
            "persona": args.persona,
            "prompt_path": prompt_path,
            "dry_run": args.dry_run,
        }),
    )?;

    let events_path = artifact_dir.join("events.jsonl");
    let transcript_path = artifact_dir.join("transcript.jsonl");
    let stdout_path = artifact_dir.join("stdout.log");
    let stderr_path = artifact_dir.join("stderr.log");

    if args.dry_run {
        if args.file_logs {
            File::create(&events_path)?;
            File::create(&transcript_path)?;
        }
        set_agent_status(conn, &workflow_id, &agent_id, "done", "dry run")?;
        set_workflow_status(conn, &workflow_id, "done")?;
        append_artifact(
            conn,
            &workflow_id,
            Some(&agent_id),
            "text",
            "prompt",
            &prompt_path,
        )?;
        if args.file_logs {
            append_artifact(
                conn,
                &workflow_id,
                Some(&agent_id),
                "jsonl",
                "events",
                &events_path,
            )?;
            append_artifact(
                conn,
                &workflow_id,
                Some(&agent_id),
                "jsonl",
                "transcript",
                &transcript_path,
            )?;
        }
        return Ok(RunOutput {
            workflow_id,
            subagent_id: agent_id,
            status: "done".to_string(),
            artifact_dir: artifact_dir.display().to_string(),
            events_path: optional_path(args.file_logs, &events_path),
            transcript_path: optional_path(args.file_logs, &transcript_path),
            session_id: None,
            session_file: None,
            final_message_preview: None,
            file_logs: args.file_logs,
            dry_run: true,
        });
    }

    if matches!(runner, RunnerKind::CodexAppServer) {
        let result = run_codex_app_server_agent(
            paths,
            conn,
            &workflow_id,
            &agent_id,
            &artifact_dir,
            &events_path,
            &transcript_path,
            &prompt_text,
            &args,
            profile,
        );
        if let Err(error) = &result {
            persist_run_error(conn, &workflow_id, &agent_id, error);
        }
        return result;
    }

    set_agent_status(
        conn,
        &workflow_id,
        &agent_id,
        "starting",
        "launching pi rpc",
    )?;
    let mut child = ChildGuard::new(spawn_pi_rpc(&agent_id, profile, args.model.as_deref())?);
    let pid = child.id();
    conn.execute(
        "update subagents set pid=?1, status='running', updated_at=?2 where id=?3",
        params![pid as i64, now_iso(), agent_id],
    )?;
    append_event(
        conn,
        &workflow_id,
        Some(&agent_id),
        "agent.started",
        json!({"pid": pid}),
    )?;

    let mut timeout_guard = TimeoutGuard::new(pid, args.timeout_seconds);
    let stderr = child.take_stderr().context("pi child stderr unavailable")?;
    let stderr_rx = spawn_stderr_reader(stderr, args.file_logs, stderr_path.clone());

    let mut stdin = child.take_stdin().context("pi child stdin unavailable")?;
    let mut stdout = BufReader::new(child.take_stdout().context("pi child stdout unavailable")?);
    let mut stdout_log = optional_file_create(args.file_logs, &stdout_path)?;
    let mut events_file = optional_file_append(args.file_logs, &events_path)?;
    let mut transcript_file = optional_file_append(args.file_logs, &transcript_path)?;

    let child_prompt = build_child_prompt(
        &prompt_text,
        args.persona.as_deref(),
        &args.tool_profile,
        &args.context_mode,
    );
    let command = json!({"id":"prompt-1","type":"prompt","message":child_prompt});
    writeln!(stdin, "{command}")?;
    stdin.flush()?;

    let mut line = String::new();
    let mut final_status = "failed".to_string();
    let mut final_message_preview = None;
    loop {
        line.clear();
        let read = stdout.read_line(&mut line)?;
        if read == 0 {
            break;
        }
        let trimmed = line.trim_end_matches(['\n', '\r']);
        if let Some(stdout_log) = stdout_log.as_mut() {
            writeln!(stdout_log, "{trimmed}")?;
        }
        let payload =
            serde_json::from_str::<Value>(trimmed).unwrap_or_else(|_| json!({"raw": trimmed}));
        if let Some(events_file) = events_file.as_mut() {
            writeln!(events_file, "{}", serde_json::to_string(&payload)?)?;
        }
        let event_type = payload.get("type").and_then(Value::as_str).unwrap_or("raw");
        append_event(
            conn,
            &workflow_id,
            Some(&agent_id),
            &format!("pi.{event_type}"),
            payload.clone(),
        )?;

        if event_type == "message_end" || event_type == "turn_end" || event_type == "agent_end" {
            if let Some(text) = extract_textish_payload(&payload) {
                final_message_preview = Some(preview(&text, 500));
            }
            if let Some(transcript_file) = transcript_file.as_mut() {
                writeln!(transcript_file, "{}", serde_json::to_string(&payload)?)?;
            }
        }
        if event_type == "agent_end" {
            final_status = "done".to_string();
            break;
        }
    }

    timeout_guard.cancel();
    child.shutdown();
    drain_stderr_events(conn, &workflow_id, Some(&agent_id), &stderr_rx)?;
    let summary = if let Some(message) = final_message_preview.as_deref() {
        format!("pi rpc run finished: {}", preview(message, 160))
    } else {
        "pi rpc run finished".to_string()
    };
    set_agent_status(conn, &workflow_id, &agent_id, &final_status, &summary)?;
    set_workflow_status(conn, &workflow_id, &final_status)?;
    if args.file_logs {
        append_artifact(
            conn,
            &workflow_id,
            Some(&agent_id),
            "jsonl",
            "events",
            &events_path,
        )?;
        append_artifact(
            conn,
            &workflow_id,
            Some(&agent_id),
            "jsonl",
            "transcript",
            &transcript_path,
        )?;
        append_artifact(
            conn,
            &workflow_id,
            Some(&agent_id),
            "text",
            "stdout",
            &stdout_path,
        )?;
        append_artifact(
            conn,
            &workflow_id,
            Some(&agent_id),
            "text",
            "stderr",
            &stderr_path,
        )?;
    }

    Ok(RunOutput {
        workflow_id,
        subagent_id: agent_id,
        status: final_status,
        artifact_dir: artifact_dir.display().to_string(),
        events_path: optional_path(args.file_logs, &events_path),
        transcript_path: optional_path(args.file_logs, &transcript_path),
        session_id: None,
        session_file: None,
        final_message_preview,
        file_logs: args.file_logs,
        dry_run: false,
    })
}
fn read_task_list(path: &Path) -> Result<Vec<String>> {
    let text =
        fs::read_to_string(path).with_context(|| format!("read task list {}", path.display()))?;
    let mut tasks = Vec::new();
    for line in text.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() || trimmed.starts_with('#') {
            continue;
        }
        tasks.push(trimmed.to_string());
    }
    Ok(tasks)
}

fn run_spike(paths: &Paths, conn: &Connection, args: SpikeArgs) -> Result<SpikeOutput> {
    let mut tasks = read_task_list(&args.task_list)?;
    if tasks.len() < 2 {
        bail!(
            "task list must contain at least two tasks, found {}",
            tasks.len()
        );
    }

    let workflow_id = new_id("wf");
    let done_agent_id = new_id("agent");
    let blocked_agent_id = new_id("agent");
    let failed_agent_id = new_id("agent");
    let now = now_iso();
    let workdir = std::env::current_dir()?.display().to_string();

    conn.execute(
        "insert into workflow_runs(id, created_at, updated_at, status, title, objective, workdir, config_json) values (?1, ?2, ?2, 'running', ?3, ?4, ?5, ?6)",
        params![
            workflow_id,
            now,
            "runtime substrate spike",
            "prove SQLite/event/session/task path for control-plane-core",
            workdir,
            json!({"schema":"symphonyx.runtime-spike/v0"}).to_string()
        ],
    )?;

    append_event(
        conn,
        &workflow_id,
        None,
        "workflow.spike.started",
        json!({"task_count": tasks.len()}),
    )?;

    let done_task = tasks.remove(0);
    let blocked_task = tasks.remove(0);
    let failed_task = "simulate crashed worker with explicit failed state".to_string();

    let agents = vec![
        (
            done_agent_id.clone(),
            "spike-done-worker",
            done_task,
            "done",
            "dry-run done",
        ),
        (
            blocked_agent_id.clone(),
            "spike-blocked-worker",
            blocked_task,
            "blocked",
            "dry-run blocked",
        ),
        (
            failed_agent_id.clone(),
            "spike-crash-simulation",
            failed_task,
            "failed",
            "simulated crash / explicit failed state",
        ),
    ];

    for (agent_id, role, task_text, final_status, final_summary_prefix) in agents {
        let artifact_dir = paths.runs_dir.join(&workflow_id).join(&agent_id);
        fs::create_dir_all(&artifact_dir)?;
        let prompt_path = artifact_dir.join("prompt.md");
        fs::write(&prompt_path, &task_text)?;

        conn.execute(
            "insert into subagents(id, workflow_id, created_at, updated_at, status, role, persona, tool_profile, model, context_mode, runner_kind, dry_run, artifact_dir, summary) values (?1, ?2, ?3, ?3, 'planned', ?4, ?5, ?6, ?7, ?8, ?9, 1, ?10, 'planned')",
            params![
                agent_id,
                workflow_id,
                now,
                role,
                Option::<String>::None,
                "reviewer-readonly",
                Option::<String>::None,
                "prompt-only",
                "dry-run",
                artifact_dir.display().to_string()
            ],
        )?;

        append_artifact(
            conn,
            &workflow_id,
            Some(&agent_id),
            "text",
            "prompt",
            &prompt_path,
        )?;

        append_event(
            conn,
            &workflow_id,
            Some(&agent_id),
            "agent.planned",
            json!({
                "role": role,
                "runner": "dry-run",
                "prompt_path": prompt_path,
            }),
        )?;

        set_agent_status(
            conn,
            &workflow_id,
            &agent_id,
            "running",
            &format!("running: {}", preview(&task_text, 120)),
        )?;

        let final_summary = format!("{}: {}", final_summary_prefix, preview(&task_text, 120));
        set_agent_status(conn, &workflow_id, &agent_id, final_status, &final_summary)?;
    }

    append_event(
        conn,
        &workflow_id,
        Some(&failed_agent_id),
        "agent.crash_simulated",
        json!({"reason":"explicit failed state for acceptance proof"}),
    )?;

    let session_id = format!("{workflow_id}-crashed");
    conn.execute(
        "insert into external_sessions(id, provider, status, title, cwd, session_file, updated_at, meta_json) values (?1, ?2, 'failed', ?3, ?4, ?5, ?6, ?7)
         on conflict(provider, id) do update set status='failed', title=?3, cwd=?4, session_file=?5, updated_at=?6, meta_json=?7",
        params![
            session_id,
            "symphonyx-spike",
            "simulated crashed worker",
            workdir,
            Option::<String>::None,
            now_iso(),
            json!({"failed_agent_id": failed_agent_id, "reason":"simulated crash / explicit failed state"}).to_string()
        ],
    )?;

    append_event(
        conn,
        &workflow_id,
        None,
        "session.observed",
        json!({
            "provider": "symphonyx-spike",
            "session_id": session_id,
            "status": "failed",
            "failed_agent_id": failed_agent_id,
        }),
    )?;

    set_workflow_status(conn, &workflow_id, "blocked")?;

    let status = status_output(paths, conn)?;
    let agent_infos = vec![
        SpikeAgentInfo {
            agent_id: done_agent_id.clone(),
            role: "spike-done-worker".to_string(),
            status: "done".to_string(),
        },
        SpikeAgentInfo {
            agent_id: blocked_agent_id.clone(),
            role: "spike-blocked-worker".to_string(),
            status: "blocked".to_string(),
        },
        SpikeAgentInfo {
            agent_id: failed_agent_id.clone(),
            role: "spike-crash-simulation".to_string(),
            status: "failed".to_string(),
        },
    ];

    let acceptance = vec![
        "read local task list".to_string(),
        "created one workflow".to_string(),
        "created dry-run done worker".to_string(),
        "created dry-run blocked worker".to_string(),
        "persisted workflow/subagent/session/event rows".to_string(),
        "simulated crashed worker with explicit failed state".to_string(),
        "returned bounded status/proof JSON without TUI".to_string(),
    ];

    Ok(SpikeOutput {
        workflow_id,
        done_agent_id,
        blocked_agent_id,
        failed_agent_id,
        status,
        acceptance,
        agents: agent_infos,
    })
}

fn spawn_pi_rpc(agent_id: &str, profile: ToolProfile, model: Option<&str>) -> Result<Child> {
    let mut cmd = Command::new("pi");
    cmd.arg("--mode")
        .arg("rpc")
        .arg("--no-session")
        .arg("--name")
        .arg(agent_id)
        .arg("--tools")
        .arg(profile.tools_csv())
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    if let Some(model) = model {
        cmd.arg("--model").arg(model);
    }
    set_child_process_group(&mut cmd);
    cmd.spawn().context("spawn pi --mode rpc")
}

fn build_child_prompt(
    prompt: &str,
    persona: Option<&str>,
    tool_profile: &str,
    context_mode: &str,
) -> String {
    let mut out = String::new();
    out.push_str("You are a SymphonyX child agent.\n");
    out.push_str("Follow your assigned role and produce a compact final answer.\n");
    out.push_str(&format!("Tool profile: {tool_profile}\n"));
    out.push_str(&format!("Context mode: {context_mode}\n"));
    if let Some(persona) = persona {
        out.push_str(&format!("Persona: {persona}\n"));
    }
    out.push_str("\nTask:\n");
    out.push_str(prompt);
    out
}

struct ChildGuard {
    child: Option<Child>,
}

impl ChildGuard {
    fn new(child: Child) -> Self {
        Self { child: Some(child) }
    }

    fn id(&self) -> u32 {
        self.child.as_ref().map(Child::id).unwrap_or_default()
    }

    fn take_stdin(&mut self) -> Option<ChildStdin> {
        self.child.as_mut()?.stdin.take()
    }

    fn take_stdout(&mut self) -> Option<ChildStdout> {
        self.child.as_mut()?.stdout.take()
    }

    fn take_stderr(&mut self) -> Option<ChildStderr> {
        self.child.as_mut()?.stderr.take()
    }

    fn shutdown(&mut self) {
        if let Some(child) = self.child.as_mut() {
            shutdown_child(child);
        }
        self.child = None;
    }
}

impl Drop for ChildGuard {
    fn drop(&mut self) {
        self.shutdown();
    }
}

struct TimeoutGuard {
    cancel_sender: Option<mpsc::Sender<()>>,
}

impl TimeoutGuard {
    fn new(pid: u32, timeout_seconds: u64) -> Self {
        let (sender, receiver) = mpsc::channel();
        thread::spawn(move || {
            if receiver
                .recv_timeout(Duration::from_secs(timeout_seconds.max(1)))
                .is_err()
            {
                terminate_child_process_group(pid);
                thread::sleep(Duration::from_millis(200));
                kill_child_process_group(pid);
            }
        });
        Self {
            cancel_sender: Some(sender),
        }
    }

    fn cancel(&mut self) {
        if let Some(sender) = self.cancel_sender.take() {
            let _ = sender.send(());
        }
    }
}

impl Drop for TimeoutGuard {
    fn drop(&mut self) {
        self.cancel();
    }
}

fn shutdown_child(child: &mut Child) {
    if child.try_wait().ok().flatten().is_some() {
        return;
    }
    terminate_child_process_group(child.id());
    thread::sleep(Duration::from_millis(200));
    if child.try_wait().ok().flatten().is_none() {
        kill_child_process_group(child.id());
        let _ = child.kill();
    }
    let _ = child.wait();
}

fn set_child_process_group(cmd: &mut Command) {
    #[cfg(unix)]
    {
        cmd.process_group(0);
    }
}

fn terminate_child_process_group(pid: u32) {
    signal_child_process_group(pid, "-TERM");
}

fn kill_child_process_group(pid: u32) {
    signal_child_process_group(pid, "-KILL");
}

fn signal_child_process_group(pid: u32, signal: &str) {
    #[cfg(unix)]
    {
        let _ = Command::new("kill")
            .arg(signal)
            .arg(format!("-{pid}"))
            .status();
    }
}

fn run_codex_app_server_agent(
    _paths: &Paths,
    conn: &Connection,
    workflow_id: &str,
    agent_id: &str,
    artifact_dir: &Path,
    events_path: &Path,
    transcript_path: &Path,
    prompt_text: &str,
    args: &RunArgs,
    profile: ToolProfile,
) -> Result<RunOutput> {
    let stdout_path = artifact_dir.join("stdout.log");
    let stderr_path = artifact_dir.join("stderr.log");

    set_agent_status(
        conn,
        workflow_id,
        agent_id,
        "starting",
        "launching codex app-server",
    )?;
    let mut child = ChildGuard::new(spawn_codex_app_server()?);
    let pid = child.id();
    conn.execute(
        "update subagents set pid=?1, status='running', updated_at=?2 where id=?3",
        params![pid as i64, now_iso(), agent_id],
    )?;
    append_event(
        conn,
        workflow_id,
        Some(agent_id),
        "agent.started",
        json!({"pid": pid, "runner": "codex-app-server"}),
    )?;

    let mut timeout_guard = TimeoutGuard::new(pid, args.timeout_seconds);
    let stderr = child
        .take_stderr()
        .context("codex child stderr unavailable")?;
    let stderr_rx = spawn_stderr_reader(stderr, args.file_logs, stderr_path.clone());

    let mut stdin = child
        .take_stdin()
        .context("codex child stdin unavailable")?;
    let mut stdout = BufReader::new(
        child
            .take_stdout()
            .context("codex child stdout unavailable")?,
    );
    let mut sink = CodexEventSink {
        conn,
        workflow_id,
        agent_id,
        stdout_log: optional_file_create(args.file_logs, &stdout_path)?,
        events_file: optional_file_append(args.file_logs, events_path)?,
        transcript_file: optional_file_append(args.file_logs, transcript_path)?,
        latest_agent_message: None,
    };

    let initialize_id = 1_i64;
    codex_send(
        &mut stdin,
        &mut sink,
        &json!({
            "id": initialize_id,
            "method": "initialize",
            "params": {
                "clientInfo": {
                    "name": "symphonyx",
                    "title": "SymphonyX",
                    "version": env!("CARGO_PKG_VERSION"),
                },
                "capabilities": {
                    "experimentalApi": true,
                    "requestAttestation": false,
                },
            },
        }),
    )?;
    let initialize_response =
        codex_read_until_response(&mut stdout, &mut stdin, &mut sink, initialize_id)?;
    append_event(
        conn,
        workflow_id,
        Some(agent_id),
        "codex.initialize",
        json!({"response": initialize_response}),
    )?;
    codex_send(&mut stdin, &mut sink, &json!({"method": "initialized"}))?;

    let (sandbox, approval_policy) = profile.codex_policy();
    let thread_id_req = 2_i64;
    let mut thread_params = json!({
        "cwd": std::env::current_dir()?.display().to_string(),
        "approvalPolicy": approval_policy,
        "approvalsReviewer": "user",
        "sandbox": sandbox,
        "serviceName": "symphonyx",
        "threadSource": "subagent",
        "developerInstructions": build_codex_developer_instructions(
            args.persona.as_deref(),
            &args.tool_profile,
            &args.context_mode,
        ),
    });
    if let Some(model) = args.model.as_deref() {
        thread_params["model"] = json!(model);
    }
    codex_send(
        &mut stdin,
        &mut sink,
        &json!({"id": thread_id_req, "method": "thread/start", "params": thread_params}),
    )?;
    let thread_response =
        codex_read_until_response(&mut stdout, &mut stdin, &mut sink, thread_id_req)?;
    let thread_id = thread_response
        .get("result")
        .and_then(|result| result.get("thread"))
        .and_then(|thread| thread.get("id"))
        .and_then(Value::as_str)
        .context("codex thread/start response missing result.thread.id")?
        .to_string();
    let session_id = thread_response
        .get("result")
        .and_then(|result| result.get("thread"))
        .and_then(|thread| thread.get("sessionId"))
        .and_then(Value::as_str)
        .map(str::to_string);
    let session_file = thread_response
        .get("result")
        .and_then(|result| result.get("thread"))
        .and_then(|thread| thread.get("path"))
        .and_then(Value::as_str)
        .map(str::to_string);
    conn.execute(
        "update subagents set session_id=?1, session_file=?2, updated_at=?3 where id=?4",
        params![
            session_id.as_deref(),
            session_file.as_deref(),
            now_iso(),
            agent_id
        ],
    )?;
    append_event(
        conn,
        workflow_id,
        Some(agent_id),
        "codex.thread.started",
        json!({"thread_id": thread_id, "response": thread_response}),
    )?;

    let turn_id_req = 3_i64;
    let child_prompt = build_child_prompt(
        prompt_text,
        args.persona.as_deref(),
        &args.tool_profile,
        &args.context_mode,
    );
    let mut turn_params = json!({
        "threadId": thread_id,
        "clientUserMessageId": format!("{agent_id}-turn-1"),
        "input": [{
            "type": "text",
            "text": child_prompt,
            "text_elements": [],
        }],
    });
    if let Some(model) = args.model.as_deref() {
        turn_params["model"] = json!(model);
    }
    codex_send(
        &mut stdin,
        &mut sink,
        &json!({"id": turn_id_req, "method": "turn/start", "params": turn_params}),
    )?;
    let turn_response = codex_read_until_response(&mut stdout, &mut stdin, &mut sink, turn_id_req)?;
    append_event(
        conn,
        workflow_id,
        Some(agent_id),
        "codex.turn.started",
        json!({"response": turn_response}),
    )?;

    let completed = codex_read_until_turn_completed(&mut stdout, &mut stdin, &mut sink)?;
    let turn_status = completed
        .get("params")
        .and_then(|params| params.get("turn"))
        .and_then(|turn| turn.get("status"))
        .and_then(Value::as_str)
        .unwrap_or("unknown");
    let final_status = if turn_status == "completed" {
        "done"
    } else {
        "failed"
    };

    let final_message_preview = sink
        .latest_agent_message
        .clone()
        .map(|message| preview(&message, 500));
    let summary = if let Some(message) = final_message_preview.as_deref() {
        format!(
            "codex app-server turn {turn_status}: {}",
            preview(message, 160)
        )
    } else {
        format!("codex app-server turn {turn_status}")
    };

    timeout_guard.cancel();
    child.shutdown();
    drain_stderr_events(conn, workflow_id, Some(agent_id), &stderr_rx)?;
    set_agent_status(conn, workflow_id, agent_id, final_status, &summary)?;
    set_workflow_status(conn, workflow_id, final_status)?;
    if args.file_logs {
        append_artifact(
            conn,
            workflow_id,
            Some(agent_id),
            "jsonl",
            "events",
            events_path,
        )?;
        append_artifact(
            conn,
            workflow_id,
            Some(agent_id),
            "jsonl",
            "transcript",
            transcript_path,
        )?;
        append_artifact(
            conn,
            workflow_id,
            Some(agent_id),
            "text",
            "stdout",
            &stdout_path,
        )?;
        append_artifact(
            conn,
            workflow_id,
            Some(agent_id),
            "text",
            "stderr",
            &stderr_path,
        )?;
    }

    Ok(RunOutput {
        workflow_id: workflow_id.to_string(),
        subagent_id: agent_id.to_string(),
        status: final_status.to_string(),
        artifact_dir: artifact_dir.display().to_string(),
        events_path: optional_path(args.file_logs, events_path),
        transcript_path: optional_path(args.file_logs, transcript_path),
        session_id,
        session_file,
        final_message_preview,
        file_logs: args.file_logs,
        dry_run: false,
    })
}

fn spawn_codex_app_server() -> Result<Child> {
    let codex_bin = std::env::var("SYMPHONYX_CODEX_BIN")
        .or_else(|_| std::env::var("CODEX_BIN"))
        .unwrap_or_else(|_| "codex".to_string());
    let mut cmd = Command::new(codex_bin);
    cmd.arg("app-server")
        .arg("--listen")
        .arg("stdio://")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    set_child_process_group(&mut cmd);
    cmd.spawn()
        .context("spawn codex app-server --listen stdio://")
}

struct CodexEventSink<'a> {
    conn: &'a Connection,
    workflow_id: &'a str,
    agent_id: &'a str,
    stdout_log: Option<File>,
    events_file: Option<File>,
    transcript_file: Option<File>,
    latest_agent_message: Option<String>,
}

fn codex_send(
    stdin: &mut std::process::ChildStdin,
    sink: &mut CodexEventSink<'_>,
    payload: &Value,
) -> Result<()> {
    append_event(
        sink.conn,
        sink.workflow_id,
        Some(sink.agent_id),
        "codex.client.send",
        payload.clone(),
    )?;
    writeln!(stdin, "{}", serde_json::to_string(payload)?)?;
    stdin.flush()?;
    Ok(())
}

fn codex_read_message(
    stdout: &mut BufReader<std::process::ChildStdout>,
    sink: &mut CodexEventSink<'_>,
) -> Result<Value> {
    let mut line = String::new();
    let read = stdout.read_line(&mut line)?;
    if read == 0 {
        bail!("codex app-server stdout closed");
    }
    let trimmed = line.trim_end_matches(['\n', '\r']);
    if let Some(stdout_log) = sink.stdout_log.as_mut() {
        writeln!(stdout_log, "{trimmed}")?;
    }
    let payload =
        serde_json::from_str::<Value>(trimmed).unwrap_or_else(|_| json!({"raw": trimmed}));
    if let Some(events_file) = sink.events_file.as_mut() {
        writeln!(events_file, "{}", serde_json::to_string(&payload)?)?;
    }
    append_event(
        sink.conn,
        sink.workflow_id,
        Some(sink.agent_id),
        &codex_event_type(&payload),
        payload.clone(),
    )?;
    if let Some(message) = codex_agent_message_text(&payload) {
        sink.latest_agent_message = Some(message);
    }
    if codex_is_transcript_message(&payload) {
        if let Some(transcript_file) = sink.transcript_file.as_mut() {
            writeln!(transcript_file, "{}", serde_json::to_string(&payload)?)?;
        }
    }
    Ok(payload)
}

fn codex_read_until_response(
    stdout: &mut BufReader<std::process::ChildStdout>,
    stdin: &mut std::process::ChildStdin,
    sink: &mut CodexEventSink<'_>,
    request_id: i64,
) -> Result<Value> {
    loop {
        let payload = codex_read_message(stdout, sink)?;
        if codex_error_matches(&payload, request_id) {
            bail!("codex request {request_id} failed: {payload}");
        }
        if codex_response_matches(&payload, request_id) {
            return Ok(payload);
        }
        codex_maybe_respond_to_server_request(stdin, sink, &payload)?;
    }
}

fn codex_read_until_turn_completed(
    stdout: &mut BufReader<std::process::ChildStdout>,
    stdin: &mut std::process::ChildStdin,
    sink: &mut CodexEventSink<'_>,
) -> Result<Value> {
    loop {
        let payload = codex_read_message(stdout, sink)?;
        if payload.get("method").and_then(Value::as_str) == Some("turn/completed") {
            return Ok(payload);
        }
        codex_maybe_respond_to_server_request(stdin, sink, &payload)?;
    }
}

fn codex_maybe_respond_to_server_request(
    stdin: &mut std::process::ChildStdin,
    sink: &mut CodexEventSink<'_>,
    payload: &Value,
) -> Result<()> {
    let Some(method) = payload.get("method").and_then(Value::as_str) else {
        return Ok(());
    };
    let Some(id) = payload.get("id") else {
        return Ok(());
    };
    if payload.get("result").is_some() || payload.get("error").is_some() {
        return Ok(());
    }

    let response = match method {
        "item/commandExecution/requestApproval" => {
            json!({"id": id, "result": {"decision": "decline"}})
        }
        "item/fileChange/requestApproval" => json!({"id": id, "result": {"decision": "decline"}}),
        "item/tool/requestUserInput" => json!({"id": id, "result": {"answers": {}}}),
        "mcpServer/elicitation/request" => {
            json!({"id": id, "result": {"action": "decline", "content": null, "_meta": null}})
        }
        "item/permissions/requestApproval" => {
            json!({"id": id, "result": {"permissions": {}, "scope": "turn", "strictAutoReview": true}})
        }
        "item/tool/call" => json!({"id": id, "result": {"contentItems": [], "success": false}}),
        _ => json!({
            "id": id,
            "error": {
                "code": -32601,
                "message": format!("SymphonyX does not implement server request method {method}"),
            },
        }),
    };

    append_event(
        sink.conn,
        sink.workflow_id,
        Some(sink.agent_id),
        "codex.client.response",
        response.clone(),
    )?;
    writeln!(stdin, "{}", serde_json::to_string(&response)?)?;
    stdin.flush()?;
    Ok(())
}

fn codex_event_type(payload: &Value) -> String {
    if let Some(method) = payload.get("method").and_then(Value::as_str) {
        if payload.get("id").is_some() {
            return format!("codex.request.{method}");
        }
        return format!("codex.notification.{method}");
    }
    if payload.get("error").is_some() {
        "codex.error".to_string()
    } else if payload.get("result").is_some() {
        "codex.response".to_string()
    } else {
        "codex.raw".to_string()
    }
}

fn codex_is_transcript_message(payload: &Value) -> bool {
    let method = payload.get("method").and_then(Value::as_str);
    matches!(
        method,
        Some("turn/started")
            | Some("turn/completed")
            | Some("item/started")
            | Some("item/completed")
            | Some("item/agentMessage/delta")
            | Some("item/reasoning/summaryTextDelta")
            | Some("item/reasoning/textDelta")
            | Some("item/commandExecution/outputDelta")
            | Some("item/fileChange/outputDelta")
            | Some("error")
    )
}

fn codex_response_matches(payload: &Value, request_id: i64) -> bool {
    payload.get("result").is_some() && codex_id_matches(payload.get("id"), request_id)
}

fn codex_error_matches(payload: &Value, request_id: i64) -> bool {
    payload.get("error").is_some() && codex_id_matches(payload.get("id"), request_id)
}

fn codex_id_matches(value: Option<&Value>, request_id: i64) -> bool {
    match value {
        Some(Value::Number(number)) => number.as_i64() == Some(request_id),
        Some(Value::String(text)) => text == &request_id.to_string(),
        _ => false,
    }
}

fn codex_agent_message_text(payload: &Value) -> Option<String> {
    if payload.get("method").and_then(Value::as_str) != Some("item/completed") {
        return None;
    }
    let item = payload.get("params")?.get("item")?;
    if item.get("type").and_then(Value::as_str) != Some("agentMessage") {
        return None;
    }
    item.get("text").and_then(Value::as_str).map(str::to_string)
}

fn extract_textish_payload(payload: &Value) -> Option<String> {
    for key in ["text", "message", "content", "output", "response"] {
        if let Some(text) = payload.get(key).and_then(Value::as_str) {
            if !text.trim().is_empty() {
                return Some(text.to_string());
            }
        }
    }
    if let Some(object) = payload.as_object() {
        for value in object.values() {
            if let Some(text) = extract_textish_payload(value) {
                return Some(text);
            }
        }
    }
    if let Some(array) = payload.as_array() {
        for value in array {
            if let Some(text) = extract_textish_payload(value) {
                return Some(text);
            }
        }
    }
    None
}

fn build_codex_developer_instructions(
    persona: Option<&str>,
    tool_profile: &str,
    context_mode: &str,
) -> String {
    let mut out = String::new();
    out.push_str("You are a SymphonyX child agent running through Codex app-server. ");
    out.push_str(
        "Produce compact, evidence-backed output and avoid unnecessary repository mutation.\n",
    );
    out.push_str(&format!("Tool profile: {tool_profile}.\n"));
    out.push_str(&format!("Context mode: {context_mode}.\n"));
    if let Some(persona) = persona {
        out.push_str(&format!("Persona: {persona}.\n"));
    }
    out
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum RunnerKind {
    PiRpc,
    CodexAppServer,
}

impl RunnerKind {
    fn from_name(name: &str) -> Result<Self> {
        match name {
            "pi-rpc" => Ok(Self::PiRpc),
            "codex-app-server" => Ok(Self::CodexAppServer),
            other => Err(anyhow!(
                "unknown runner: {other}; known: pi-rpc, codex-app-server"
            )),
        }
    }

    fn as_str(self) -> &'static str {
        match self {
            Self::PiRpc => "pi-rpc",
            Self::CodexAppServer => "codex-app-server",
        }
    }
}

#[derive(Clone, Copy)]
enum ToolProfile {
    ReviewerReadonly,
    ImplementerTs,
}

impl ToolProfile {
    fn from_name(name: &str) -> Result<Self> {
        match name {
            "reviewer-readonly" => Ok(Self::ReviewerReadonly),
            "implementer-ts" => Ok(Self::ImplementerTs),
            other => Err(anyhow!(
                "unknown tool profile: {other}; known: reviewer-readonly, implementer-ts"
            )),
        }
    }

    fn tools_csv(self) -> &'static str {
        match self {
            Self::ReviewerReadonly => "read,grep,find,ls",
            Self::ImplementerTs => "read,bash,edit,write",
        }
    }

    fn codex_policy(self) -> (&'static str, &'static str) {
        match self {
            Self::ReviewerReadonly => ("read-only", "never"),
            Self::ImplementerTs => ("workspace-write", "never"),
        }
    }
}

fn append_event(
    conn: &Connection,
    workflow_id: &str,
    subagent_id: Option<&str>,
    event_type: &str,
    payload: Value,
) -> Result<i64> {
    let ts = now_iso();
    conn.execute(
        "insert into agent_events(workflow_id, subagent_id, ts, type, payload_json) values (?1, ?2, ?3, ?4, ?5)",
        params![workflow_id, subagent_id, ts, event_type, payload.to_string()],
    )?;
    if let Some(subagent_id) = subagent_id {
        conn.execute(
            "update subagents set last_event_at=?1, updated_at=?1 where id=?2",
            params![now_iso(), subagent_id],
        )?;
    }
    Ok(conn.last_insert_rowid())
}

fn spawn_stderr_reader(stderr: ChildStderr, file_logs: bool, path: PathBuf) -> Receiver<String> {
    let (sender, receiver) = mpsc::channel();
    thread::spawn(move || {
        let mut file = if file_logs {
            File::create(path).ok()
        } else {
            None
        };
        let reader = BufReader::new(stderr);
        for line in reader.lines().map_while(std::result::Result::ok) {
            if let Some(file) = file.as_mut() {
                let _ = writeln!(file, "{line}");
            }
            let _ = sender.send(line);
        }
    });
    receiver
}

fn drain_stderr_events(
    conn: &Connection,
    workflow_id: &str,
    subagent_id: Option<&str>,
    receiver: &Receiver<String>,
) -> Result<()> {
    for line in receiver.try_iter() {
        append_event(
            conn,
            workflow_id,
            subagent_id,
            "process.stderr",
            json!({"line": line}),
        )?;
    }
    Ok(())
}

fn optional_file_create(enabled: bool, path: &Path) -> Result<Option<File>> {
    if enabled {
        Ok(Some(File::create(path)?))
    } else {
        Ok(None)
    }
}

fn optional_file_append(enabled: bool, path: &Path) -> Result<Option<File>> {
    if enabled {
        Ok(Some(
            OpenOptions::new().create(true).append(true).open(path)?,
        ))
    } else {
        Ok(None)
    }
}

fn optional_path(enabled: bool, path: &Path) -> Option<String> {
    enabled.then(|| path.display().to_string())
}

fn append_artifact(
    conn: &Connection,
    workflow_id: &str,
    subagent_id: Option<&str>,
    kind: &str,
    role: &str,
    path: &Path,
) -> Result<()> {
    let id = new_id("artifact");
    conn.execute(
        "insert into artifacts(id, workflow_id, subagent_id, kind, role, path, created_at, meta_json) values (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
        params![id, workflow_id, subagent_id, kind, role, path.display().to_string(), now_iso(), json!({}).to_string()],
    )?;
    Ok(())
}

fn set_agent_status(
    conn: &Connection,
    workflow_id: &str,
    agent_id: &str,
    status: &str,
    summary: &str,
) -> Result<()> {
    let now = now_iso();
    conn.execute(
        "update subagents set status=?1, summary=?2, updated_at=?3 where id=?4",
        params![status, summary, now, agent_id],
    )?;
    append_event(
        conn,
        workflow_id,
        Some(agent_id),
        "agent.status",
        json!({"status": status, "summary": summary}),
    )?;
    Ok(())
}

fn set_workflow_status(conn: &Connection, workflow_id: &str, status: &str) -> Result<()> {
    conn.execute(
        "update workflow_runs set status=?1, updated_at=?2 where id=?3",
        params![status, now_iso(), workflow_id],
    )?;
    append_event(
        conn,
        workflow_id,
        None,
        "workflow.status",
        json!({"status": status}),
    )?;
    Ok(())
}

fn persist_run_error(conn: &Connection, workflow_id: &str, agent_id: &str, error: &anyhow::Error) {
    let message = error.to_string();
    let _ = append_event(
        conn,
        workflow_id,
        Some(agent_id),
        "agent.error",
        json!({"message": message}),
    );
    let _ = set_agent_status(
        conn,
        workflow_id,
        agent_id,
        "failed",
        &format!("failed: {}", preview(&message, 180)),
    );
    let _ = set_workflow_status(conn, workflow_id, "failed");
}

fn recent_events(
    conn: &Connection,
    workflow_id: Option<&str>,
    limit: i64,
) -> Result<Vec<EventRecord>> {
    let limit = limit.clamp(1, 1000);
    let mut out = Vec::new();
    if let Some(workflow_id) = workflow_id {
        let mut stmt = conn.prepare(
            "select id, workflow_id, subagent_id, ts, type, payload_json from agent_events where workflow_id=?1 order by id desc limit ?2",
        )?;
        let rows = stmt.query_map(params![workflow_id, limit], event_from_row)?;
        for row in rows {
            out.push(row?);
        }
    } else {
        let mut stmt = conn.prepare(
            "select id, workflow_id, subagent_id, ts, type, payload_json from agent_events order by id desc limit ?1",
        )?;
        let rows = stmt.query_map(params![limit], event_from_row)?;
        for row in rows {
            out.push(row?);
        }
    }
    out.reverse();
    Ok(out)
}

fn tail_events(
    conn: &Connection,
    workflow_id: Option<&str>,
    since: i64,
    limit: i64,
) -> Result<Vec<EventRecord>> {
    let limit = limit.clamp(1, 1000);
    let mut out = Vec::new();
    if let Some(workflow_id) = workflow_id {
        let mut stmt = conn.prepare(
            "select id, workflow_id, subagent_id, ts, type, payload_json from agent_events where workflow_id=?1 and id>?2 order by id asc limit ?3",
        )?;
        let rows = stmt.query_map(params![workflow_id, since, limit], event_from_row)?;
        for row in rows {
            out.push(row?);
        }
    } else {
        let mut stmt = conn.prepare(
            "select id, workflow_id, subagent_id, ts, type, payload_json from agent_events where id>?1 order by id asc limit ?2",
        )?;
        let rows = stmt.query_map(params![since, limit], event_from_row)?;
        for row in rows {
            out.push(row?);
        }
    }
    Ok(out)
}

fn event_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<EventRecord> {
    let payload_json: String = row.get(5)?;
    Ok(EventRecord {
        id: row.get(0)?,
        workflow_id: row.get(1)?,
        subagent_id: row.get(2)?,
        ts: row.get(3)?,
        event_type: row.get(4)?,
        payload: serde_json::from_str(&payload_json)
            .unwrap_or_else(|_| json!({"raw": payload_json})),
    })
}

fn search(paths: &Paths, conn: &Connection, args: &SearchArgs) -> Result<Vec<SearchHit>> {
    let mut hits = Vec::new();
    let like = format!("%{}%", args.query);
    if args.workflow.is_some() || args.agent.is_some() {
        let mut stmt = conn.prepare("select id, payload_json from agent_events where (?1 is null or workflow_id=?1) and (?2 is null or subagent_id=?2) and payload_json like ?3 order by id desc limit ?4")?;
        let rows = stmt.query_map(
            params![
                args.workflow.as_deref(),
                args.agent.as_deref(),
                like,
                args.limit as i64
            ],
            search_hit_from_row,
        )?;
        for row in rows {
            hits.push(row?);
            if hits.len() >= args.limit {
                return Ok(hits);
            }
        }
        for dir in filtered_artifact_dirs(conn, args)? {
            search_files(&dir, &args.query, args.limit, &mut hits)?;
            if hits.len() >= args.limit {
                return Ok(hits);
            }
        }
        return Ok(hits);
    } else {
        let mut stmt = conn.prepare("select id, payload_json from agent_events where payload_json like ?1 order by id desc limit ?2")?;
        let rows = stmt.query_map(params![like, args.limit as i64], search_hit_from_row)?;
        for row in rows {
            hits.push(row?);
            if hits.len() >= args.limit {
                return Ok(hits);
            }
        }
    }

    search_files(&paths.runs_dir, &args.query, args.limit, &mut hits)?;
    Ok(hits)
}

fn filtered_artifact_dirs(conn: &Connection, args: &SearchArgs) -> Result<Vec<PathBuf>> {
    let mut stmt = conn.prepare(
        "select distinct artifact_dir from subagents where (?1 is null or workflow_id=?1) and (?2 is null or id=?2)",
    )?;
    let rows = stmt.query_map(
        params![args.workflow.as_deref(), args.agent.as_deref()],
        |row| {
            let path: String = row.get(0)?;
            Ok(PathBuf::from(path))
        },
    )?;
    rows.collect::<std::result::Result<Vec<_>, _>>()
        .map_err(Into::into)
}

fn search_hit_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<SearchHit> {
    let id: i64 = row.get(0)?;
    let payload: String = row.get(1)?;
    Ok(SearchHit {
        source: "sqlite".to_string(),
        path: None,
        event_id: Some(id),
        line: None,
        preview: preview(&payload, 240),
    })
}

fn search_files(root: &Path, query: &str, limit: usize, hits: &mut Vec<SearchHit>) -> Result<()> {
    if hits.len() >= limit || !root.exists() {
        return Ok(());
    }
    for entry in fs::read_dir(root)? {
        if hits.len() >= limit {
            break;
        }
        let entry = entry?;
        let path = entry.path();
        if path.is_dir() {
            search_files(&path, query, limit, hits)?;
            continue;
        }
        if !path
            .extension()
            .and_then(|e| e.to_str())
            .is_some_and(|e| matches!(e, "log" | "jsonl" | "md" | "txt"))
        {
            continue;
        }
        let Ok(file) = File::open(&path) else {
            continue;
        };
        for (index, line) in BufReader::new(file).lines().enumerate() {
            let Ok(line) = line else { continue };
            if line.contains(query) {
                hits.push(SearchHit {
                    source: "file".to_string(),
                    path: Some(path.display().to_string()),
                    event_id: None,
                    line: Some(index + 1),
                    preview: preview(&line, 240),
                });
                if hits.len() >= limit {
                    return Ok(());
                }
            }
        }
    }
    Ok(())
}

fn run_daemon_foreground(paths: &Paths, json_output: bool) -> Result<()> {
    ensure_dirs(paths)?;
    if paths.pid_file.exists() {
        let pid_text = fs::read_to_string(&paths.pid_file).unwrap_or_default();
        if let Ok(pid) = pid_text.trim().parse::<u32>() {
            if pid_running(pid) {
                bail!("daemon already running with pid {pid}");
            }
        }
    }
    let _ = fs::remove_file(&paths.stop_file);
    fs::write(&paths.pid_file, std::process::id().to_string())?;
    let mut log = OpenOptions::new()
        .create(true)
        .append(true)
        .open(&paths.daemon_log)?;
    writeln!(
        log,
        "{} daemon started pid={}",
        now_iso(),
        std::process::id()
    )?;
    if json_output {
        print_json(
            &json!({"pid": std::process::id(), "pid_file": paths.pid_file, "log": paths.daemon_log}),
        )?;
    } else {
        println!(
            "symphonyx daemon running pid={} root={}",
            std::process::id(),
            paths.root.display()
        );
    }
    loop {
        if paths.stop_file.exists() {
            writeln!(log, "{} daemon stop requested", now_iso())?;
            let _ = fs::remove_file(&paths.stop_file);
            break;
        }
        thread::sleep(Duration::from_secs(1));
    }
    let _ = fs::remove_file(&paths.pid_file);
    writeln!(log, "{} daemon stopped", now_iso())?;
    Ok(())
}

fn spawn_background_daemon(paths: &Paths) -> Result<()> {
    ensure_dirs(paths)?;
    if let Some(pid) = read_pid(paths) {
        if pid_running(pid) {
            return Ok(());
        }
    }
    let exe = std::env::current_exe()?;
    let log = OpenOptions::new()
        .create(true)
        .append(true)
        .open(&paths.daemon_log)?;
    let err = log.try_clone()?;
    let mut cmd = Command::new(exe);
    cmd.arg("--root")
        .arg(&paths.root)
        .arg("--db")
        .arg(&paths.db)
        .arg("up")
        .arg("--foreground")
        .stdout(Stdio::from(log))
        .stderr(Stdio::from(err));
    set_child_process_group(&mut cmd);
    cmd.spawn().context("spawn symphonyx daemon")?;
    Ok(())
}

fn ensure_daemon_running(paths: &Paths) -> Result<()> {
    if daemon_status(paths).running {
        return Ok(());
    }
    spawn_background_daemon(paths)?;
    wait_for_daemon(paths, Duration::from_secs(5))
}

fn wait_for_daemon(paths: &Paths, timeout: Duration) -> Result<()> {
    let started = SystemTime::now();
    loop {
        if daemon_status(paths).running {
            return Ok(());
        }
        if started.elapsed().unwrap_or_default() >= timeout {
            bail!(
                "symphonyx daemon did not start within {}s; see {}",
                timeout.as_secs(),
                paths.daemon_log.display()
            );
        }
        thread::sleep(Duration::from_millis(100));
    }
}

fn daemon_status(paths: &Paths) -> DaemonStatus {
    let mut pid = read_pid(paths);
    let running = pid.is_some_and(pid_running);
    if pid.is_some() && !running {
        let _ = fs::remove_file(&paths.pid_file);
        pid = None;
    }
    DaemonStatus {
        running,
        pid,
        pid_file: paths.pid_file.clone(),
    }
}

fn read_pid(paths: &Paths) -> Option<u32> {
    fs::read_to_string(&paths.pid_file)
        .ok()?
        .trim()
        .parse()
        .ok()
}

fn pid_running(pid: u32) -> bool {
    Command::new("kill")
        .arg("-0")
        .arg(pid.to_string())
        .status()
        .map(|status| status.success())
        .unwrap_or(false)
}

fn print_status(status: &StatusOutput) {
    println!(
        "daemon: {}{}",
        if status.daemon.running {
            "running"
        } else {
            "stopped"
        },
        status
            .daemon
            .pid
            .map(|pid| format!(" pid={pid}"))
            .unwrap_or_default()
    );
    println!(
        "workflows: {} | sessions: {} | agents done/running/blocked/failed: {}/{}/{}/{} | questions: {}",
        status.counts.workflows,
        status.counts.external_sessions,
        status.counts.agents_done,
        status.counts.agents_running,
        status.counts.agents_blocked,
        status.counts.agents_failed,
        status.counts.questions_open,
    );
    for workflow in &status.workflows {
        println!(
            "wf {:<24} {:<10} {}",
            workflow.id,
            workflow.status,
            workflow.title.clone().unwrap_or_default()
        );
    }
    for agent in &status.agents {
        println!(
            "agent {:<21} {:<10} {:<18} {}",
            agent.id,
            agent.status,
            agent.tool_profile,
            agent.summary.clone().unwrap_or_default()
        );
    }
    for action in &status.recommended_actions {
        println!("next: {action}");
    }
}

fn print_json<T: Serialize>(data: &T) -> Result<()> {
    let envelope = Envelope {
        ok: true,
        data: Some(data),
        error: None,
    };
    println!("{}", serde_json::to_string_pretty(&envelope)?);
    Ok(())
}

fn print_output(json_mode: bool, data: Value, human: &str) -> Result<()> {
    if json_mode {
        print_json(&data)
    } else {
        println!("{human}");
        Ok(())
    }
}

fn compact_json(value: &Value, max: usize) -> String {
    preview(&value.to_string(), max)
}

fn preview(text: &str, max: usize) -> String {
    let normalized = text.replace('\n', " ");
    if normalized.chars().count() <= max {
        return normalized;
    }
    let take = max.saturating_sub(1);
    let truncated = normalized.chars().take(take).collect::<String>();
    format!("{truncated}…")
}

fn now_iso() -> String {
    let duration = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default();
    format!("{}.{:03}Z", duration.as_secs(), duration.subsec_millis())
}

fn new_id(prefix: &str) -> String {
    let duration = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default();
    let sequence = ID_COUNTER.fetch_add(1, Ordering::Relaxed);
    format!(
        "{prefix}_{}_{:x}_{sequence:x}",
        duration.as_millis(),
        std::process::id()
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn init_schema_creates_tables() {
        let dir = tempdir().unwrap();
        let paths = Paths::new(dir.path().join("symx"), None).unwrap();
        ensure_dirs(&paths).unwrap();
        let conn = open_db(&paths).unwrap();
        init_schema(&conn).unwrap();
        let tables: i64 = conn
            .query_row(
                "select count(*) from sqlite_master where type='table' and name='workflow_runs'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(tables, 1);
    }

    #[test]
    fn tool_profiles_are_enforced() {
        assert_eq!(
            ToolProfile::from_name("reviewer-readonly")
                .unwrap()
                .tools_csv(),
            "read,grep,find,ls"
        );
        assert_eq!(
            ToolProfile::from_name("implementer-ts")
                .unwrap()
                .tools_csv(),
            "read,bash,edit,write"
        );
        assert!(ToolProfile::from_name("provider-eval").is_err());
    }

    #[test]
    fn status_is_empty_after_init() {
        let dir = tempdir().unwrap();
        let paths = Paths::new(dir.path().join("symx"), None).unwrap();
        ensure_dirs(&paths).unwrap();
        let conn = open_db(&paths).unwrap();
        init_schema(&conn).unwrap();
        let status = status_output(&paths, &conn).unwrap();
        assert_eq!(status.counts.workflows, 0);
        assert!(!status.daemon.running);

        let mut snapshot = serde_json::to_value(&status).unwrap();
        snapshot["daemon"]["pid_file"] = json!("[pid-file]");
        snapshot["refreshed"] = json!("[refreshed]");
        insta::assert_json_snapshot!("status_empty", snapshot);
    }

    #[test]
    fn dry_run_codex_runner_snapshot() {
        let dir = tempdir().unwrap();
        let paths = Paths::new(dir.path().join("symx"), None).unwrap();
        ensure_dirs(&paths).unwrap();
        let conn = open_db(&paths).unwrap();
        init_schema(&conn).unwrap();

        let prompt_path = dir.path().join("prompt.md");
        fs::write(&prompt_path, "Review this placeholder task.").unwrap();
        let output = run_agent(
            &paths,
            &conn,
            RunArgs {
                title: Some("snapshot dry run".to_string()),
                objective: Some("verify codex runner dry-run event shape".to_string()),
                prompt: prompt_path,
                tool_profile: "reviewer-readonly".to_string(),
                runner: "codex-app-server".to_string(),
                persona: Some("rubber duck".to_string()),
                role: Some("reviewer".to_string()),
                model: Some("gpt-test".to_string()),
                context_mode: "prompt-only".to_string(),
                json: true,
                dry_run: true,
                file_logs: false,
                timeout_seconds: 900,
            },
        )
        .unwrap();

        let mut output_snapshot = serde_json::to_value(&output).unwrap();
        output_snapshot["workflow_id"] = json!("[workflow-id]");
        output_snapshot["subagent_id"] = json!("[agent-id]");
        output_snapshot["artifact_dir"] = json!("[artifact-dir]");
        if !output_snapshot["events_path"].is_null() {
            output_snapshot["events_path"] = json!("[events-path]");
        }
        if !output_snapshot["transcript_path"].is_null() {
            output_snapshot["transcript_path"] = json!("[transcript-path]");
        }
        insta::assert_json_snapshot!("dry_run_output", output_snapshot);

        let events = tail_events(&conn, Some(&output.workflow_id), 0, 10).unwrap();
        let mut events_snapshot = serde_json::to_value(&events).unwrap();
        for event in events_snapshot.as_array_mut().unwrap() {
            event["workflow_id"] = json!("[workflow-id]");
            if !event["subagent_id"].is_null() {
                event["subagent_id"] = json!("[agent-id]");
            }
            event["ts"] = json!("[ts]");
            if let Some(payload) = event.get_mut("payload") {
                if payload.get("prompt_path").is_some() {
                    payload["prompt_path"] = json!("[prompt-path]");
                }
            }
        }
        insta::assert_json_snapshot!("dry_run_codex_runner_events", events_snapshot);
    }

    #[test]
    fn init_schema_rejects_mismatched_version() {
        let dir = tempdir().unwrap();
        let paths = Paths::new(dir.path().join("symx"), None).unwrap();
        ensure_dirs(&paths).unwrap();
        let conn = open_db(&paths).unwrap();
        conn.execute_batch(
            "create table schema_meta(key text primary key, value text not null);
             insert into schema_meta(key, value) values ('schema_version', '999');",
        )
        .unwrap();

        let err = init_schema(&conn).unwrap_err().to_string();
        assert!(err.contains("unsupported schema version 999"));
    }

    #[test]
    fn search_filter_scopes_file_hits() {
        let dir = tempdir().unwrap();
        let paths = Paths::new(dir.path().join("symx"), None).unwrap();
        ensure_dirs(&paths).unwrap();
        let conn = open_db(&paths).unwrap();
        init_schema(&conn).unwrap();
        let now = now_iso();

        let wf_a = "wf_a";
        let wf_b = "wf_b";
        let agent_a = "agent_a";
        let agent_b = "agent_b";
        let dir_a = paths.runs_dir.join(wf_a).join(agent_a);
        let dir_b = paths.runs_dir.join(wf_b).join(agent_b);
        fs::create_dir_all(&dir_a).unwrap();
        fs::create_dir_all(&dir_b).unwrap();
        fs::write(dir_a.join("prompt.md"), "alpha only").unwrap();
        fs::write(dir_b.join("prompt.md"), "needle only in beta workflow").unwrap();

        for wf in [wf_a, wf_b] {
            conn.execute(
                "insert into workflow_runs(id, created_at, updated_at, status, workdir, config_json) values (?1, ?2, ?2, 'done', '/tmp', '{}')",
                params![wf, now],
            )
            .unwrap();
        }
        for (wf, agent, artifact_dir) in [(wf_a, agent_a, &dir_a), (wf_b, agent_b, &dir_b)] {
            conn.execute(
                "insert into subagents(id, workflow_id, created_at, updated_at, status, role, tool_profile, context_mode, runner_kind, artifact_dir) values (?1, ?2, ?3, ?3, 'done', 'worker', 'reviewer-readonly', 'prompt-only', 'pi-rpc', ?4)",
                params![agent, wf, now, artifact_dir.display().to_string()],
            )
            .unwrap();
        }

        let scoped = search(
            &paths,
            &conn,
            &SearchArgs {
                query: "needle".to_string(),
                workflow: Some(wf_a.to_string()),
                agent: None,
                limit: 10,
                json: true,
            },
        )
        .unwrap();
        assert!(
            scoped.is_empty(),
            "filtered search leaked unrelated file hit: {scoped:?}"
        );

        let unscoped = search(
            &paths,
            &conn,
            &SearchArgs {
                query: "needle".to_string(),
                workflow: None,
                agent: None,
                limit: 10,
                json: true,
            },
        )
        .unwrap();
        assert_eq!(unscoped.len(), 1);
        assert_eq!(unscoped[0].source, "file");
    }

    #[cfg(unix)]
    #[test]
    fn codex_app_server_failure_finalizes() {
        use std::os::unix::fs::PermissionsExt;

        let dir = tempdir().unwrap();
        let fake_codex = dir.path().join("fake-codex.sh");
        fs::write(
            &fake_codex,
            "#!/bin/sh\nread _line\nprintf '%s\\n' '{\"id\":1,\"result\":{\"userAgent\":\"fake\",\"codexHome\":\"/tmp\",\"platformFamily\":\"unix\",\"platformOs\":\"test\"}}'\nexit 0\n",
        )
        .unwrap();
        let mut perms = fs::metadata(&fake_codex).unwrap().permissions();
        perms.set_mode(0o755);
        fs::set_permissions(&fake_codex, perms).unwrap();

        let old_codex_bin = std::env::var_os("SYMPHONYX_CODEX_BIN");
        std::env::set_var("SYMPHONYX_CODEX_BIN", &fake_codex);

        let paths = Paths::new(dir.path().join("symx"), None).unwrap();
        ensure_dirs(&paths).unwrap();
        let conn = open_db(&paths).unwrap();
        init_schema(&conn).unwrap();
        let prompt_path = dir.path().join("prompt.md");
        fs::write(&prompt_path, "Trigger failure finalization.").unwrap();
        let result = run_agent(
            &paths,
            &conn,
            RunArgs {
                title: None,
                objective: None,
                prompt: prompt_path,
                tool_profile: "reviewer-readonly".to_string(),
                runner: "codex-app-server".to_string(),
                persona: None,
                role: None,
                model: None,
                context_mode: "prompt-only".to_string(),
                json: true,
                dry_run: false,
                file_logs: false,
                timeout_seconds: 5,
            },
        );

        if let Some(value) = old_codex_bin {
            std::env::set_var("SYMPHONYX_CODEX_BIN", value);
        } else {
            std::env::remove_var("SYMPHONYX_CODEX_BIN");
        }

        assert!(result.is_err());
        let status = status_output(&paths, &conn).unwrap();
        assert_eq!(status.counts.agents_failed, 1);
        assert_eq!(status.workflows[0].status, "failed");
        assert_eq!(status.agents[0].status, "failed");
    }

    #[test]
    fn file_logs_are_opt_in_for_dry_runs() {
        let dir = tempdir().unwrap();
        let prompt_path = dir.path().join("prompt.md");
        fs::write(&prompt_path, "Dry run task.").unwrap();

        let paths = Paths::new(dir.path().join("no_logs"), None).unwrap();
        ensure_dirs(&paths).unwrap();
        let conn = open_db(&paths).unwrap();
        init_schema(&conn).unwrap();
        let output = run_agent(
            &paths,
            &conn,
            RunArgs {
                title: None,
                objective: None,
                prompt: prompt_path.clone(),
                tool_profile: "reviewer-readonly".to_string(),
                runner: "codex-app-server".to_string(),
                persona: None,
                role: None,
                model: None,
                context_mode: "prompt-only".to_string(),
                json: true,
                dry_run: true,
                file_logs: false,
                timeout_seconds: 900,
            },
        )
        .unwrap();
        assert!(output.events_path.is_none());
        assert!(output.transcript_path.is_none());
        assert!(!Path::new(&output.artifact_dir)
            .join("events.jsonl")
            .exists());

        let paths = Paths::new(dir.path().join("with_logs"), None).unwrap();
        ensure_dirs(&paths).unwrap();
        let conn = open_db(&paths).unwrap();
        init_schema(&conn).unwrap();
        let output = run_agent(
            &paths,
            &conn,
            RunArgs {
                title: None,
                objective: None,
                prompt: prompt_path,
                tool_profile: "reviewer-readonly".to_string(),
                runner: "codex-app-server".to_string(),
                persona: None,
                role: None,
                model: None,
                context_mode: "prompt-only".to_string(),
                json: true,
                dry_run: true,
                file_logs: true,
                timeout_seconds: 900,
            },
        )
        .unwrap();
        assert!(output.events_path.is_some());
        assert!(output.transcript_path.is_some());
        assert!(Path::new(&output.artifact_dir)
            .join("events.jsonl")
            .exists());
        assert!(Path::new(&output.artifact_dir)
            .join("transcript.jsonl")
            .exists());
    }
    #[test]
    fn spike_command_persists_workflow_agents_session_events() {
        let dir = tempdir().unwrap();
        let paths = Paths::new(dir.path().join("symx"), None).unwrap();
        ensure_dirs(&paths).unwrap();
        let conn = open_db(&paths).unwrap();
        init_schema(&conn).unwrap();

        let task_list = dir.path().join("tasks.txt");
        fs::write(
            &task_list,
            "# header comment\n\nFirst task for done worker\nSecond task for blocked worker\n",
        )
        .unwrap();

        let output = run_spike(
            &paths,
            &conn,
            SpikeArgs {
                task_list: task_list.clone(),
                json: true,
            },
        )
        .unwrap();

        assert_eq!(output.status.counts.workflows, 1);
        assert_eq!(output.status.counts.agents_done, 1);
        assert_eq!(output.status.counts.agents_blocked, 1);
        assert_eq!(output.status.counts.agents_failed, 1);
        assert_eq!(output.status.counts.external_sessions, 1);
        assert_eq!(output.status.agents.len(), 3);

        let statuses: Vec<String> = output
            .status
            .agents
            .iter()
            .map(|a| a.status.clone())
            .collect();
        assert!(statuses.contains(&"done".to_string()));
        assert!(statuses.contains(&"blocked".to_string()));
        assert!(statuses.contains(&"failed".to_string()));

        let events = tail_events(&conn, Some(&output.workflow_id), 0, 100).unwrap();
        let types: Vec<String> = events.iter().map(|e| e.event_type.clone()).collect();
        assert!(
            types.contains(&"agent.crash_simulated".to_string()),
            "missing agent.crash_simulated in {:?}",
            types
        );
        assert!(
            types.contains(&"session.observed".to_string()),
            "missing session.observed in {:?}",
            types
        );

        let session: i64 = conn
            .query_row(
                "select count(*) from external_sessions where provider='symphonyx-spike'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(session, 1);

        let artifact_rows: i64 = conn
            .query_row(
                "select count(*) from artifacts where kind='text' and role='prompt'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(artifact_rows, 3);

        fs::write(&task_list, "only one task\n").unwrap();
        let err = run_spike(
            &paths,
            &conn,
            SpikeArgs {
                task_list,
                json: true,
            },
        )
        .unwrap_err()
        .to_string();
        assert!(err.contains("at least two tasks"));
    }
    fn insert_test_agent(
        conn: &Connection,
        paths: &Paths,
        id: &str,
        workflow_id: &str,
        status: &str,
        dry_run: bool,
    ) -> PathBuf {
        let now = now_iso();
        let artifact_dir = paths.runs_dir.join(workflow_id).join(id);
        fs::create_dir_all(&artifact_dir).unwrap();
        conn.execute(
            "insert into workflow_runs(id, created_at, updated_at, status, workdir, config_json) values (?1, ?2, ?2, 'done', '/tmp', '{}')",
            params![workflow_id, now],
        )
        .unwrap();
        conn.execute(
            "insert into subagents(id, workflow_id, created_at, updated_at, status, role, persona, tool_profile, model, context_mode, runner_kind, dry_run, artifact_dir, summary) values (?1, ?2, ?3, ?3, ?4, 'worker', 'rubber-duck', 'reviewer-readonly', 'gpt-test', 'prompt-only', 'codex-app-server', ?5, ?6, ?4)",
            params![id, workflow_id, now, status, dry_run as i64, artifact_dir.display().to_string()],
        )
        .unwrap();
        artifact_dir
    }

    #[test]
    fn open_target_agent_prefers_session_file_then_artifact_dir() {
        let dir = tempdir().unwrap();
        let paths = Paths::new(dir.path().join("symx"), None).unwrap();
        ensure_dirs(&paths).unwrap();
        let conn = open_db(&paths).unwrap();
        init_schema(&conn).unwrap();

        let artifact_dir = insert_test_agent(
            &conn, &paths, "agent_a", "wf_a", "done", true,
        );
        fs::write(artifact_dir.join("prompt.md"), "task").unwrap();

        // No session_file: resolves to artifact_dir.
        let out = open_target(
            &paths,
            &conn,
            &OpenArgs {
                target: OpenTarget::Agent {
                    id: "agent_a".to_string(),
                    json: true,
                },
            },
        )
        .unwrap();
        assert_eq!(out.kind, "agent");
        assert_eq!(out.id, "agent_a");
        assert_eq!(out.target, artifact_dir.display().to_string());
        assert!(!out.opened);

        // With session_file present: resolves to session_file.
        let session_file = dir.path().join("session_a.json");
        fs::write(&session_file, "{}").unwrap();
        conn.execute(
            "update subagents set session_file=?1 where id='agent_a'",
            [session_file.display().to_string()],
        )
        .unwrap();
        let out = open_target(
            &paths,
            &conn,
            &OpenArgs {
                target: OpenTarget::Agent {
                    id: "agent_a".to_string(),
                    json: true,
                },
            },
        )
        .unwrap();
        assert_eq!(out.target, session_file.display().to_string());
    }

    #[test]
    fn open_target_session_prefers_session_file_then_cwd() {
        let dir = tempdir().unwrap();
        let paths = Paths::new(dir.path().join("symx"), None).unwrap();
        ensure_dirs(&paths).unwrap();
        let conn = open_db(&paths).unwrap();
        init_schema(&conn).unwrap();

        let cwd = dir.path().join("session_cwd");
        fs::create_dir_all(&cwd).unwrap();
        conn.execute(
            "insert into external_sessions(id, provider, status, title, cwd, session_file, updated_at, meta_json) values (?1, 'codex', 'done', 'test', ?2, null, ?3, '{}')",
            params!["sess_1", cwd.display().to_string(), now_iso()],
        )
        .unwrap();

        let out = open_target(
            &paths,
            &conn,
            &OpenArgs {
                target: OpenTarget::Session {
                    provider: "codex".to_string(),
                    id: "sess_1".to_string(),
                    json: true,
                },
            },
        )
        .unwrap();
        assert_eq!(out.kind, "session");
        assert_eq!(out.target, cwd.display().to_string());

        let session_file = dir.path().join("sess_1.json");
        fs::write(&session_file, "{}").unwrap();
        conn.execute(
            "update external_sessions set session_file=?1 where provider='codex' and id='sess_1'",
            [session_file.display().to_string()],
        )
        .unwrap();
        let out = open_target(
            &paths,
            &conn,
            &OpenArgs {
                target: OpenTarget::Session {
                    provider: "codex".to_string(),
                    id: "sess_1".to_string(),
                    json: true,
                },
            },
        )
        .unwrap();
        assert_eq!(out.target, session_file.display().to_string());
    }

    #[test]
    fn restart_rejects_non_terminal_statuses() {
        let dir = tempdir().unwrap();
        let paths = Paths::new(dir.path().join("symx"), None).unwrap();
        ensure_dirs(&paths).unwrap();
        let conn = open_db(&paths).unwrap();
        init_schema(&conn).unwrap();

        for status in ["planned", "starting", "running", "idle"] {
            let agent_id = format!("agent_{status}");
            let wf_id = format!("wf_{status}");
            let artifact_dir = insert_test_agent(
                &conn, &paths, &agent_id, &wf_id, status, true,
            );
            fs::write(artifact_dir.join("prompt.md"), "task").unwrap();

            let err = restart_agent(
                &paths,
                &conn,
                &RestartArgs {
                    agent: agent_id,
                    json: true,
                },
            )
            .unwrap_err()
            .to_string();
            assert!(
                err.contains("cannot restart") && err.contains(status),
                "expected rejection for {status}, got: {err}"
            );
        }
    }

    #[test]
    fn restart_creates_new_run_for_terminal_dry_run_agent() {
        let dir = tempdir().unwrap();
        let paths = Paths::new(dir.path().join("symx"), None).unwrap();
        ensure_dirs(&paths).unwrap();
        let conn = open_db(&paths).unwrap();
        init_schema(&conn).unwrap();

        let agent_id = "agent_done";
        let wf_id = "wf_done";
        let artifact_dir = insert_test_agent(
            &conn, &paths, agent_id, wf_id, "done", true,
        );
        fs::write(artifact_dir.join("prompt.md"), "original task").unwrap();

        let output = restart_agent(
            &paths,
            &conn,
            &RestartArgs {
                agent: agent_id.to_string(),
                json: true,
            },
        )
        .unwrap();

        assert_eq!(output.source_agent_id, agent_id);
        assert_ne!(output.run.subagent_id, agent_id);
        assert_eq!(output.run.status, "done");
        assert!(output.run.dry_run);
        assert!(
            Path::new(&output.run.artifact_dir).join("prompt.md").exists(),
            "new prompt artifact should be copied"
        );

        let restarted_count: i64 = conn
            .query_row(
                "select count(*) from subagents where id=?1",
                [&output.run.subagent_id],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(restarted_count, 1);
    }
}
