# Pronunciation Guide 🗣️ | Arcads Help Center

- URL: https://intercom.help/arcads/en/articles/9099813-pronunciation-guide
- Final URL: https://intercom.help/arcads/en/articles/9099813-pronunciation-guide
- Status: 200
- Content-Type: text/html; charset=utf-8
- Extracted: 2026-06-03T14:16:29.990936+00:00

---

## Discover techniques to enhance speech pronunciation through script editing in Arcads! ​

### **1. Add pauses** ⏸️

- One trick that yields the best results is a simple dash—or the em dash. You can even add multiple dashes, like this: ---- for longer pauses.
- Commas (,) provide shorter breaks.
- Periods (.) create longer breaks and a downward inflection.
- Quotation marks ("") separate two sentences, creating a longer pause and making future edits easier.
- For longer pauses, you can use `<break time="1.5s" />`, choosing the desired length of the break (min: 0s, max: 3s)

```
Example: "Give me one second to think about it." <break time="1.0s" /> "Yes, that would work."
```

### **2. DON'T mix languages** 🔁

We automatically detect the language you're using, which helps us choose the correct pronunciation for your language. For instance, the letter "R" sounds different in English compared to French.

When you incorporate words from various languages into your script, it can lead to inconsistencies in pronunciation.

### **3. Cut longer scripts into smaller pieces** ✂️

You may notice a decline in quality, increased inconsistencies, and a more monotone voice in longer scripts exceeding 1000 characters, as this often triggers AI fatigue.

If this occurs, consider generating the first part of your script separately, then duplicating it and generating the second part.

If you're satisfied with the actor's delivery in the introduction of your video but not in the call-to-action (CTA) section, feel free to duplicate the script, make slight modifications, or adjust punctuation before generating it again. This approach allows you to obtain a new version without losing the parts you liked. You can then blend the best segments during the editing process.

### **4. Play with your spelling** ⌨️

- **Words**

For example, if you want the word IPA to be pronounced the right way, you need to spell out IPA, or "I" "p" "A".

Also, feel free to write "Stooop" or "No waaay" if you want the actor to add more emphasis to a specific part of a word.

- **Numbers**

Both options below should work:

> 1000

> one thousand

### **5. Voice settings** ⚙️

⚖️ ***Stability:*** This slider controls how consistent the voice sounds and the amount of variation between each generation. Lowering it allows for a wider range of emotions in the voice. However, it's important to note that the original voice also heavily influences this. Setting the slider too low might result in unpredictable performances with excessive randomness and fast speech. Conversely, setting it too high can lead to a flat, emotionless voice.

👁️ ***Similarity:*** The similarity slider determines how closely the AI should mimic the original voice. If the original audio is of poor quality and the similarity slider is set too high, the AI might reproduce unwanted artifacts or background noise from the original recording.

💥 ***Style Exaggeration:*** This new setting amplifies the original speaker's style but may impact stability slightly and increase latency. It's advised to keep this setting at 0 for optimal performance.

💨 ***Pace of Speech (Speed):*** If you find the speech pace of certain actors too slow, you can adjust it to your preference. You can slightly increase or decrease their speech speed, with suggested values between 0.85x and 1.15x.

**6. Spelling vs. phonetics** 🗣️

Another trick is spelling the word phonetically (i.e., spelling it how it sounds rather than how it is actually spelled — for example, typing "enuff" instead of "enough") or using caps where you want the emphasis to be (if you want the emphasis in "enough" to be on the second syllable, type "eNUFF"

This works well if you want to use not generic words - for example the name of your brand.

**7. Other tips:**

- A good way to separate sentence in a script is to use quotes like this:

```
“I would like to talk today about this amazing product I've found”
“I bought it last weekend, and I'm absolutely in love"
"..."
```

---

Related Articles

[How to extend your videos ?](https://intercom.help/arcads/en/articles/13230010-how-to-extend-your-videos)[How to create a talking actor video (no product)?](https://intercom.help/arcads/en/articles/13239650-how-to-create-a-talking-actor-video-no-product)[How to Clone Yourself Into a Talking Actor?](https://intercom.help/arcads/en/articles/13239662-how-to-clone-yourself-into-a-talking-actor)[How to replace an actor from an existing video?](https://intercom.help/arcads/en/articles/13244238-how-to-replace-an-actor-from-an-existing-video)[What is the Workflow feature?](https://intercom.help/arcads/en/articles/14284875-what-is-the-workflow-feature)
