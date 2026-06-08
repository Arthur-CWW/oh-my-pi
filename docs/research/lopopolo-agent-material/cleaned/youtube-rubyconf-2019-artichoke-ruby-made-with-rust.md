# RubyConf 2019 - Building a Ruby: Artichoke is a Ruby Made with Rust by Ryan Lopopolo

**Source:** https://www.youtube.com/watch?v=QMni48MBqFw
**Retrieved:** 2026-06-07
**Type:** RubyConf 2019 talk
**Duration:** 29:19
**Captions:** manual English subtitles via yt-dlp

## Description

RubyConf 2019 - Building a Ruby: Artichoke is a Ruby Made with Rust by Ryan Lopopolo

Artichoke is a new Ruby implementation. Artichoke is written in Rust and aspires to be compatible with MRI Ruby 2.6.3. Artichoke is a platform that allows experimenting with VM implementations while providing a VM-agnostic implementation of Ruby Core and Standard Library. This talk will discuss Artichoke’s history, architecture, goals, and implementation.

#confreaks #rubyconf2019

## Transcript

[00:00:00] (upbeat music)

[00:00:13] - Hi everyone. Welcome to the last day of RubyConf. We made it. Thank you for coming. (audience cheering and clapping) Today I'm here to talk to you about Artichoke which is a new Ruby VM that I've been working on for the last nine months. I'm guessing the first time many of you heard of Artichoke was during the Syntax Error game show on Monday.

[00:00:37] So awesome. Thank you for following up with your excitement. I appreciate it. This deck is available at artichoke.github.io/RubyConf/2019 if you want to tweet or follow along. There are a bunch of interactive WebAssembly demos in the deck which are pretty fun to play with. And you can also create your own demos at artichoke.run.

[00:01:02] Before I get started though, I'd like to thank three people in particular who provided me with a ton of support along the way, you know, getting as far as I have in the implementation and leading up to RubyConf. I want to thank Daniel, Steven, and Waba. Thank you very much and I appreciate all your support.

[00:01:19] (audience clapping) So what is Artichoke? Well Artichoke is a Ruby. It targets Ruby 2.6.3. That includes the core and the standard library. And it runs and targets WebAssembly. This here is a WebAssembly demo, you'll see a bunch of these in the deck, that embeds an iframe of Artichoke.run and can be used to execute Ruby code.

[00:01:52] So let's do that right now. We've got this code that sets up this properties object. That's kind of a wrapper around a hash. We shove some keys into it, generate some JSON, and test with a very nice regex validation that the JSON contains what we expect, and print it out. There's a lot going on here which we'll kinda dive into over the course of the talk.

[00:02:15] But I guess one thing to note is that we have parts of the standard library in here, which is a little unobvious how that happens given that this is WebAssembly and there's no file system. But I think it's important to ask the question now before we dive any further of why would I want to build a Ruby.

[00:02:36] And I'm just gonna play this video here and hopefully explain a little bit to you why that's the case. So I didn't set out to build a Ruby. About 10 months ago, I was trying to put together a Hackathon project and I wanted to build a Rube Goldberg machine like the one you see here in this music video.

[00:02:57] We were trying to build a React code editor that would be populated with some Ruby code. We would then post that Ruby code back to a Rust web server, hopefully evaluate that code to generate some CSS, which we would pipe back to the browser to restyle the code editor. Never quite got that far because along the way, just like the apocryphal game developer who gets more interested in building the game engine, I got more interested in the Ruby bindings themselves and so began a long journey to build a Ruby.

[00:03:33] Along the way I implemented a Rack compatible web server that was capable of running a Sinatra web application. And this sort of user-based drive toward feature completeness is something that has pushed the project forward. In the essay "Worse is Better", the author posits that there's two styles of software development.

[00:03:59] One called the MIT style, or the crown jewel style, is to be very design focused and build the perfect thing that's not done until it's done. When trying to build a Ruby, that seems like the wrong approach to take because there's so much to do. There's so many idiosyncrasies and MRI that getting it right from the outset is next to impossible.

[00:04:21] So instead, Artichoke takes the New Jersey approach which is to build the worst thing that can possibly work and then take use cases like building a Sinatra running server to hone in on the correct implementation and trend toward correctness over time.

[00:04:49] That being said, we are still early days and there is lots to do. I hope you are excited enough by the end of this talk to check out our GitHub. And hopefully take a look at some tickets that you might find interesting contributing to. All of the tickets in the Artichoke set of repositories are tagged with how difficult we think they might be for someone to implement.

[00:05:14] The ones y'all are probably most interested in are the ones that are tagged E-easy, and E-help-wanted. And yeah, I hope you check them out. I will say that Artichoke is written in both Rust and Ruby. So we are looking for a contribution for the folks from both those backgrounds. Additionally, Rust, at least so far, I've found to be pretty approachable.

[00:05:41] This is only my second Rust project and I've been able to crank out, you know, 30,000 lines of code. So it's not so bad. Additionally, we've found that some folks that are more comfortable with Ruby will start implementing parts of core in the standard library in Ruby and then graduate to implementing some of them in Rust that are either easier to do there, or performance critical, or whatever.

[00:06:09] That was a little bit of background. Now I kinda want to go over the high level goals for Artichoke. And we'll dive into a little bit of why those are good goals to have and how we would go about implementing them with some of the tools we have available to us. Our first goal is to build for WebAssembly.

[00:06:24] You've kind of seen this already in the demo that I showed earlier. The next is to execute untrusted code. We'll dive into a little bit in the next couple of slides of what that means and why it's important. And finally we want to be able to package Ruby applications as single binaries for ease of deployment and auditability.

[00:06:47] Little bit about WebAssembly. WebAssembly is a virtual machine runtime that is able to execute code that's compiled from high level languages like Rust and C plus plus. WebAssembly is nice because it's sandboxed by default. One concrete example of this is that out of bounds memory access is trapped instead of causing undefined behavior or potentially crashing your program.

[00:07:14] This is good for some of the other goals we've laid out such as executing untrusted code. Additionally, WebAssembly is multi-platform. It's for more than just browsers, although it can run there as well. There are several WebAssembly runtimes, most notably Node, that allow you to execute WebAssembly code on something like a Linux server.

[00:07:35] And finally this is the big banner hip-hip hooray thing is that it allows us to execute Ruby in the browser. Which we've seen. It's pretty cool. At least I think so. (audience clapping) Thank you. So a little bit about this untrusted code thing. Like what is untrusted code. What types of applications have it?

[00:07:57] And why would we want it? I think of untrusted code as a program that offers code execution as a service. And some examples of programs that do that are things like Mozilla Firefox that executes both WebAssembly and JavaScript in the browser that is potentially from someplace that you might not like.

[00:08:18] Additionally game engines typically expose crippling capabilities 'cause it is easier and more productive to iterate on level design in a scripting language than it is by recompiling C plus plus. Additionally, something like Shopify Scripts allows users of the platform to inject and configure the platform by running code that they supply.

[00:08:39] And even something like Redis has an eval command that will execute user-supplied Lua scripts in the context of the database. It would be nice if we could use Ruby for some of these use cases too. With single binary apps, we're going for dead simple hermetic deployments. What does that mean?

[00:09:01] Well a Ruby installation and app today touches a lot of different parts of the file system. Just a base Ruby install loads a bunch of shared objects and has files from the standard library strewn about on disk in the lib directory, which can make it difficult to bootstrap on your deployment both on Linux and Windows, and makes things like deploying a Docker container a little more tricky than they need to be.

[00:09:28] Additionally, apps themselves typically load Ruby code, gems, config, and assets. And it would be nice if we could bundle these all together into one binary to make it super simple for us to deploy our applications. So to summarize, our goals for the project are to build for WebAssembly, execute untrusted code, and package single-binary applications in a way that's easy to deploy.

[00:09:57] What tools do we have available in order to make this a reality in Artichoke? Well first and maybe most obvious one given the title of this talk is that we can use Rust for front-end profit in order to make our Ruby meet these goals. One easy win we have is that Rust has a native WebAssembly backend.

[00:10:21] Which means that we can write Rust code and very easily compile it to WebAssembly in a format that's consumable by the browser. Building for WebAssembly in Rust is as simple as invoking these two lines of code, which means that it's easy to add to something like a build process to compile your Ruby application for the web.

[00:10:47] It's demo time again. One thing that is pretty powerful about Rust too, and the fact that it has this native WebAssembly compilation built into the tool chain is that there are several parts of the ecosystem that are built for WebAssembly. So here we have a program that includes this gem called Artichoke Web.

[00:11:10] And Artichoke Web binds to a Rust crate or library called standard web, which gives us access to JavaScript APIs in Rust. So now we have a gem that's gonna bind to a Rust library that exposes the location object in JavaScript. So we have this nice chain of dependencies going from Ruby to JavaScript.

[00:11:36] The Artichoke.run playground stores the text of the program in the location hash of the URL that it serves. So we can sort of use these bindings to standard web to create a quine that uses the location hash of this iframe as storage. So if we run this program, it will print out itself.

[00:12:03] Tah-dah. (Ryan laughing) (audience clapping) This is only possible because of not only the Rust ecosystem around WebAssembly, but some infrastructure in Artichoke to expose Rust modules as Ruby gems.

[00:12:30] Another thing that Rust gives us that makes our life a little easier on the single binary application front is that it supports static linking. So when we pull in a crate dependency, we don't end up with a bunch of shared objects that we need to load at runtime. Instead, they all get linked into our application to support a single binary distribution.

[00:12:55] The goal here is to be able to take that single binary and drop it into a from scratch Docker container and have, you know, a full rails installation right there. Additionally on Linux, Rust supports building against muh-sol-lib-see which gives us even more hermeticness and single binary applications with no dependencies on the host system at all.

[00:13:24] That's all great. We got this Rust tool chain that's gonna make our life a little easier when it comes to meeting some of our goals. But that doesn't help us actually build the Ruby. So how do we take these Rust tools and turn them into something that looks like Ruby? For me, the most recognizable part of Ruby is the core.

[00:13:46] Ruby Core consists of a bunch of classes and modules that make up the APIs that you use every day. Things like the ENV object or array, or file, or regex that match data. This is how you go about writing Ruby code. So in order to build a Ruby, we need to build all of these pieces.

[00:14:04] How do we go about doing that? Well, to align with some of the goals of the project, Ruby Core actually consists of the core objects that are backed by multiple implementations of the same interface. These interfaces and what is exposed are configurable at compile time. Let's take a look at what exactly that means.

[00:14:34] So ENV is how you access the system environ in Ruby. It is a little unobvious how ENV works in the context of WebAssembly given that this is not a Unix-based platform and there's really no environment to speak of. But this program right here will run. And it does so using an alternate back end of ENV.

[00:14:56] So there are two implementations of ENV that Artichoke exposes. The first is probably the obvious one. It talks to the system environment and it makes it really easy for you know, to modify your path, or modify your LD preload, or whatever you want. But maybe modifying those things is not what you want if you're executing Ruby in the context of a game engine.

[00:15:20] So the second implementation of ENV is backed by HashMap but has the same API as the normal ENV. So programs that expect it are able to behave in the same way. This is how you build a Ruby that is able to execute an untrusted context by allowing it to turn off and on different features of the API based on compile time flags.

[00:15:54] Another interesting piece you would want when you are building a Ruby that maybe doesn't have access to file descriptors is some notion of capturable IO. In WebAssembly there is no file descriptor one for you to print stuff out to. But still throughout all these demos we've been able to print stuff to the screen.

[00:16:14] And the way that works is by having the interpreter expose multiple different IO strategies that can optionally capture IO into a buffer as it is generated and then be extracted from those interpreter components later on. So here we have some code that I ripped from Star Wars that's going to, you know, issue some warnings and make sure that the X-Wings are ready to attack the Death Star.

[00:16:40] And all of that IO is captured and put on the screen here. Additionally, we can sort of add and remove different parts of IO if we would like in order to improve the security guarantees of the Ruby that we're building. There are some particularly scary parts of IO such as IO dot popen and Kernel open with a pipe.

[00:17:04] We probably don't want access to these things in a WebAssembly environment or in a game engine. But we're able to disable them by turning them off at compile time. The way this is implemented is that these dangerous APIs are an optional feature that is enabled by default. Which means when you're building for a more specialized environment like WebAssembly, you just turn these features off and you don't get access to them.

[00:17:38] Additionally we have this wonderful virtual file system that's embedded in Artichoke that allows us to do fun things like require things from disk even though we don't actually have a disk. So the JSON implementation in Artichoke uses the JSON pure implementation that's present in Ruby.

[00:17:56] And that's just a bunch of Ruby files that are loaded from disk from the lib directory. And during build time, we actually embed these sources in the Artichoke binary and expose them to the interpreter through a virtual file system. This is the same virtual file system that all those Rust extensions get loaded into as well.

[00:18:14] Which means that the rest of the interpreter doesn't have to think about the difference between a Ruby source that's actually on disk versus a Ruby source that is you know, maybe embedded in the binary. Which makes it easier to support the use cases of single binary applications as well.

[00:18:32] So here we're gonna require some JSON and turn it to JSON and print it out. And that's great. We have JSON, yay. Another instance of this sort of multiple backend pattern and allowing us to turn things on and off at compile time is regex. Regex is pretty pervasive. It allows to match against text content and see what we have going on there.

[00:19:00] Artichoke actually has three implementations of regex floating around in it. And one of those is based on Oniguruma, which is the Ruby regex library. And we use that in order to validate patterns to make sure that they are ones that we can actually match against that Ruby supports.

[00:19:26] But most of the time after we do that validation, we delegate to a Rust library that is much faster for patterns that do not have any backtracking in them. This also allows us to turn off Oniguruma at compile time to be rid of a C dependency while building Artichoke. Which for a context like WebAssembly is much more convenient because Rust natively compiles to WebAssembly.

[00:19:50] Whereas C is a little more tricky. So here we have this giant haystack and we're gonna try and find the path to enlightenment. When we run this, the regex implementation does what we expect. Regex and MatchData were two of the first components of Core that were implemented in Artichoke driven by the desire to run Sinatra, yeah.

[00:20:21] So we've got parts of Core now. How can we sort of go one step further and leverage Rust in the ecosystem and some of the design considerations that we've been working with so far to make Ruby faster using some of those tools? All of the benchmarks run on the next few slides were done on an AWS EC2 c5 2xlarge instance.

[00:20:53] So String scan is an API that takes either a string or a regex and finds all of the matches in the body of the string that we're testing. Here we're testing 6.8, seven megabyte Unicode text which looks like this. This is the text of learn x in y minutes. And we're gonna scan for these particular fixed string patterns.

[00:21:28] When we do that, Artichoke is about 25% faster than MRI. The way it is able to do that is that Artichoke uses a vectorized implementation of a two-way substring search algorithm. Sounds very complicated, but it's great that I didn't have to implement any of that because the high quality crate infrastructure that Rust exposes to us.

[00:21:53] I did try and implement it and I failed miserably. So I was happy to delegate to a crate there. If we do the same test over the same corpus but instead use a few regex, we'll also see that Artichoke is a bit faster. And the reason falls back on those three different implementations of regex that we have.

[00:22:18] So when we are scanning with a regex pattern, we, you know, necessarily have to do the regex scanning. There's no backtracking in any of these, so we don't necessarily need to pay for the overhead of a backtracking engine. And additionally, for each match we're required to construct a MatchData object which has a reference to the regex.

[00:22:41] And Artichoke is able to do this in a lazy manner that doesn't actually do any substantial allocation of MatchData objects. So when we combine those things together, we get implementation that is about 50% faster than MRI. Again, relying on the Rust ecosystem to pull in a regex engine that is backed by a deterministic finite automaton.

[00:23:10] Which sounds very complicated and I'm glad I didn't need to implement. Another cool thing that Artichoke has that I'm not sure any other alternative Ruby implementation has is this concept of a sparse array. So if you run just the first two lines of this program in any other Ruby interpreter, you will have a very sad time trying to allocate all of that memory.

[00:23:39] We haven't talked about array much but it has the same concept of multiple back ends that the rest of the core does. So this first line actually creates a aggregate array that contains two subarrays. One is a sparse array of nulls and the other is a specialized array of one element.

[00:24:01] Same with concat. We're adding to this aggregate array a sequence-based array at the front, and adding buffer types to the end. Reverse happens very quickly because even though we have a quadrillion elements in the array, that sparse array doesn't need to actually do any reversals 'cause it's just a bunch of nulls.

[00:24:20] And yeah, when we run this on Artichoke, it takes about seven megabytes of memory. But MRI is like, nope. Some of the upcoming work that we have for Artichoke mostly revolves around the core. Artichoke, in the true New Jersey style, doesn't actually implement its own VM or parser.

[00:24:48] It relies on mRuby for those. So most of the work is involved around pulling parts of Ruby Core out of mRuby to enable work on the VM and parser later on. So things we're looking forward to are a hash with a small back end. Hashes of small numbers of keys and values are quickly implemented as a vector because computers are very good at scanning linear chunks of memory and less good about doing random access.

[00:25:20] Additionally, I need a range implementation and would simultaneously like to implement a specialized array type that is backed by a range. When you call a range from one to 1,000 dot 2a, that doesn't actually need to create an array of all of those elements. Additionally, extending file to actually support the operating system back end as opposed to being trapped in an in-memory file system is something that we need to do.

[00:25:51] So that's everything I have. Again, I hope you're looking forward to checking out Artichoke on GitHub and maybe sending a PR or two. Please check out Artichoke.run and thank you very much. (audience clapping)

[00:26:15] If I could summarize the question it's, how do you think about enabling compilation to WASM versus being a Ruby interpreter that is able to target WASM, okay. So I think for now we are Ruby interpreter that targets WebAssembly. There is a shell of a project in the GitHub called Jasper which we would love contributions to that is intended to bundle a full application into a WebAssembly bundle.

[00:26:48] For now that would mostly involve like concatenating those sources into the virtual file system. But like if you extend that vision out, it could potentially involve static compilation to WebAssembly as well. But I would say that is like very far away into the future. I have heard of it but I have...

[00:27:07] Oh sorry. Have you gotten any usage out of the robinia standard library? I've heard of it. I have not actually looked at it. Most of the core has been, at least the Ruby implementation has been boostrapped with the mRuby core. But because mRuby targets the ISO standard of Ruby as opposed to Ruby two six, it's largely uncompliant with Ruby spec.

[00:27:38] So has required some surgery. How does Artichoke deal with third party gems is the question. So when I was building the rack clone that ran Sinatra, I did this by vendoring the gems into the repo, patching them so that they ran on the particular version of the interpreter that I was using, and then embedding those gem sources into the binary.

[00:28:05] That is not super sustainable and that's why something like Jasper is important for taking the full spread of sources from your Ruby application and bundling them up for you. So in WebAssembly there are no threads. And the mRuby interpreter we are bootstrapped with is not thread safe.

[00:28:27] So the way I do this today is to have a blocking implementation of thread, and mutex, and monitor. Which allows you to simulate thread and have access to the full API, but not actually be concurrent. This is nice because it lets you do things like access thread locals in a way that makes the application run.

[00:28:55] Similar to how we have this shim for ENV even when there's no environment that we can shell out to. Thank you. (audience clapping) (upbeat music)
