**@pleometric (Purple Penguin) advocates a comprehensible input (CI)-heavy approach to language acquisition**, heavily inspired by Stephen Krashen's ideas. He emphasizes *acquisition* (subconscious mapping of words to concepts through repeated, understandable exposure) over traditional "learning" (explicit rules, rote memorization, or heavy native-language translation). He argues that many learners fail because they end up "speaking English with Japanese/Chinese words" instead of truly internalizing the target language.

### Core Principles
- **Comprehensible input first**: Focus on understanding messages in the target language without constant translation crutches. Meaning should emerge naturally from context, repetition, and clues (visuals, videos, surrounding words) rather than flashcards that immediately link to your native language.
- **Avoid native-language contamination early**: He criticizes the common Anki setup for logographic languages (e.g., Japanese/Chinese characters → reading → English translation). This creates fast but shallow heuristics. Instead:
  - Stage 1: Learn to *read/parse* the characters/symbols (e.g., 大学生 → だいがくせい).
  - Stage 2: Encounter the word repeatedly in real input (videos, posts, etc.) and infer/map meaning via context. Add pictures/videos to cards if helpful, but minimize or skip English translations.
- **Acquisition vs. learning**: He references Krashen's point that the "critical period" debate is overstated for adults— the mechanisms children use still work for us, but we need massive, comprehensible exposure rather than studying. Language learning content is often "self-help" fluff that sells aspiration instead of focusing on this core mechanism.
- **Immersion and bootstrapping**: Use whatever tools help (dictionaries, LLMs) but shift them into the target language as soon as possible. He started chatting with LLMs in "caveman-like" sentences and progressed to asking for definitions/examples entirely in the target language.

### On Anki and Spaced Repetition (SRS)
He actively uses Anki but customizes it to support CI rather than fight against it:
- He maintains (or maintained) long streaks with HSK vocabulary decks for Chinese.
- He built and shared a custom **HSK-deck generator** on GitHub (https://github.com/Pleometric/HSK-deck). It creates Anki decks for HSK levels 1-7 (new 3.0 standard) with:
  - AI-generated example sentences that only use vocabulary you've already learned + a small set of ~80 basic function words (ensures examples are always comprehensible and progressive—no frustration from unknown words).
  - Native audio (words + sentences via TTS).
  - Tone-colored pinyin.
  - Handling for multiple pronunciations.
  - Clean card design focused on smooth progression.
- He notes that pre-made or generic decks can have issues if they don't follow this constrained, progressive logic. He once lost a 143-day HSK Anki streak dramatically ("hit by a bazooka").
- General stance on SRS: Useful for building initial parsing/reading fluency and vocab recognition, but it must serve acquisition—not replace massive input or turn into word-to-word mapping.

### Specifically for Japanese
- Strongly recommends **comprehensible input through immersion**. He suggested a resource like cijapanese.com for good results in a short time (e.g., ~2 months for elementary communication ability).
- He explicitly criticizes Pimsleur-style audio courses: They keep you repeating rigid phrases like "駅はどこですか" (where is the station?) without building real acquisition.
- Apply the same CI principles as above: Focus on reading kana/kanji first, then let meaning emerge from authentic Japanese input (videos, media, etc.) with contextual clues. He has personal experience with Japanese culture (e.g., origami patterns, mascots, business dealings, friends) that likely informs his preference for immersive, vibe-based engagement.

### Specifically for Chinese (HSK-focused)
- Heavy emphasis on Anki + his custom generator for HSK vocab as a foundation.
- Example workflow when a word's meaning isn't immediately clear from context (e.g., 便宜 in a Mixue video):
  - Gather clues from visuals/repetition (money images, known context that Mixue is cheap).
  - Use a dictionary (recognizing components like 钱 for money).
  - Query an LLM (e.g., Deepseek) *in Chinese* for simple definitions, examples, antonyms (e.g., confirming it means "cheap/not expensive" via 不贵).
  - This builds target-language thinking and accelerates what you can parse.
- Goal: Rarely have English pop into your head when thinking about a word.

### Other Notes from His Posts
- He views early phases of language learning as frustrating but necessary.
- Ditch native-language assistance around ~500 words in, even with bootstrapping.
- Overall, he sees effective language learning as straightforward (massive comprehensible input + smart SRS support) but requiring discipline—the industry complicates it to sell products.

His approach blends Krashen-style acquisition theory with practical tools (custom Anki + AI/LLMs for target-language support) and a strong bias toward immersion over translation-heavy or audio-drill methods. It's particularly tailored for character-based languages like Japanese and Chinese, where parsing symbols and building contextual understanding are key hurdles.

You can find his posts directly on X or check his GitHub repo for the HSK tool if you're learning Chinese. His views appear in threads from around March–May 2026.

---
tweets:
I think it's worth expanding on this. A few people have asked me what to do if you keep encountering a word and you can't really infer its meaning through context alone, or if you're still unsure. 

The core idea about comprehensible input is to let meaning emerge from repeated exposure, but you can adjust where that exposure is gonna come from.

Here is an elementary example: in this video about Mixue, the speaker kept using 便宜 (piányi) when talking about the products. Throughout the video, images of money and a RMB ~ USD conversions kept flashing up. This is a good indication the word might be related to money and price. I knew from previous experience that Mixue is famous for its cheap offerings. This makes the meaning obvious, right?

But because I learned these characters in isolation from HSK lists rather than in context, I'm not sure if this is just "cheap" or something more nuanced like "affordable."

Let's first check a dictionary. The first problem one might encounter is: which of these forms do you care about? Thankfully I know 形 refers to adjectives and I recognize 钱 as being "money".  This confirms but doesn't lock in a definition, because a few of the other characters are still outside my understanding.

LLMs become extremely useful here, because I can chain my very elementary grammar and vocabulary to ask for a simple explanation with examples.

Deepseek gives me the dictionary definition and then confirms the meaning with an antonym: 不贵 "not expensive", i.e. cheap.

"no idea" > "something about money" > "probably cheap" > "confirmed: cheap".

You need to use whatever building blocks you can manage in your target language and construct meaning as it becomes possible. A few weeks ago the dictionary was entirely useless because I didn't know what the "adjective", "verb" and "noun" tags were. Now I can get some more clues as the number of words I know grows.

 When I first started I chatted with deepseek in incoherent caveman-like sentences until I could form these beginner sentences and I can ask for definitions, examples and further explanations entirely in the target language. The end result is that very rarely does the english meaning pops up in my head when thinking about a word, and this accelerates the type of content I can parse.
 quote:
 Ideally you do this in stages. First you learn how to read the characters, and then you map meanings into them as you encounter them in the wild.
 
 The most common spaced repetition card configuration you'll see language learners use for non phonetic systems (for something like Japanese) is: 
 
 Character -> Reading -> Translation
 大学生 -> だいがくせい -> College Student 
 
 I think this has the fundamental problem of primarily mapping your target language to your own language. You're learning to map [word -> word] and not [word -> concept]. This allows you move much more quickly in terms of understanding text, with the downside of giving your brain a quick heuristic instead of true acquisition.
 
 The comprehensible input approach is concerned with understanding the target language without using other languages. At later stages of acquisition you can use your target language to explain itself, e.g. reading a dictionary entry. But at the start, you'll have to use contextual clues. For example, if I point to a dog and say the word for dog in your target language, you can make the educated guess the word means dog. By seeing that word associated with the concept enough times, in different contexts, you'll learn to do a subconscious map the Word <> Meaning.
 
 So how does that change from the above example? You just skip the translation part. You're trying your best to not contaminate your target language with your own.
 
 You learn how to read the word and then you're done. You might add some contextual clues like pictures and videos but right now you're just trying to be able to parse the symbols.
 
 Step 1:
 
 大学生 -> だいがくせい 
 
 Step 2: 
 
 You start encountering the word enough times in input in the wild [see attached pictures] and you start to associate meaning to it through repeated exposure + contextual clues. 
 
 You are trying to bootstrap understanding of the language without other harnesses. As you (slowly) progress through this, you'll find yourself in the strange position of understanding things without "thinking" about them. Repeat this a thousand times and you will have acquired your target language.
 
 What holds a lot of people back when learning languages is that they're not acquiring Japanese, Chinese, French etc they're trying to smash another system in a way that maps to a language they're native in. So a lot of English Speakers who try to learn Japanese are just speaking English with Japanese words.
 
Pleometric
@pleometric
·
Mar 21
for most the barrier for learning a language in not about the process itself but purely psychological. Being able to wade through the discomfort of not being able to express yourself for a long period of time. Thinking you've made good progress only to discover the gap is deeper.
Pleometric
@pleometric
·
Mar 21
This technique is great for when you encounter words like "set". A single word that has something like 464 definitions, but you probably only care about a small set of them (😀). So how do you know which definitions you care about? By encountering them in your daily life and in niche things you care about. 

If you're into tennis "set" will carry a different meaning from if you're a mathematician.
Air Katakana
@airkatakana
·
Mar 21
this is true but there is also no reason to re-learn the concept of "communism". you can just map 共産主義 to communism with no issues
Pleometric
@pleometric
·
Mar 21
of course! But I think that by the time you reach that level of abstraction you'll be pick up the definition entirely in the target language anyway. My entire knowledge of hydraulic engineering exists in a single language, it has no equivalent mapping in any others.

Conversation
Pleometric
@pleometric
·
Jan 7
1 month report on Chinese. I'm halfway through HSK 2 vocabulary and I'm getting ~5 hours of audio input daily. I can fumble my way through bilibili videos. 

I need to double audio hours + new words, but pride always comes before the fall.
0:09 / 0:24
Greegle Mudzone
@greegle_mudzone
·
Jan 8
How hard would you rate it, compared to other languages you've learned?
Pleometric
@pleometric
·
Jan 8
I follow an approach that prioritizes native input without any translation. So as I learn to read the hanzi, I do not translate their meaning, which I must infer through context. Another aspect of this method is that you do not output until you achieve fluent comprehension, meaning I do not even attempt to speak or pronounce the language. With that in mind, I find Chinese grammar to be easier than, say, Japanese. 

An example of how this works was this comment I read. I could understand it completely, except for the word 东方 (dong fang) which I knew how to read but not the meaning.  So the comment says "Do americans also like dongfang project?"

reading more into the thread, I noticed they were talking about 東方 Project aka Touhou, the Japanese bullet hell series. So now I know that dongfang means eastern, without having seen the English definition.

The way this works is I learn how to read new works using spaced repetition via Anki and the rest of my efforts are spent consuming native content made by natives for native, prioritizing audio content.

At no point am I allowed to use dictionaries, unless they are CN <> CN ones.
Image
Greegle Mudzone
@greegle_mudzone
·
Jan 8
This is interesting. Thank you for explaining. For a long time I've wanted to try CN. Not good with language and maybe a bit too old to start, especially while juggling DN and FR. Would like to understand CN culture and mindset from inside.
Pleometric
@pleometric
·
Jan 8
Linguist Stephen Krashen has something called the Input hypothesis or the acquisition–learning hypothesis, which claims learning a language is a separate process from acquiring a language. Acquisition in this frame is a purely subconscious process and is what actually leads to native fluency. It happens by getting the requisite amount of hours of comprehensible input in the target language and that's basically how children acquire language. "Learning" the language here refers to heuristics the brain uses to understand grammar formalization and etc, and Krashen posits that learning interferes with acquisition.  Under this frame, the mechanisms that allow children to learn are still fully functional in adults, even accounting for lower neuroplasticity. 

A great example of how this works can be found in the life J. Marvin Brown and his Automatic Language Growth (ALG) for Thai language learning. You can find his auto biography describing this here: https://bradonomics.com/brown-autobiog
raphy/


and this video goes over the idea as well: https://youtube.com/watch?v=984rkM
bvp-w


Basically, ALG would teach Thai by giving students a year+ worth of comprehensible input in the language. Students were not allowed to attempt to speak Thai, and if they engaged with their teachers they should use English only. The school was successful in generating native level students, and the book also goes over unsuccessful cases, pointing to the learning / acquisition distinction as the culprit.

tl;dr it's totally possible to get fluent at near native levels at older ages, but it takes many hours of input and it requires the discipline to not try and jump ahead in the process. It also requires one language at a time, so your multiple studies approach would likely not work. Speaking from experience, it just causes confusion and bottlenecks both target languages.
ember ❊
@realityarb
it's very clear to me how to do this with a phonetic writing system, but how do you learn the meaning <-> character -> sound representations? i see how to do CI in characters or in sounds, but how do you tend to connect the two? (or does this just work itself out if you do both?)
1:52 PM · Feb 13, 2026
·
3,757
 
Views·Twitter Web App
1 Quote
babel

eric engle
@EricAllenEngle
·
Mar 21
learn what they mean. what they sound like is a lot more work and less important and you'll get that over time eventually some day.
