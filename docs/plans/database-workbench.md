# Clean-Room Database Workbench Plan

This document defines the plan, architecture, and phase-by-phase implementation strategy for a clean-room Database Workbench client. The workbench is an interoperable database client designed to connect to, query, and manage local or user-permitted databases (SQLite, PostgreSQL, MySQL/MariaDB) within the allowed scope.

---

## 1. Scope and Operating Rules

### 1.1 Allowed Targets
- **Database Engines**: Standard open-source database servers (PostgreSQL, MariaDB, SQLite, DuckDB) running locally, in Docker containers, or on explicitly authorized staging/development servers.
- **Protocols and Drivers**: Standard, publicly documented network wire protocols (PostgreSQL Frontend/Backend protocol, MySQL client/server protocol) and open-source driver libraries (e.g., `pg`, `mysql2`, `better-sqlite3`, or Rust equivalent drivers).
- **Metadata Inspection**: Publicly documented SQL standards and catalog schemas (`information_schema.tables`, `information_schema.columns`, `pg_catalog`, `sqlite_schema`) to query database layouts.

### 1.2 Out of Scope
- **Proprietary Decompilation**: No decompilation, unpacking, or reveng of TablePlus, pgAdmin (proprietary plugins), JetBrains DataGrip, or other commercial database management tools.
- **License/DRM Bypass**: No circumventing of licensing screens, activation limits, trial periods, or serial verification of TablePlus or any other proprietary workbench.
- **Protected Asset Extraction**: No extracting of icons, SVG paths, proprietary stylesheet variables, themes, font files, or local binary extensions from commercial clients.
- **Proprietary Protocol Cloning**: No trying to reverse-engineer private/undocumented cloud sync protocols or proprietary team sharing features of commercial workbench services.

### 1.3 TablePlus Observational UX Boundary
TablePlus may be used strictly as an **observational UX/product reference** for layout paradigms. This means:
- **Allowed**: Observing the spatial organization of the UI (e.g., three-pane layout containing connection list/schema tree on the left, tabbed query editor/view grid in the middle, and detail panel on the right). Referencing standard UX keyboard shortcuts (e.g., Cmd+Enter to execute queries) and naming conventions (e.g., "Connection String", "SSH Tunnel", "Query History").
- **Not Allowed**: Inspecting or copying the internal component hierarchy, proprietary state management models, stylesheet code, or custom drawing algorithms.
- **Clean-Room Alternative**: Build the workbench UI using standard web components, open-source packages (such as Radix UI, Tailwind CSS, or Monaco Editor for SQL autocomplete), and standard React/TypeScript or Rust UI frameworks. The underlying database connection, parsing, and data retrieval layers will be built from scratch using official driver documentation.

---

## 2. Lab Artifacts for Database Workbench

As part of the clean-room process, development of the Database Workbench is guided by the RevEng Lab. All discovery runs on database catalogs and protocol behaviors must be recorded in the following lab artifacts:

1. **`authorization.md`**
   - States target database systems, driver versions, and access scope.
   - Lists local Docker/test database configurations used for profiling catalog query performance.
   - Specifies read-only credentials where applicable.

2. **`target-inventory.json`**
   - Documents the exact versions of PostgreSQL/MySQL/SQLite engines tested.
   - Records metadata driver library package versions (e.g., `@types/pg`, `pg`, `mysql2`) and licenses (MIT, Apache 2.0).

3. **`observations.md`**
   - Logs observed behavior of database catalog queries across different engines and versions (e.g., how SQLite handles `PRAGMA table_info` versus PostgreSQL querying `information_schema.columns`).
   - Documents response latency, data type serialization quirks, and driver-specific connection state transitions.

4. **`clean-room-spec.md`**
   - Formalizes the abstract interface for the database connection wrapper, schema parser, grid renderer, and error handler.
   - Defines a unified JSON representation for table metadata, views, indexes, and execution responses, independent of the underlying database engine.

5. **`fixtures/` and `fixture-manifest.json`**
   - Contains SQL scripts (`schema.sql`, `seed.sql`) to initialize mock tables (with various data types, foreign keys, indexes, and constraints) to verify catalog extraction correctness.
   - Maps the provenance of each seed script to confirm no proprietary database schemas are included.

6. **`implementation-notes.md`**
   - Details how the final client codebase implements connection pooling, SSH tunneling, metadata parsing, and transaction controls based strictly on the clean-room specification.

## 2.1 Control-Plane SQLite Boundary

The repo-wide task metadata ledger is a control-plane concern, not a Database Workbench product package.

- The first ledger implementation should extend the existing Symphony Lite/control-plane SQLite seam instead of creating a second database package here.
- The workbench may later open `data/symphony-lite/**` or `~/.local/share/pi-cockpit/cockpit.sqlite` as ordinary SQLite targets for inspection, using the same clean-room catalog/query APIs as any other user-permitted database.
- Workbench UI state, saved connections, and query history must remain separate from task scheduling state. The workbench is a client/inspector of the ledger, not the authority for packet claims or status transitions.
- Any migration from `TASKS.md` or packet ledgers belongs in the control-plane importer; the workbench should not parse task Markdown or domain packet dashboards itself.

---

## 3. Product Feature Matrix

| Feature | Target Behavior | Source Database APIs / Docs | UX Reference (Observational Only) | Clean-Room Implementation |
| :--- | :--- | :--- | :--- | :--- |
| **Connection Manager** | Secure storage and connection to SQLite, PostgreSQL, and MySQL databases. Supports SSH tunnels. | Node `net`, `ssh2`, `pg`, `mysql2`, SQLite library APIs. | Standard connection detail forms (Host, Port, User, Password). | Standard form fields feeding into standard driver instantiation workflows. |
| **Schema Explorer** | Left sidebar displaying tables, views, materialized views, triggers, and functions grouped by schema. | PostgreSQL `information_schema.tables`, MySQL `information_schema.tables`, SQLite `sqlite_schema`. | Hierarchical sidebar tree navigation with search/filter field. | Tailwind CSS tree structure, matching filtering using standard JS string matching. |
| **Data Grid View** | Fast, paginated data grid showing table rows. Supports editing values and sorting by columns. | SQL `SELECT * FROM table LIMIT 100 OFFSET N`, `UPDATE table SET col = val WHERE id = key`. | Row/column grid layout, auto-expanding cells, inline input fields. | Open-source grid library (e.g., TanStack Table) styled with custom Tailwind utility classes. |
| **Query Editor** | Tabbed SQL query editor with syntax highlighting, auto-completion, and multi-statement execution. | Standard ANSI SQL specifications. | Editor workspace at the top, execution logs and result grid at the bottom. | Monaco Editor or CodeMirror configured with open-source SQL syntax packages. |
| **Schema Inspector** | Detailed view of column definitions, data types, primary/foreign keys, indexes, and constraints. | `information_schema.key_column_usage`, `information_schema.referential_constraints`. | Right sidebar or bottom tab showing structured table schema properties. | Tabbed metadata panels showing lists of keys, indexes, and raw SQL `CREATE TABLE` definitions. |

---

## 4. Prototype Phases

### Phase 1: Architecture & Safe Sandbox Setup
- **Objective**: Establish the development workspace, containerized database instances, and base project structure.
- **Tasks**:
  1. Define the module layout in a new package (e.g., `packages/database-workbench`).
  2. Write a local `docker-compose.yml` defining sandboxed PostgreSQL, MySQL/MariaDB instances with safe throwaway credentials.
  3. Set up an isolated SQLite database test file containing representative mock schemas.
  4. Implement boundary schemas (using Effect Schema or Zod) to validate database connection configuration payloads.
- **Deliverables**: Sandboxed database compose environment, tsconfig, package layout, and basic connection validation schema.

### Phase 2: Protocol Observation & Interface Spec
- **Objective**: Profile database catalog query patterns and document their behaviors under the clean-room model.
- **Tasks**:
  1. Profile how driver packages expose connections, connection pools, and query streams.
  2. Write queries to fetch table lists, column types, keys, and indexes for SQLite, PostgreSQL, and MySQL.
  3. Document differences in data types, dates, timezone handling, and BLOB/binary representation.
  4. Write `clean-room-spec.md` defining the common `DatabaseClient` interface, including `connect()`, `disconnect()`, `getSchema()`, and `executeQuery()`.
- **Deliverables**: `observations.md` mapping engine catalog behaviors and `clean-room-spec.md` defining unified interface types.

### Phase 3: Core Connection & Schema Engine
- **Objective**: Implement the database engine abstractions and catalog parsers.
- **Tasks**:
  1. Implement `PostgresClient`, `MysqlClient`, and `SqliteClient` classes implementing the `DatabaseClient` interface.
  2. Write robust catalog query utilities that query standard `information_schema` views and format them into the unified JSON metadata shape.
  3. Add transaction handling and safe query termination mechanisms (e.g., utilizing cancellation keys in PostgreSQL).
  4. Implement SSH tunneling wrappers using `ssh2` to proxy connection ports locally before driver instantiation.
- **Deliverables**: Core library packages executing catalog extractions and queries with full unit tests using sandboxed databases.

### Phase 4: Clean-Room UI/UX Prototype
- **Objective**: Build the user interface using open components while referring to TablePlus solely for layout workflows.
- **Tasks**:
  1. Build a basic three-pane frame layout (Sidebar Explorer, Main Workspace, Detail Inspector) using standard CSS flexbox/grid.
  2. Integrate Monaco Editor or CodeMirror for custom SQL execution and query history panels.
  3. Implement the data grid using a high-performance rendering library (like Canvas-based grids or virtualized DOM lists) to display raw query results.
  4. Design a schema creation/alteration UI based on standard SQL generation utilities rather than proprietary GUI forms.
- **Deliverables**: Fully operational local web app / electron frontend showcasing the clean-room client layout.

### Phase 5: Interoperability Validation & Security Audit
- **Objective**: Validate correctness across versions, ensure data security, and finalize the prototype bundle.
- **Tasks**:
  1. Run the test database suite across multiple engine versions (e.g., PostgreSQL 12 through 16, MySQL 8.0, SQLite 3.x) to ensure query compatibility.
  2. Run security checks ensuring no SQL injection vulnerability in metadata extraction queries (e.g., parameterized catalog queries).
  3. Validate connection sanitization to prevent connecting to unauthorized internal networks.
  4. Finalize the `validation-report.md` outlining the verification matrix.
- **Deliverables**: Clean validation log, production-ready prototype build steps, and security notes.

---

## 5. Security & Isolation Guidelines

- **Zero Production Data Policy**: The prototype workbench must not be tested against production databases containing real customer, authentication, or financial records. Tests should only utilize the generated mock schemas inside the sandbox.
- **Credentials and Secrets**: Database connection strings, passwords, and private SSH keys must never be hardcoded or checked into repository sources. Connection parameters must be handled through isolated state, environment variables, or local-only configurations.
- **Network Isolation**: When profiling driver network packets or connection handshake timeouts, use isolated Docker bridge networks to prevent external traffic monitoring.
