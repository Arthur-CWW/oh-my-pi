defmodule SymphonyLiteElixirTest do
  use ExUnit.Case
  import ExUnit.CaptureIO

  alias SymphonyLiteElixir.CLI

  defp tmp_root do
    base = System.tmp_dir!()
    dir = Path.join(base, "symphony-lite-elixir-test-#{:erlang.unique_integer([:positive])}")
    File.mkdir_p!(dir)
    on_exit(fn -> File.rm_rf!(dir) end)
    dir
  end

  defp write_tasks(path, lines) do
    File.write!(path, Enum.join(lines, "\n") <> "\n")
  end

  defp run(argv) do
    output = capture_io(fn -> CLI.main(argv) end)
    :json.decode(output) |> normalize()
  end

  defp normalize(other), do: other

  defp sqlite_count(root, table) do
    db = Path.join(root, "symphony.sqlite")
    {out, 0} = System.cmd("/usr/bin/sqlite3", [db, "SELECT COUNT(*) FROM #{table};"])
    out |> String.trim() |> String.to_integer()
  end

  describe "spike command" do
    test "persists workflow, agents, session, and events" do
      root = tmp_root()
      task_path = Path.join(root, "tasks.txt")
      write_tasks(task_path, ["# header", "", "task alpha", "task beta", "task gamma"])

      result = run(["spike", "--root", root, "--task-list", task_path, "--json"])

      assert result["ok"] == true
      data = result["data"]

      assert data["workflow_id"]
      assert data["done_ids"] == ["agent-1"]
      assert data["blocked_ids"] == ["agent-2"]
      assert data["failed_ids"] == ["agent-3"]

      counts = data["counts"]
      assert counts["workflows"] == 1
      assert counts["done"] == 1
      assert counts["blocked"] == 1
      assert counts["failed"] == 1
      assert counts["external_sessions"] == 1

      assert File.exists?(Path.join([root, "runs", data["workflow_id"], "agent-1", "prompt.md"]))
      assert File.exists?(Path.join([root, "symphony.sqlite"]))
      assert sqlite_count(root, "workflows") == 1
      assert sqlite_count(root, "agents") == 3
      assert sqlite_count(root, "external_sessions") == 1
      assert sqlite_count(root, "events") >= 8

      event_kinds =
        data["previews"]["events"]
        |> Enum.map(&Map.get(&1, "kind"))
        |> Enum.sort()

      assert "agent.crash_simulated" in event_kinds
      assert "agent.planned" in event_kinds
      assert "agent.status" in event_kinds
      assert "session.observed" in event_kinds
      assert "workflow.spike.started" in event_kinds
      assert "workflow.status" in event_kinds
    end

    test "rejects a task list with fewer than two tasks" do
      root = tmp_root()
      task_path = Path.join(root, "tasks.txt")
      write_tasks(task_path, ["only one task"])

      result = run(["spike", "--root", root, "--task-list", task_path, "--json"])

      assert result["ok"] == false
      assert result["error"] =~ "at least two"
    end
  end

  describe "status command" do
    test "reads a persisted ledger" do
      root = tmp_root()
      task_path = Path.join(root, "tasks.txt")
      write_tasks(task_path, ["task one", "task two", "task three"])

      spike = run(["spike", "--root", root, "--task-list", task_path, "--json"])
      assert spike["ok"] == true

      status = run(["status", "--root", root, "--json"])
      assert status["ok"] == true

      counts = status["data"]["counts"]
      assert counts["workflows"] == 1
      assert counts["done"] == 1
      assert counts["blocked"] == 1
      assert counts["failed"] == 1
      assert counts["external_sessions"] == 1
      assert counts["events"] >= 8
    end
  end

  describe "runner command" do
    test "constructs pi-rpc command" do
      result = run(["runner", "--kind", "pi-rpc", "--prompt", "/tmp/prompt.md", "--json"])

      assert result["ok"] == true
      data = result["data"]
      assert data["kind"] == "pi_rpc"
      assert data["command"] == "pi"
      assert "--mode" in data["args"]
      assert "rpc" in data["args"]
      assert "--no-session" in data["args"]
      assert "--prompt-file" in data["args"]
      assert "/tmp/prompt.md" in data["args"]
    end

    test "constructs omp-cli command" do
      result = run(["runner", "--kind", "omp-cli", "--prompt", "/tmp/prompt.md", "--json"])

      assert result["ok"] == true
      data = result["data"]
      assert data["kind"] == "omp_cli"
      assert data["command"] in ["omp", "bin/omp"]
      assert "-p" in data["args"]
      refute "--auto-approve" in data["args"]
      assert "--prompt-file" in data["args"]
    end
  end

  describe "packet ledger commands" do
    test "import -> next -> claim -> paths -> proof add -> status" do
      root = tmp_root()
      task_path = Path.join(root, "tasks.txt")
      write_tasks(task_path, ["# header", "", "task alpha", "task beta", "task gamma"])

      imported = run(["import", "--root", root, "--task-list", task_path, "--json"])
      assert imported["ok"] == true
      assert imported["data"]["count"] == 3
      assert imported["data"]["imported_ids"] == ["packet-1", "packet-2", "packet-3"]

      next1 = run(["next", "--root", root, "--json"])
      assert next1["ok"] == true
      assert next1["data"]["packet"]["id"] == "packet-1"
      assert next1["data"]["packet"]["title"] == "task alpha"
      assert next1["data"]["packet"]["status"] == "open"

      claim =
        run(["claim", "--root", root, "--packet", "packet-1", "--owner", "tester", "--json"])

      assert claim["ok"] == true
      assert claim["data"]["status"] == "claimed"
      assert claim["data"]["owner"] == "tester"

      next2 = run(["next", "--root", root, "--json"])
      assert next2["data"]["packet"]["id"] == "packet-2"

      paths_after_claim = run(["paths", "--root", root, "--packet", "packet-1", "--json"])
      assert paths_after_claim["ok"] == true
      assert paths_after_claim["data"]["id"] == "packet-1"
      assert paths_after_claim["data"]["title"] == "task alpha"
      assert paths_after_claim["data"]["owner_paths"] == ["tester"]
      assert paths_after_claim["data"]["owner_path_count"] == 1

      assert paths_after_claim["data"]["paths"] == %{
               "source_doc" => task_path,
               "proof_folder" => Path.join([root, "proofs", "packet-1"]),
               "artifact_root" => Path.join([root, "artifacts", "packet-1"]),
               "session_link" => Path.join([root, "sessions", "packet-1.json"])
             }

      assert paths_after_claim["data"]["source_doc"] == task_path
      assert paths_after_claim["data"]["proof_folder"] == Path.join([root, "proofs", "packet-1"])

      assert paths_after_claim["data"]["artifact_root"] ==
               Path.join([root, "artifacts", "packet-1"])

      assert paths_after_claim["data"]["session_link"] ==
               Path.join([root, "sessions", "packet-1.json"])

      proof =
        run([
          "proof",
          "add",
          "--root",
          root,
          "--packet",
          "packet-1",
          "--path",
          "proofs/p1/log.json",
          "--kind",
          "test-log",
          "--json"
        ])

      assert proof["ok"] == true
      assert proof["data"]["packet_id"] == "packet-1"
      assert proof["data"]["kind"] == "test-log"
      assert proof["data"]["path"] == "proofs/p1/log.json"
      assert is_integer(proof["data"]["id"])
      assert proof["data"]["id"] > 0
      paths_after_proof = run(["paths", "--root", root, "--packet", "packet-1", "--json"])
      assert paths_after_proof["ok"] == true
      assert paths_after_proof["data"]["owner_paths"] == ["tester"]
      assert paths_after_proof["data"]["proof_count"] == 1

      assert paths_after_proof["data"]["proofs"] == [
               %{
                 "id" => proof["data"]["id"],
                 "kind" => "test-log",
                 "path" => "proofs/p1/log.json"
               }
             ]

      assert sqlite_count(root, "task_packets") == 3
      assert sqlite_count(root, "packet_ownership") == 1
      assert sqlite_count(root, "packet_proofs") == 1
      assert sqlite_count(root, "packet_events") == 5

      status = run(["status", "--root", root, "--json"])
      assert status["ok"] == true
      counts = status["data"]["counts"]
      assert counts["packets"] == 3
      assert counts["packets_open"] == 2
      assert counts["packets_claimed"] == 1
      assert counts["packets_done"] == 0

      packet_events = status["data"]["previews"]["packet_events"]
      kinds = Enum.map(packet_events, &Map.get(&1, "kind"))
      assert "packet.imported" in kinds
      assert "packet.claimed" in kinds
      assert "packet.proof_added" in kinds
    end

    test "claim rejects missing packet" do
      root = tmp_root()
      task_path = Path.join(root, "tasks.txt")
      write_tasks(task_path, ["task one", "task two"])
      run(["import", "--root", root, "--task-list", task_path, "--json"])

      result =
        run(["claim", "--root", root, "--packet", "packet-missing", "--owner", "x", "--json"])

      assert result["ok"] == false
      assert result["error"] == "packet not found"
    end

    test "claim rejects non-open packet" do
      root = tmp_root()
      task_path = Path.join(root, "tasks.txt")
      write_tasks(task_path, ["task one", "task two"])
      run(["import", "--root", root, "--task-list", task_path, "--json"])
      run(["claim", "--root", root, "--packet", "packet-1", "--owner", "x", "--json"])

      result = run(["claim", "--root", root, "--packet", "packet-1", "--owner", "y", "--json"])
      assert result["ok"] == false
      assert result["error"] == "packet not open"
    end

    test "proof add returns a positive proof id" do
      root = tmp_root()
      task_path = Path.join(root, "tasks.txt")
      write_tasks(task_path, ["task one", "task two"])
      run(["import", "--root", root, "--task-list", task_path, "--json"])

      proof =
        run([
          "proof",
          "add",
          "--root",
          root,
          "--packet",
          "packet-1",
          "--path",
          "proofs/p1/note.json",
          "--kind",
          "note",
          "--json"
        ])

      assert proof["ok"] == true
      assert is_integer(proof["data"]["id"])
      assert proof["data"]["id"] > 0
    end

    test "paths keeps proof preview bounded with total count" do
      root = tmp_root()
      task_path = Path.join(root, "tasks.txt")
      write_tasks(task_path, ["task one", "task two"])
      run(["import", "--root", root, "--task-list", task_path, "--json"])

      for index <- 1..6 do
        proof =
          run([
            "proof",
            "add",
            "--root",
            root,
            "--packet",
            "packet-1",
            "--path",
            "proofs/p1/#{index}.json",
            "--kind",
            "note",
            "--json"
          ])

        assert proof["ok"] == true
      end

      paths = run(["paths", "--root", root, "--packet", "packet-1", "--json"])

      assert paths["ok"] == true
      assert paths["data"]["proof_count"] == 6
      assert length(paths["data"]["proofs"]) == 5

      assert Enum.map(paths["data"]["proofs"], &Map.get(&1, "path")) == [
               "proofs/p1/1.json",
               "proofs/p1/2.json",
               "proofs/p1/3.json",
               "proofs/p1/4.json",
               "proofs/p1/5.json"
             ]
    end

    test "import does not reuse packet ids after deletion" do
      root = tmp_root()
      task_path = Path.join(root, "tasks.txt")
      write_tasks(task_path, ["task a", "task b", "task c"])

      first = run(["import", "--root", root, "--task-list", task_path, "--json"])
      assert first["ok"] == true
      assert first["data"]["imported_ids"] == ["packet-1", "packet-2", "packet-3"]

      db = Path.join(root, "symphony.sqlite")

      {_, 0} =
        System.cmd("/usr/bin/sqlite3", [db, "DELETE FROM task_packets WHERE id = 'packet-2';"])

      other_path = Path.join(root, "other.txt")
      write_tasks(other_path, ["task d", "task e"])

      second = run(["import", "--root", root, "--task-list", other_path, "--json"])
      assert second["ok"] == true
      refute "packet-2" in second["data"]["imported_ids"]
      assert second["data"]["imported_ids"] == ["packet-4", "packet-5"]
    end
  end
end
