defmodule SymphonyLiteElixir.Ledger do
  @moduledoc """
  SQLite ledger backed by /usr/bin/sqlite3 via System.cmd/3.

  No external Hex dependencies. Schema is created on first use. All IDs,
  statuses, and event kinds are controlled local text; strings are SQL-escaped
  by doubling single quotes before being interpolated into statements.
  """

  @sqlite "/usr/bin/sqlite3"
  @paths_preview_limit 5

  @schema ~S"""
  CREATE TABLE IF NOT EXISTS workflows (
    id TEXT PRIMARY KEY,
    status TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS agents (
    id TEXT PRIMARY KEY,
    workflow_id TEXT NOT NULL,
    status TEXT NOT NULL,
    kind TEXT NOT NULL,
    prompt_path TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS external_sessions (
    id TEXT PRIMARY KEY,
    workflow_id TEXT NOT NULL,
    agent_id TEXT,
    kind TEXT NOT NULL,
    handle TEXT,
    observed_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    workflow_id TEXT NOT NULL,
    agent_id TEXT,
    session_id TEXT,
    kind TEXT NOT NULL,
    payload TEXT,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS task_packets (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    status TEXT NOT NULL,
    source_path TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS packet_ownership (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    packet_id TEXT NOT NULL,
    owner TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS packet_proofs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    packet_id TEXT NOT NULL,
    kind TEXT NOT NULL,
    path TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS packet_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    packet_id TEXT NOT NULL,
    kind TEXT NOT NULL,
    payload TEXT,
    created_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_agents_workflow ON agents(workflow_id);
  CREATE INDEX IF NOT EXISTS idx_events_workflow ON events(workflow_id);
  CREATE INDEX IF NOT EXISTS idx_events_agent ON events(agent_id);
  CREATE INDEX IF NOT EXISTS idx_sessions_workflow ON external_sessions(workflow_id);
  CREATE INDEX IF NOT EXISTS idx_task_packets_status ON task_packets(status);
  CREATE INDEX IF NOT EXISTS idx_packet_ownership_packet ON packet_ownership(packet_id);
  CREATE INDEX IF NOT EXISTS idx_packet_proofs_packet ON packet_proofs(packet_id);
  CREATE INDEX IF NOT EXISTS idx_packet_events_packet ON packet_events(packet_id);
  """

  @doc "Ensure the ledger database and schema exist under root."
  def init_db(root) do
    File.mkdir_p!(root)
    exec_script(root, @schema)
  end

  @doc "Insert a workflow row."
  def create_workflow(root, id, status) do
    now = now()

    exec(
      root,
      "INSERT INTO workflows (id, status, created_at, updated_at) VALUES " <>
        "('#{sql_str(id)}', '#{sql_str(status)}', '#{now}', '#{now}');"
    )
  end

  @doc "Insert an agent row."
  def create_agent(root, workflow_id, id, status, kind, prompt_path) do
    now = now()

    exec(
      root,
      "INSERT INTO agents (id, workflow_id, status, kind, prompt_path, created_at, updated_at) VALUES " <>
        "('#{sql_str(id)}', '#{sql_str(workflow_id)}', '#{sql_str(status)}', '#{sql_str(kind)}', " <>
        "#{sql_nullable(prompt_path)}, '#{now}', '#{now}');"
    )
  end

  @doc "Insert an external session row."
  def create_session(root, workflow_id, agent_id, id, kind, handle) do
    now = now()

    exec(
      root,
      "INSERT INTO external_sessions (id, workflow_id, agent_id, kind, handle, observed_at) VALUES " <>
        "('#{sql_str(id)}', '#{sql_str(workflow_id)}', #{sql_nullable(agent_id)}, " <>
        "'#{sql_str(kind)}', #{sql_nullable(handle)}, '#{now}');"
    )
  end

  @doc "Insert an event row."
  def create_event(root, attrs) do
    workflow_id = Map.fetch!(attrs, :workflow_id)
    agent_id = Map.get(attrs, :agent_id)
    session_id = Map.get(attrs, :session_id)
    kind = Map.fetch!(attrs, :kind)
    payload = Map.get(attrs, :payload) |> encode_payload()
    now = now()

    exec(
      root,
      "INSERT INTO events (workflow_id, agent_id, session_id, kind, payload, created_at) VALUES " <>
        "('#{sql_str(workflow_id)}', #{sql_nullable(agent_id)}, #{sql_nullable(session_id)}, " <>
        "'#{sql_str(kind)}', #{sql_nullable(payload)}, '#{now}');"
    )
  end

  @doc "Import task lines as packet rows, returning inserted IDs."
  def import_packets(root, source_path, titles) do
    init_db(root)
    base = max_packet_suffix(root)

    {statements, ids} =
      titles
      |> Enum.with_index()
      |> Enum.reduce({[], []}, fn {title, index}, {acc_stmts, acc_ids} ->
        id = "packet-#{base + index + 1}"

        case query(root, "SELECT id FROM task_packets WHERE id = '#{sql_str(id)}';") do
          [] ->
            ts = now()

            insert =
              "INSERT INTO task_packets (id, title, status, source_path, created_at, updated_at) VALUES " <>
                "('#{sql_str(id)}', '#{sql_str(title)}', 'open', '#{sql_str(source_path)}', '#{ts}', '#{ts}');"

            event =
              packet_event_sql(
                id,
                "packet.imported",
                %{source_path: source_path, title: title},
                ts
              )

            {[event, insert | acc_stmts], [id | acc_ids]}

          _ ->
            {acc_stmts, acc_ids}
        end
      end)

    if statements != [] do
      exec_transaction(root, Enum.reverse(statements))
    end

    Enum.reverse(ids)
  end

  defp max_packet_suffix(root) do
    root
    |> query("SELECT id FROM task_packets WHERE id LIKE 'packet-%';")
    |> Enum.reduce(0, fn %{"id" => id}, acc ->
      case Regex.run(~r/^packet-(\d+)$/, id) do
        [_, digits] -> max(acc, String.to_integer(digits))
        _ -> acc
      end
    end)
  end

  @doc "Return the first open packet, or nil."
  def next_packet(root) do
    init_db(root)

    case query(
           root,
           "SELECT id, title, status, source_path, created_at FROM task_packets " <>
             "WHERE status = 'open' ORDER BY created_at ASC, id ASC LIMIT 1;"
         ) do
      [] -> nil
      [row] -> row
    end
  end

  @doc "Claim an open packet for an owner."
  def claim_packet(root, packet_id, owner) do
    init_db(root)
    ts = now()
    escaped_id = sql_str(packet_id)
    escaped_owner = sql_str(owner)
    payload_json = sql_str(encode_payload(%{owner: owner}))

    script = """
    BEGIN;
    UPDATE task_packets SET status = 'claimed', updated_at = '#{ts}' WHERE id = '#{escaped_id}' AND status = 'open';
    CREATE TEMP TABLE _claim_check AS SELECT changes() AS n;
    INSERT INTO packet_ownership (packet_id, owner, created_at)
      SELECT '#{escaped_id}', '#{escaped_owner}', '#{ts}' FROM _claim_check WHERE n = 1;
    INSERT INTO packet_events (packet_id, kind, payload, created_at)
      SELECT '#{escaped_id}', 'packet.claimed', '#{payload_json}', '#{ts}' FROM _claim_check WHERE n = 1;
    DROP TABLE _claim_check;
    COMMIT;
    """

    exec_script(root, script)

    case query(root, "SELECT id FROM task_packets WHERE id = '#{escaped_id}';") do
      [] ->
        {:error, "packet not found"}

      _ ->
        case query(
               root,
               "SELECT id FROM packet_events WHERE packet_id = '#{escaped_id}' " <>
                 "AND kind = 'packet.claimed' AND created_at = '#{ts}' LIMIT 1;"
             ) do
          [] -> {:error, "packet not open"}
          [_] -> :ok
        end
    end
  end

  @doc "Return packet id/title/source plus bounded canonical owner, proof, artifact, and session path hints."
  def packet_paths(root, packet_id) do
    init_db(root)
    escaped_id = sql_str(packet_id)

    case query(
           root,
           "SELECT id, title, source_path FROM task_packets WHERE id = '#{escaped_id}';"
         ) do
      [] ->
        {:error, "packet not found"}

      [row] ->
        packet_id = Map.fetch!(row, "id")
        owner_path_count = count_where(root, "packet_ownership", "packet_id", packet_id)
        proof_count = count_where(root, "packet_proofs", "packet_id", packet_id)
        canonical_paths = canonical_packet_paths(root, row)

        owner_paths =
          query(
            root,
            "SELECT owner FROM packet_ownership WHERE packet_id = '#{escaped_id}' " <>
              "ORDER BY id ASC LIMIT #{@paths_preview_limit};"
          )
          |> Enum.map(&Map.get(&1, "owner"))

        proofs =
          query(
            root,
            "SELECT id, kind, path FROM packet_proofs WHERE packet_id = '#{escaped_id}' " <>
              "ORDER BY id ASC LIMIT #{@paths_preview_limit};"
          )

        {:ok,
         row
         |> Map.merge(canonical_paths)
         |> Map.merge(%{
           "paths" => canonical_paths,
           "owner_path_count" => owner_path_count,
           "owner_paths" => owner_paths,
           "proof_count" => proof_count,
           "proofs" => proofs
         })}
    end
  end

  defp canonical_packet_paths(root, %{"id" => packet_id, "source_path" => source_path}) do
    %{
      "source_doc" => source_path,
      "proof_folder" => Path.join([root, "proofs", packet_id]),
      "artifact_root" => Path.join([root, "artifacts", packet_id]),
      "session_link" => Path.join([root, "sessions", "#{packet_id}.json"])
    }
  end

  @doc "Add a proof row for a packet."
  def add_proof(root, packet_id, kind, path) do
    init_db(root)

    case query(root, "SELECT id FROM task_packets WHERE id = '#{sql_str(packet_id)}';") do
      [] ->
        {:error, "packet not found"}

      _ ->
        ts = now()

        exec_transaction(root, [
          "INSERT INTO packet_proofs (packet_id, kind, path, created_at) VALUES " <>
            "('#{sql_str(packet_id)}', '#{sql_str(kind)}', '#{sql_str(path)}', '#{ts}');",
          packet_event_sql(packet_id, "packet.proof_added", %{kind: kind, path: path}, ts)
        ])

        proof_id =
          query(
            root,
            "SELECT id FROM packet_proofs WHERE packet_id = '#{sql_str(packet_id)}' " <>
              "AND kind = '#{sql_str(kind)}' AND path = '#{sql_str(path)}' " <>
              "ORDER BY id DESC LIMIT 1;"
          )
          |> List.first(%{})
          |> Map.get("id")

        {:ok, %{"id" => proof_id, "packet_id" => packet_id, "kind" => kind, "path" => path}}
    end
  end

  defp packet_event_sql(packet_id, kind, payload, ts) do
    payload_json = encode_payload(payload)

    "INSERT INTO packet_events (packet_id, kind, payload, created_at) VALUES " <>
      "('#{sql_str(packet_id)}', '#{sql_str(kind)}', #{sql_nullable(payload_json)}, '#{ts}');"
  end

  @doc "Return counts and bounded previews from the ledger."
  def status(root) do
    _ = init_db(root)

    %{
      workflows: count(root, "workflows"),
      agents: %{
        total: count(root, "agents"),
        done: count_where(root, "agents", "status", "done"),
        blocked: count_where(root, "agents", "status", "blocked"),
        failed: count_where(root, "agents", "status", "failed"),
        planned: count_where(root, "agents", "status", "planned")
      },
      packets: %{
        total: count(root, "task_packets"),
        open: count_where(root, "task_packets", "status", "open"),
        claimed: count_where(root, "task_packets", "status", "claimed"),
        done: count_where(root, "task_packets", "status", "done")
      },
      external_sessions: count(root, "external_sessions"),
      events: count(root, "events"),
      previews: %{
        workflows: preview(root, "workflows", ["id", "status", "created_at"]),
        agents: preview(root, "agents", ["id", "workflow_id", "status", "kind"]),
        external_sessions:
          preview(root, "external_sessions", ["id", "workflow_id", "agent_id", "kind", "handle"]),
        events: preview(root, "events", ["id", "workflow_id", "agent_id", "kind"], 10),
        packets: preview(root, "task_packets", ["id", "title", "status"]),
        packet_ownership: preview(root, "packet_ownership", ["id", "packet_id", "owner"]),
        packet_proofs: preview(root, "packet_proofs", ["id", "packet_id", "kind", "path"]),
        packet_events: preview(root, "packet_events", ["id", "packet_id", "kind"], 10)
      }
    }
  end

  defp count(root, table) do
    root
    |> query("SELECT COUNT(*) AS n FROM #{table};")
    |> List.first(%{})
    |> Map.get("n", 0)
  end

  defp count_where(root, table, column, value) do
    root
    |> query("SELECT COUNT(*) AS n FROM #{table} WHERE #{column} = '#{sql_str(value)}';")
    |> List.first(%{})
    |> Map.get("n", 0)
  end

  defp preview(root, table, columns, limit \\ 5) do
    cols = Enum.join(columns, ", ")
    query(root, "SELECT #{cols} FROM #{table} ORDER BY rowid DESC LIMIT #{limit};")
  end

  defp query(root, sql) do
    db = db_path(root)

    case System.cmd(@sqlite, [db, ".mode json", sql], stderr_to_stdout: true) do
      {output, 0} ->
        output
        |> String.trim()
        |> decode_json()

      {output, _} ->
        raise "SQLite query failed: #{sql}\n#{output}"
    end
  end

  defp exec(root, sql) do
    exec_script(root, sql)
  end

  defp exec_script(root, script) do
    db = db_path(root)
    tmp = Path.join(root, ".#{:erlang.unique_integer([:positive])}.sql")

    try do
      File.write!(tmp, script)

      case System.cmd(@sqlite, [db, ".read #{tmp}"], stderr_to_stdout: true) do
        {_output, 0} -> :ok
        {output, _} -> raise "SQLite script failed:\n#{script}\n#{output}"
      end
    after
      File.rm(tmp)
    end
  end

  defp exec_transaction(root, statements) do
    exec_script(root, "BEGIN;\n" <> Enum.join(statements, "\n") <> "\nCOMMIT;")
  end

  defp db_path(root), do: Path.join(root, "symphony.sqlite")

  defp now, do: DateTime.utc_now() |> DateTime.to_iso8601()

  defp sql_str(nil),
    do: raise(ArgumentError, "sql_str/1 received nil; use sql_nullable/1 for NULL")

  defp sql_str(value), do: to_string(value) |> String.replace("'", "''")
  defp sql_nullable(nil), do: "NULL"
  defp sql_nullable(value), do: "'#{sql_str(value)}'"

  defp encode_payload(nil), do: nil
  defp encode_payload(value), do: :json.encode(value) |> IO.iodata_to_binary()

  defp decode_json(""), do: []
  defp decode_json(binary) when is_binary(binary), do: normalize_rows(:json.decode(binary))

  defp normalize_rows(rows) when is_list(rows) do
    Enum.map(rows, &normalize_row/1)
  end

  defp normalize_rows(other), do: [normalize_row(other)]

  defp normalize_row(row) when is_map(row) do
    Map.new(row, fn {k, v} -> {to_string(k), normalize_value(v)} end)
  end

  defp normalize_value(value) when is_binary(value), do: value
  defp normalize_value(value) when is_number(value), do: value
  defp normalize_value(value) when is_boolean(value), do: value
  defp normalize_value(nil), do: nil
  defp normalize_value(:null), do: nil
  defp normalize_value(value), do: :json.encode(value) |> IO.iodata_to_binary()
end
