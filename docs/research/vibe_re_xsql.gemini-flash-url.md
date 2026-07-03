# Vibe Reversing Across IDA, Ghidra, and Binary Ninja
**Elias Bachaalany** (@eliasbchiny / @allthingsida)
REcon 2026, Montreal

---

## 1. Motivation
* **Problem**: Every reveng tool has its own API (IDAPython/IDC, Java/PyGhidra, C++ SDK/Python API, r2pipe).
    * Humans must re-learn APIs when switching tools.
    * AI agents require tool-specific "glue" to operate effectively.
* **The "MCP" Fallacy**: Reaching for the Model Context Protocol (MCP) with one-tool-per-operation (e.g., `list_functions`, `rename_function`) is inefficient.
    * **Context bloat**: Loading 100+ JSON schemas drains the LLM context budget.
    * **Poor composition**: Questions like "which functions decrypt a string and then call a network API?" are difficult to answer with isolated calls, but trivial with a SQL `JOIN`.
    * **High maintenance**: Each tool requires a unique surface to be built, documented, and synchronized.

---

## 2. libxsql: The Foundation
* **Concept**: A C++ library that turns any tool's internals into **live SQLite virtual tables**.
* **Principles**:
    * **Live**: No exports or intermediate dumps; the table reflects the engine's current state.
    * **No caching**: Caching lasts only for the query lifetime.
* **Interface**: Maps tool internals to SQL.
    * `funcs`, `strings`, `imports`, `xrefs`: All follow a consistent schema.
    * **Writeable**: `UPDATE`, `INSERT`, `DELETE` operations (e.g., renaming a function) land immediately in the tool.
* **Mechanism**: Every column is a lambda mapping data to tool calls (e.g., calling the IDA SDK to get a function name).

---

## 3. The xSQL Family
| Tool | Engine | Implementation |
| :--- | :--- | :--- |
| **idasql** | IDA Pro | CLI + plugin |
| **ghidrasql** | Ghidra | CLI + extension |
| **bnsql** | Binary Ninja | CLI + plugin |
| **r2sql** | radare2 | CLI + plugin |

* **Comparison**: Same bytes, same query, three different engine readings.
* **Benefits**:
    * Consistent triage across engines.
    * Portability of analysis queries.

---

## 4. idasql: A Closer Look
* **Evolution**: From "ask_ida" (2023 agentic harness) to the modern SQL-first surface.
* **Surface**: 30+ tables, named views, and scalar functions.
    * **Tables (Nouns)**: `funcs`, `xrefs`, `types`.
    * **Views (Analysis)**: `callers`, `string_refs`, `ctree_v_indirect_calls`.
    * **Functions (Verbs/Escape Hatch)**: `decompile(ea)`, `parse_decls()`, `save_database()`.
* **Key Capabilities**:
    * **Annotations**: Renaming, retyping, and commenting via `UPDATE` statements.
    * **Type Recovery**: In-place struct/enum editing without rebuilding.
    * **Bitfields**: Automated rendering of flag fields.
    * **Search**: Unified grep across functions, labels, and types.

---

## 5. libghidra & ghidrasql
* **The Problem**: Ghidra is Java-based, unlike IDA/BN (native C++). It cannot be linked into a C++ process.
* **Solution**: `libghidra` – a C++ RPC + offline decompiler bridge.
    * **Live mode**: RPC (protobuf) connection to a running Ghidra host.
    * **Offline mode**: Embedded Sleigh decompiler (no JVM required).
* **Protocol**: Typed protobuf over HTTP.

---

## 6. AI Integration
* **Philosophy**: You don't learn SQL—the agent writes it.
    * **Discovery**: Agents explore via `sqlite_schema`.
    * **Steering**: Skills teach the agent the "house style" for analysis (e.g., `connect`, `disassembly`, `annotations`).
* **Workflow**:
    * Connect to multiple engines simultaneously.
    * Keep multiple binaries open.
    * Cross-reference and diff findings across databases.

---

## 7. Quick Start
* **Deployment**: Install `idasql` CLI/plugin, add to PATH.
* **Modes**:
    * **Headless**: Managed by the agent (e.g., `idasql -s binary.exe --http 8080`).
    * **Assisted**: Shares a live GUI instance via plugin (e.g., `idasql> .http start`).
* **Lifecycle**: Use SQL to persist (`SELECT save_database();`) and terminate (`POST /shutdown`).

---

## 8. Vibe Reversing (Real-World Results)
* **Project Examples**:
    * **PoisonPlug**: 337 functions fully named, 8 plugins extracted.
    * **OceanDrift**: C++20 reconstruction from 32-bit implant.
    * **Handle64**: Kernel driver audit, defeated KASLR.
    * **BYOVD Drivers**: 10+ drivers audited, client libraries created without WDK.
* **Conclusion**: "The binary is a database. Go SELECT * FROM it."

---

*[Image: Diagram showing a SQL database icon in the center connecting to IDA, Ghidra, and Binary Ninja logos.]*