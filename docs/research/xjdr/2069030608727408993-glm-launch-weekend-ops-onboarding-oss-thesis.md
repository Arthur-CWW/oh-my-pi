# GLM launch weekend: ops review, abusive 1M-ctx keys, model onboarding walkthrough, and the OSS-token thesis

- Author: xjdr (@_xjdr)
- Date: 2026-06-22 12:11–13:22 UTC (five posts, same morning)
- URLs:
  - https://x.com/_xjdr/status/2069030608727408993 (weekend review)
  - https://x.com/_xjdr/status/2069038936362803544 (model onboarding)
  - https://x.com/_xjdr/status/2069043048328437814 (why OSS models)
  - https://x.com/_xjdr/status/2069044415013015806 (try-again pointer)
  - https://x.com/_xjdr/status/2069048368953999843 (harness makes the difference)
- Retrieved: 2026-07-04 via nitter.tiekoetter.com + api.fxtwitter.com
- Tags: scaling-troubles, ncode, harness, model-onboarding, oss-models, subagents, ops

---

## Weekend ops review (12:11 UTC)

> Review of what we did at Noumena over the weekend:
> - Added first class support for GLM to noumena and ncode which means making sure tool calling, function parsing, app routing, reasoning traces, etc work as well as possible for a model that was not finetuned on the harness.
> - ramping and scaling the clusters for the additional model and load.
> - Most of this weekend was spend hardening capacity and abusive sessions via the api. certain keys were spamming 1m ctx len requests and causing very long TTFT for the rest of the sessions on whichever cluster they were hitting . That has now been addressed and we have split the api endpoint to add glm-5.2 and glm-5.2[1m] to make ttft and regular ncode sessions go back to being lightening fast as of midnight on Sunday
> - Interactions have been so positive with GLM 5.2 that i have changed the default model in ncode from kimi to glm . your fresh builds of ncode should automatically pick up the change but if you still see kimi as your default, you can switch the model selection with the /model slash command and update your settings at CONFIG_HOME (usually ~/.config/noumena/ncode/settings.json)
> - To help alleviate some additional load on the system so we can try to keep it free for y'all for just a little longer, we adding support for DSV4-Flash as the haiku class model . that means, for new builds of ncode, glm is the default opus mode, kimi is the default sonnet model, dsv4-flash is the default kimi model
> - we ramped down kimi capacity because the overwhelming traffic was pointed at the glm endpoint, but i do strill really like kimi in certain situations and will try to maintain access to it . it is honestly the perfect sonnet class model for subagents etc in ncode
> - cleared the some backlog items on the way to ship some additional features this week
> - woke up in the middle of the night to deal with my x account being hacked
>
> Should be another amazing week this week! cant wait

## What model onboarding involves (12:44 UTC)

> What all is involved with onboarding a new model to noumena and ncode? I added GLM support over the weekend so i thought this might be interesting for some of you.
> first, you have to understand the architecture and how to properly serve it . luckily GLM5.2 is close enough to DeepSeek (which i have spent nearly a year working closely with) that this part fit very well into the existing serving platforms. it took a bit of DSA tuning but other than that, more or less was able to just be deployed in my existing dsv3 harness including the FA4 work, etc i have done over the past few months
> so now that it is serving you have to write model specific stream parsers for the chat format, the reasoning logic and the tool call format. writing the parsers are pretty straight forward as the hugging face project usually comes with the .jinja to specify it but understanding how to parse it in a stream and what the typical generation errors look like is a bit more challenging (you cant just look for opening and close brackets as parallel tool calls stream out a few tokens at a time) . when there is an error, typically you would log this as training data and make sure the mode was more robust next time, but as this is an OSS model, and i do my best not to save any customer data on purpose EVER, you need to be more clever. this typically means exposing the poorly formatted data back to the model and saying 'this is bad, dont do this please'.
> now this is just the serving end to get the responses into an openai compatible format, but to add support into ncode, it means exercising every tool call available to the model and common tool call chains to make sure the prompts, tool schema contracts and the ncode side parsing all the model to understand how to use all of the tools at its disposal (and ideally use them well) . luckily GLM was very well trained on ncode shaped tool calls so it didnt take as much work as i had feared. Similarly to the serving side, as i do not store session data for training, in order to make the model behave better, the idea is to give the model context when it screws up tool calls such that it can properly format the call on the next turn.
> there is a ton more required on the model routing, and preview metadata , and supporting multiple models in a single session and kv caching that is less interesting, but that is less than 1/2 the hours spent getting GLM onboarded for everyone!
>
> Hopefully you found that interesting and you continue to use and enjoy GLM 5.2 on noumena with ncode

## Why serve OSS models (13:01 UTC)

> A few people have asked why focus on serving OSS models now (and why not just use claude or gpt)? starting with dsv3 (we really llama 405B) OSS models became good enough bases to post train from but they were not parctiaclly useful themselves for most people / for most things (at least not for me). Starting with kimi k2.5, i was reasonably able to move 20% of my tokens to an OSS model for things that were simple enough / fit well enough into the training dataset, to use any model for (i.e, there was absolutely no difference between using opus and k2.5 for those sessions, and i had regression tests to prove it). over the last 6 months, that number moved from 20% -> 80% with our k2.6 fine tune and now, with the combination of GLM 5.2 and Kimi 2.7 , i can reasonable say that 80% of my total token use can be OSS. however, in order to make that practical, there needs to be first class model support in coding harnesses, and eventually these models should be fine tuned / virtically integrated for the tools and platforms they are expected to operate it . this is how ncode was born originally and as internal tool and how i want to contine to proceed (for the near term). find the best OSS models available, provide first class support for them in ncode and on noumena, iterate and fine tune those models for using ncode and the noumena platform as we find deficiencies and sharp edges, and raise the number of tokens you can meaningfully send to OSS models higher and higher with each iteration eventually making these models and tools your preferred way to interact with AI

## Pointer (13:06 UTC)

> If you tried using ncode / api.noumena.com over the weekend and were seeing errors or found it slower than you would have liked, these are some of the reasons and they should all be addressed now. give it another try!

## Reply to @teortaxesTex (13:22 UTC)

> i think its hard to overstate how much the harness / provider makes a difference when evaluating these models. ~7 months seems reasonable tho (i'd say its closer for coding and further away for things like medical / legal / etc)
