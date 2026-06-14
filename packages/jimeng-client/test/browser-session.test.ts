import { describe, expect, test } from "bun:test"
import { buildJimengLipSyncVoiceSelectionNeedles } from "../src"

describe("Jimeng browser session helpers", () => {
  test("prefers visible voice label before id fallback", () => {
    expect(buildJimengLipSyncVoiceSelectionNeedles({
      voiceId: "7597003459665072686",
      voiceLabel: "直爽女大",
    })).toEqual(["直爽女大", "7597003459665072686"])
  })

  test("dedupes blank or repeated voice selectors", () => {
    expect(buildJimengLipSyncVoiceSelectionNeedles({
      voiceId: "7597003459665072686",
      voiceLabel: " 7597003459665072686 ",
    })).toEqual(["7597003459665072686"])
  })
})
