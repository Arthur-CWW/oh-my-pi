import { describe, expect, test } from "bun:test"
import { buildJimengLipSyncVoiceSelectionNeedles, preflightJimengLipSyncImageInBrowser } from "../src"

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

  test("preflight refuses local image upload before connecting to CDP", async () => {
    await expect(preflightJimengLipSyncImageInBrowser({
      cdpUrl: "http://127.0.0.1:1",
      targetUrl: "type=digitalHuman",
      imageUri: "current",
      imagePath: "fixtures/persona.png",
      voiceId: "直爽女大",
      voiceLabel: "直爽女大",
      text: "三秒告诉你为什么这款产品值得试。",
    })).rejects.toThrow("Lip-sync preflight does not upload local images")
  })
})
