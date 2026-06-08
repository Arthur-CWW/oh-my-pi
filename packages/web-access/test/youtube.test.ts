import { describe, expect, it } from "bun:test"
import { parseYouTubeVtt, renderTranscriptParagraphs, stripCueMarkup } from "../src/youtube"

const SAMPLE_VTT = `WEBVTT
Kind: captions
Language: en

00:00:15.120 --> 00:00:17.269 align:start position:0%
next<00:00:15.360><c> speaker</c><00:00:15.920><c> is</c><00:00:16.240><c> here</c><00:00:16.400><c> to</c><00:00:16.640><c> speak</c><00:00:16.960><c> about</c>

00:00:17.279 --> 00:00:20.070 align:start position:0%
next speaker is here to speak about
harness<00:00:18.000><c> engineering.</c><00:00:19.199><c> How</c><00:00:19.439><c> to</c><00:00:19.680><c> build</c>

00:00:20.080 --> 00:00:22.915 align:start position:0%
harness engineering. How to build
software<00:00:20.800><c> when</c><00:00:21.199><c> humans</c><00:00:21.840><c> steer</c><00:00:22.320><c> and</c><00:00:22.640><c> agents</c>

00:00:22.915 --> 00:00:24.000 align:start position:0%
software when humans steer and agents
execute.

00:00:24.000 --> 00:00:26.000 align:start position:0%
[music]
`

describe("stripCueMarkup", () => {
  it("removes inline timestamps, cue tags, and decodes entities", () => {
    expect(stripCueMarkup("Tom &amp; Jerry<00:00:01.000><c> rule</c>"))
      .toBe("Tom & Jerry rule")
  })
})

describe("parseYouTubeVtt", () => {
  it("deduplicates overlapping YouTube auto-caption cues", () => {
    const cues = parseYouTubeVtt(SAMPLE_VTT)
    expect(cues).toEqual([
      { start: "00:00:15", startSeconds: 15, text: "next speaker is here to speak about" },
      { start: "00:00:17", startSeconds: 17, text: "harness engineering. How to build" },
      { start: "00:00:20", startSeconds: 20, text: "software when humans steer and agents" },
      { start: "00:00:22", startSeconds: 22, text: "execute." },
    ])
  })

  it("renders cleaned timestamped paragraphs", () => {
    const transcript = renderTranscriptParagraphs(parseYouTubeVtt(SAMPLE_VTT))
    expect(transcript).toBe(
      "[00:00:15] next speaker is here to speak about harness engineering. How to build software when humans steer and agents execute.",
    )
  })
})
