import {
	parseKagiBrowserAnswer,
	parseKagiBrowserSearchEvents,
	searchWithKagi,
} from "../node_modules/@oh-my-pi/pi-coding-agent/src/web/kagi";

const fixtureHtml = `<div class="_0_SRI"><a class="__sri_title_link" href="https://example.com/a"><b>Example</b> A</a><div class="__sri-desc">One &amp; two.</div></div>`;
const fixtureEvents = [{ data: [{ tag: "search", payload: fixtureHtml }, { tag: "top-content-unique", payload: "<b>Answer</b>" }] }];
const parsed = parseKagiBrowserSearchEvents(fixtureEvents);
if (parsed[0]?.snippet !== "One & two." || parseKagiBrowserAnswer(fixtureEvents) !== "Answer") {
	throw new Error("Kagi browser-session parser fixture failed");
}

const query = process.argv.slice(2).join(" ") || "typescript release";
const result = await searchWithKagi(query, { limit: 3 });

console.log(JSON.stringify({
	browserSessionOnly: true,
	query,
	sources: result.sources.length,
	hasAnswer: typeof result.answer === "string",
	firstHost: result.sources[0] ? new URL(result.sources[0].url).hostname : null,
}, null, 2));
