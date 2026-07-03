defmodule SymphonyLiteElixir.CLI do
  @moduledoc """
  JSON-first CLI for the Symphony Lite Elixir/OTP spike.

  Commands:
    spike      --root <dir> --task-list <path> --json
    import     --root <dir> --task-list <path> --json
    next       --root <dir> --json
    claim      --root <dir> --packet <id> --owner <name> --json
    paths      --root <dir> --packet <id> --json  # bounded canonical path/proof hints
    proof add  --root <dir> --packet <id> --path <proof-path> --kind <kind> --json
    status     --root <dir> --json
    runner     --kind <dry-run|pi-rpc|omp-cli> --prompt <path> --json
  """

  alias SymphonyLiteElixir.{Ledger, Runner, TaskSource}

  def main(argv) do
    argv
    |> OptionParser.parse(
      switches: [
        root: :string,
        task_list: :string,
        json: :boolean,
        kind: :string,
        prompt: :string,
        packet: :string,
        owner: :string,
        path: :string
      ],
      aliases: [r: :root, t: :task_list, k: :kind, p: :prompt]
    )
    |> dispatch()
  end

  defp dispatch({opts, ["proof", "add" | _], []}) do
    run_proof_add(opts)
  end

  defp dispatch({opts, [command | _], []}) do
    case command do
      "spike" -> run_spike(opts)
      "import" -> run_import(opts)
      "next" -> run_next(opts)
      "claim" -> run_claim(opts)
      "paths" -> run_paths(opts)
      "status" -> run_status(opts)
      "runner" -> run_runner(opts)
      _ -> error("unknown command: #{command}")
    end
  end

  defp dispatch({_, _, invalid}) when invalid != [] do
    error("invalid options: #{inspect(invalid)}")
  end

  defp dispatch(_) do
    error(
      "usage: symphony_lite_elixir <spike|import|next|claim|paths|proof add|status|runner> ..."
    )
  end

  defp run_spike(opts) do
    with {:ok, root} <- require_opt(opts, :root),
         {:ok, task_list_path} <- require_opt(opts, :task_list) do
      try do
        tasks = TaskSource.read!(task_list_path)
        workflow_id = "wf-spike-#{System.system_time(:second)}"
        kind = "dry-run"

        agent_plan = [
          %{agent_id: "agent-1", status: "done", task: Enum.at(tasks, 0)},
          %{agent_id: "agent-2", status: "blocked", task: Enum.at(tasks, 1)},
          %{agent_id: "agent-3", status: "failed", task: "synthetic crash task"}
        ]

        Ledger.init_db(root)
        Ledger.create_workflow(root, workflow_id, "blocked")

        for %{agent_id: agent_id, status: status, task: task} <- agent_plan do
          prompt_path = Path.join([root, "runs", workflow_id, agent_id, "prompt.md"])
          File.mkdir_p!(Path.dirname(prompt_path))

          File.write!(prompt_path, task <> "\n")

          Ledger.create_agent(root, workflow_id, agent_id, status, kind, prompt_path)

          Ledger.create_event(root, %{
            workflow_id: workflow_id,
            agent_id: agent_id,
            kind: "agent.planned"
          })

          Ledger.create_event(root, %{
            workflow_id: workflow_id,
            agent_id: agent_id,
            kind: "agent.status",
            payload: %{status: status}
          })
        end

        Ledger.create_session(
          root,
          workflow_id,
          "agent-3",
          "s-crash-1",
          "crash",
          "runs/#{workflow_id}/agent-3"
        )

        Ledger.create_event(root, %{
          workflow_id: workflow_id,
          agent_id: "agent-3",
          kind: "agent.crash_simulated"
        })

        Ledger.create_event(root, %{
          workflow_id: workflow_id,
          session_id: "s-crash-1",
          kind: "session.observed"
        })

        Ledger.create_event(root, %{workflow_id: workflow_id, kind: "workflow.spike.started"})

        Ledger.create_event(root, %{
          workflow_id: workflow_id,
          kind: "workflow.status",
          payload: %{status: "blocked"}
        })

        summary = Ledger.status(root)

        data = %{
          workflow_id: workflow_id,
          done_ids: ["agent-1"],
          blocked_ids: ["agent-2"],
          failed_ids: ["agent-3"],
          counts: %{
            workflows: summary.workflows,
            done: summary.agents.done,
            blocked: summary.agents.blocked,
            failed: summary.agents.failed,
            external_sessions: summary.external_sessions
          },
          previews: summary.previews,
          acceptance_checklist: [
            "workflow row persisted",
            "three agent rows persisted",
            "one done, one blocked, one failed agent",
            "one external session persisted for crashed worker",
            "prompt artifacts written under runs/<workflow>/<agent>/prompt.md",
            "event rows for workflow, agent, and session lifecycle"
          ]
        }

        ok(data)
      rescue
        e in ArgumentError -> error(e.message)
      end
    else
      {:error, msg} -> error(msg)
    end
  end

  defp run_status(opts) do
    with {:ok, root} <- require_opt(opts, :root) do
      summary = Ledger.status(root)

      data = %{
        counts: %{
          workflows: summary.workflows,
          agents: summary.agents.total,
          done: summary.agents.done,
          blocked: summary.agents.blocked,
          failed: summary.agents.failed,
          packets: summary.packets.total,
          packets_open: summary.packets.open,
          packets_claimed: summary.packets.claimed,
          packets_done: summary.packets.done,
          external_sessions: summary.external_sessions,
          events: summary.events
        },
        previews: summary.previews
      }

      ok(data)
    end
  end

  defp run_runner(opts) do
    with {:ok, kind_str} <- require_opt(opts, :kind),
         {:ok, prompt_path} <- require_opt(opts, :prompt),
         {:ok, kind} <- parse_kind(kind_str) do
      ok(Runner.build(kind, prompt_path))
    end
  end

  defp run_import(opts) do
    with {:ok, root} <- require_opt(opts, :root),
         {:ok, task_list_path} <- require_opt(opts, :task_list) do
      try do
        tasks = TaskSource.read!(task_list_path)
        ids = Ledger.import_packets(root, task_list_path, tasks)

        ok(%{
          imported_ids: ids,
          count: length(ids),
          source_path: task_list_path
        })
      rescue
        e in ArgumentError -> error(e.message)
      end
    else
      {:error, msg} -> error(msg)
    end
  end

  defp run_next(opts) do
    with {:ok, root} <- require_opt(opts, :root) do
      packet = Ledger.next_packet(root)
      ok(%{packet: packet})
    end
  end

  defp run_claim(opts) do
    with {:ok, root} <- require_opt(opts, :root),
         {:ok, packet_id} <- require_opt(opts, :packet),
         {:ok, owner} <- require_opt(opts, :owner) do
      case Ledger.claim_packet(root, packet_id, owner) do
        :ok -> ok(%{packet_id: packet_id, owner: owner, status: "claimed"})
        {:error, reason} -> error(reason)
      end
    end
  end

  defp run_paths(opts) do
    with {:ok, root} <- require_opt(opts, :root),
         {:ok, packet_id} <- require_opt(opts, :packet) do
      case Ledger.packet_paths(root, packet_id) do
        {:ok, info} -> ok(info)
        {:error, reason} -> error(reason)
      end
    end
  end

  defp run_proof_add(opts) do
    with {:ok, root} <- require_opt(opts, :root),
         {:ok, packet_id} <- require_opt(opts, :packet),
         {:ok, path} <- require_opt(opts, :path),
         {:ok, kind} <- require_opt(opts, :kind) do
      case Ledger.add_proof(root, packet_id, kind, path) do
        {:ok, proof} -> ok(proof)
        {:error, reason} -> error(reason)
      end
    end
  end

  defp require_opt(opts, key) do
    case opts[key] do
      nil -> {:error, "missing required --#{String.replace(to_string(key), "_", "-")}"}
      value -> {:ok, value}
    end
  end

  defp parse_kind("dry-run"), do: {:ok, :dry_run}
  defp parse_kind("pi-rpc"), do: {:ok, :pi_rpc}
  defp parse_kind("omp-cli"), do: {:ok, :omp_cli}
  defp parse_kind(other), do: {:error, "unknown runner kind: #{other}"}

  defp ok(data) do
    envelope = %{ok: true, data: data, error: nil}
    output(envelope)
    0
  end

  defp error(message) do
    envelope = %{ok: false, data: nil, error: message}
    output(envelope)
    1
  end

  defp output(envelope) do
    envelope
    |> deep_nil_to_null()
    |> :json.encode()
    |> IO.iodata_to_binary()
    |> IO.puts()
  end

  defp deep_nil_to_null(nil), do: :null
  defp deep_nil_to_null(%{} = map), do: Map.new(map, fn {k, v} -> {k, deep_nil_to_null(v)} end)
  defp deep_nil_to_null(list) when is_list(list), do: Enum.map(list, &deep_nil_to_null/1)
  defp deep_nil_to_null(other), do: other
end
