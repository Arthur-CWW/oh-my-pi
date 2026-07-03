defmodule SymphonyLiteElixir.TaskSource do
  @moduledoc "Parser for local task list files used by the spike."

  @doc """
  Read a task list file and return non-empty, non-comment lines.

  Raises `ArgumentError` if fewer than two tasks are found.
  """
  def read!(path) do
    path
    |> File.read!()
    |> String.split("\n")
    |> Enum.map(&String.trim/1)
    |> Enum.reject(&blank_or_comment?/1)
    |> validate!()
  end

  defp blank_or_comment?(""), do: true
  defp blank_or_comment?(line), do: String.starts_with?(line, "#")

  defp validate!(tasks) when length(tasks) < 2 do
    raise ArgumentError, "task list must contain at least two non-comment tasks"
  end

  defp validate!(tasks), do: tasks
end
