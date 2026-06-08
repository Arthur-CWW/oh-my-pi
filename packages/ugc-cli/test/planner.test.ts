import { describe, expect, test } from "bun:test"
import { buildProductBrief, createCampaignPlan, createRecipeFromPlan, createViralityReport, validateRecipe } from "../src"

describe("ugc planner", () => {
  test("creates deterministic JSON campaign plans", () => {
    const product = buildProductBrief({
      productName: "Demo App",
      productUrl: "https://example.com",
      productDescription: "A lightweight planning app for overloaded founders.",
    })
    const plan = createCampaignPlan({
      product,
      variants: 3,
      formats: ["talking_head_product_cutaway", "show_app_creator"],
      personas: ["bedroom_creator"],
      hookStyles: ["pain_point"],
    })

    expect(plan.schemaVersion).toBe("ugc.campaign/v1")
    expect(plan.serialization).toBe("json")
    expect(plan.variants).toHaveLength(3)
    expect(plan.variants[0]?.render.aspectRatio).toBe("9:16")
    expect(plan.variants[0]?.compliance.needsAiDisclosure).toBe(true)
  })

  test("emits valid JSON recipe from campaign", () => {
    const product = buildProductBrief({ productName: "Demo Product" })
    const plan = createCampaignPlan({
      product,
      variants: 1,
      formats: ["ugc_tutorial"],
    })
    const recipe = createRecipeFromPlan(plan)

    expect(recipe.schemaVersion).toBe("ugc.recipe/v1")
    expect(validateRecipe(recipe)).toBe(true)
    expect(recipe.graph.map((node) => node.id)).toContain("timeline_specs")
  })

  test("creates local virality report", () => {
    const report = createViralityReport({
      hook: "Stop doing this manually.",
      captions: "Stop doing this manually. Try the faster workflow.",
      product: "Demo App",
    })

    expect(report.schemaVersion).toBe("ugc.virality/v1")
    expect(report.scores.hookStrength).toBeGreaterThan(50)
    expect(report.nextTests.length).toBeGreaterThan(0)
  })
})
