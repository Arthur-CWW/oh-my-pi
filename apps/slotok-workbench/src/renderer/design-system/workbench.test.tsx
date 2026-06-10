import { describe, expect, test } from "vitest"
import * as React from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { Play } from "lucide-react"
import { Button } from "../components/ui/button"
import { Input } from "../components/ui/input"
import { Select } from "../components/ui/select"
import {
  CommandSurface,
  InspectorPanel,
  MetricRow,
  PanelCard,
  PanelHeader,
  ScoreMeter,
  SidebarRow,
  StatusBadge,
  ToolbarCluster,
  WorkbenchCanvas,
  WorkbenchContent,
  WorkbenchMain,
  WorkbenchShell,
  WorkbenchSidebar,
  WorkbenchTopbar,
} from "./workbench"

describe("UGC workbench design system", () => {
  test("renders stable shell, primitive, and composed component variants", () => {
    const html = renderToStaticMarkup(
      <WorkbenchShell>
        <WorkbenchSidebar>
          <SidebarRow active icon={<Play size={12} />} shortcut="ga" count={3}>Persona Atlas</SidebarRow>
        </WorkbenchSidebar>
        <WorkbenchMain>
          <WorkbenchTopbar>
            <ToolbarCluster>
              <Button size="xs" variant="workbench">Board</Button>
              <Button size="xs" variant="ghost">Table</Button>
            </ToolbarCluster>
          </WorkbenchTopbar>
          <WorkbenchContent>
            <WorkbenchCanvas>
              <PanelCard tone="selected">
                <PanelHeader eyebrow="Workspace" title="Exploration Board" actions={<StatusBadge tone="agent">Agent ready</StatusBadge>} />
                <Input value="Korean-beauty fitness lane" readOnly />
                <Select value="dry-run" disabled>
                  <option value="dry-run">Dry run</option>
                </Select>
                <ScoreMeter label="Hook strength" value={82} tone="success" />
              </PanelCard>
              <CommandSurface
                value="Generate 8 warmer hooks"
                onValueChange={() => undefined}
                actions={<Button size="xs" variant="subtle">Targets</Button>}
                runButton={<Button size="icon-sm"><Play size={12} /></Button>}
              />
            </WorkbenchCanvas>
            <InspectorPanel>
              <MetricRow label="Status" value="Local-first" tone="success" />
            </InspectorPanel>
          </WorkbenchContent>
        </WorkbenchMain>
      </WorkbenchShell>,
    )

    expect(html).toContain("Persona Atlas")
    expect(html).toContain("Exploration Board")
    expect(html).toContain("Generate 8 warmer hooks")
    expect(html).toMatchSnapshot()
  })
})
