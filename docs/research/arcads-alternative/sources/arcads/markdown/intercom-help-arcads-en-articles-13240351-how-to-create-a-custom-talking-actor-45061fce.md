# How to Create a Custom "Talking Actor" ? | Arcads Help Center

- URL: https://intercom.help/arcads/en/articles/13240351-how-to-create-a-custom-talking-actor
- Final URL: https://intercom.help/arcads/en/articles/13240351-how-to-create-a-custom-talking-actor
- Status: 200
- Content-Type: text/html; charset=utf-8
- Extracted: 2026-06-03T14:16:23.537035+00:00
- Description: Create and animate any custom actor in minutes

---

Here are 3 processes, depending on the model you choose:

**Process 1:** For **audio-driven models** and the **OmniHuman model**

**Process 2:** For the **Arcads 1.0 model**
​**Process 3: Clone option from a video**

---

## **PROCESS 1 : Using Audio driven OR Omnihuman models :**

## **Step 1 — Generate the actor image (choose a model)**

[![](https://downloads.intercomcdn.com/i/o/t4j1iryr/1903924927/8ee61f8051f81014d293c3d9c9f6/Screenshot+2025-12-26+at+19_13_59.png?expires=1780497900&signature=64fd00eb688983bc95e4ddef810699cfba02d7143e1143b2fcb0d592aae46572&req=dSknFcB8mYhdXvMW1HO4zfqXmw9fgl2QWdlwkFoko%2Ffhn9WHRQrsSbBtOsTl%0A16zNS1nQ5yoj9ekn7ao%3D%0A)](https://downloads.intercomcdn.com/i/o/t4j1iryr/1903924927/8ee61f8051f81014d293c3d9c9f6/Screenshot+2025-12-26+at+19_13_59.png?expires=1780497900&signature=64fd00eb688983bc95e4ddef810699cfba02d7143e1143b2fcb0d592aae46572&req=dSknFcB8mYhdXvMW1HO4zfqXmw9fgl2QWdlwkFoko%2Ffhn9WHRQrsSbBtOsTl%0A16zNS1nQ5yoj9ekn7ao%3D%0A)

Before you can make a “talking actor,” you need a strong **single portrait image** (clean face, good lighting, sharp details). In the image generator, pick one of these:

## **Nano Banana Pro**

Best when you want **very accurate, “smart” images** (good real-world understanding), strong **editing**, and reliable **text rendering** in images

## **Seedream 4.5**

Best when you need **cinematic aesthetics**, strong **spatial reasoning**, and especially **consistent characters across multiple generations** (great if you’re iterating a character look and want it to stay stable).

## **GPT Image 1.5**

Best when you want **very strong instruction-following** and a **tight prompt-to-image match**, plus a solid edit workflow (generate + transform + edit). It’s a good “default” choice when you want the model to do *exactly* what you described.

**Quick pick**

- Want “most controllable prompt fidelity”? → **GPT Image 1.5**
- Want “best cinematic look + consistency across variations”? → **Seedream 4.5**
- Want “smart editing + strong text/precision + all-around reliability”? → **Nano Banana Pro**

---

## **How to prompt the perfect actor image**

Use a prompt that locks down identity + camera framing.

**Prompt template**

- **Subject:** age range, ethnicity (optional), hairstyle, wardrobe
- **Framing:** “front-facing medium close-up” / “head-and-shoulders”
- **Lighting:** “soft key light, natural skin texture”
- **Background:** “plain studio background” (keeps attention on the face)
- **Style:** “photorealistic” (recommended for talking actors)

**Example prompt**

"Photorealistic head-and-shoulders portrait of a confident presenter, front-facing, neutral background, soft studio lighting, sharp focus on eyes, natural skin texture, 35mm lens look, minimal shadows, high detail"

Result

GPT Image ->

[![](https://downloads.intercomcdn.com/i/o/t4j1iryr/1903933680/791dd4782344dca10932ddc674e7/New+Project+-+Arcads+video+asset+%284%29.png?expires=1780497900&signature=10d7e41b2549d112bec399442472bc81d7f6ed9c8fde9d7bf55393393f505aef&req=dSknFcB9nodXWfMW1HO4zZXgXhG%2F31dJ0lXoWo28P1Jxf5vN8v8I7FPQ%2BNrA%0AKUaU6M3xG9SQd1DmE3w%3D%0A)](https://downloads.intercomcdn.com/i/o/t4j1iryr/1903933680/791dd4782344dca10932ddc674e7/New+Project+-+Arcads+video+asset+%284%29.png?expires=1780497900&signature=10d7e41b2549d112bec399442472bc81d7f6ed9c8fde9d7bf55393393f505aef&req=dSknFcB9nodXWfMW1HO4zZXgXhG%2F31dJ0lXoWo28P1Jxf5vN8v8I7FPQ%2BNrA%0AKUaU6M3xG9SQd1DmE3w%3D%0A)

Nanobanana image ->

[![](https://downloads.intercomcdn.com/i/o/t4j1iryr/1903933237/8db108a1f8e3129ed5e79a41ef91/New+Project+-+Arcads+video+asset+%283%29.png?expires=1780497900&signature=1220759e37c4702e5a6b43d08143f73be3a9505e7ea6a8f70429048941177481&req=dSknFcB9noNcXvMW1HO4zdm5pQKbSrWVWh%2BySYJlWx5oi%2F6sXfxjtMB8TNFC%0AIXJdeVx2Hqs4B2v4Vn0%3D%0A)](https://downloads.intercomcdn.com/i/o/t4j1iryr/1903933237/8db108a1f8e3129ed5e79a41ef91/New+Project+-+Arcads+video+asset+%283%29.png?expires=1780497900&signature=1220759e37c4702e5a6b43d08143f73be3a9505e7ea6a8f70429048941177481&req=dSknFcB9noNcXvMW1HO4zdm5pQKbSrWVWh%2BySYJlWx5oi%2F6sXfxjtMB8TNFC%0AIXJdeVx2Hqs4B2v4Vn0%3D%0A)

Seedream image ->

[![](https://downloads.intercomcdn.com/i/o/t4j1iryr/1903931163/1da1f68346afa78f9394b91b6722/New+Project+-+Arcads+video+asset+%282%29.png?expires=1780497900&signature=cd1ca252a2889a2ac061e659ac523abb90fe27fc6b1cad80e5547ad93428a28a&req=dSknFcB9nIBZWvMW1HO4zYWpAAPNCHTxTw9wOBN6Ama8%2B3FB1xgIWFhquNSk%0ABmh2rlnJankO%2FC5SM4I%3D%0A)](https://downloads.intercomcdn.com/i/o/t4j1iryr/1903931163/1da1f68346afa78f9394b91b6722/New+Project+-+Arcads+video+asset+%282%29.png?expires=1780497900&signature=cd1ca252a2889a2ac061e659ac523abb90fe27fc6b1cad80e5547ad93428a28a&req=dSknFcB9nIBZWvMW1HO4zYWpAAPNCHTxTw9wOBN6Ama8%2B3FB1xgIWFhquNSk%0ABmh2rlnJankO%2FC5SM4I%3D%0A)

Tip: avoid heavy motion blur, extreme angles, hands covering face, or busy backgrounds—clean facial visibility makes the talking result look more believable.

---

## **Step 2 — Turn the image into a talking actor**

1. **Click the image** you just generated.
2. Click **Transform → Talking actor**
3. **Write your script** (what the actor will say)
4. **Pick a voice**
5. Click **Generate**

[![](https://downloads.intercomcdn.com/i/o/t4j1iryr/1903935766/28a898616be36416148f473b5d5a/Screenshot+2025-12-26+at+19_23_42.png?expires=1780497900&signature=b5c5da675dde1fbe7e708d675ca962f906b3d2b7efbfe3624b848f2669712220&req=dSknFcB9mIZZX%2FMW1HO4zYbD6WHURSbJX4VgTkoQ0Gh8ZPc5FQYZ0sqbfP9U%0AJXc33SaTSUyU9p66NH4%3D%0A)](https://downloads.intercomcdn.com/i/o/t4j1iryr/1903935766/28a898616be36416148f473b5d5a/Screenshot+2025-12-26+at+19_23_42.png?expires=1780497900&signature=b5c5da675dde1fbe7e708d675ca962f906b3d2b7efbfe3624b848f2669712220&req=dSknFcB9mIZZX%2FMW1HO4zYbD6WHURSbJX4VgTkoQ0Gh8ZPc5FQYZ0sqbfP9U%0AJXc33SaTSUyU9p66NH4%3D%0A)

Result ->

---

## PROCESS 2 : USING ARCADS 1.0 MODEL

- Click on Talking Actor section, then "Add actors"

[![](https://downloads.intercomcdn.com/i/o/t4j1iryr/1960752744/68e1bd66b5d5616779cc42a9d788/Screenshot+2026-01-19+at+11_37_22.png?expires=1780497900&signature=128ab449ac67a49749e96a3ea5038e361e53dd7498c4420cacb2c2f6719fae37&req=dSkhFs57n4ZbXfMW1HO4zTDeJK3UwBLca6hvPieh6azQfnkP9CgEqi4r6x2m%0AUZmm4B%2BY57PZo6ZBro0%3D%0A)](https://downloads.intercomcdn.com/i/o/t4j1iryr/1960752744/68e1bd66b5d5616779cc42a9d788/Screenshot+2026-01-19+at+11_37_22.png?expires=1780497900&signature=128ab449ac67a49749e96a3ea5038e361e53dd7498c4420cacb2c2f6719fae37&req=dSkhFs57n4ZbXfMW1HO4zTDeJK3UwBLca6hvPieh6azQfnkP9CgEqi4r6x2m%0AUZmm4B%2BY57PZo6ZBro0%3D%0A)

- Then click on Create Actor

[![](https://downloads.intercomcdn.com/i/o/t4j1iryr/1960751546/546eadbc1eb3dbc9104dc34b563b/Screenshot+2026-01-19+at+11_36_53.png?expires=1780497900&signature=500ecaaf99aa9d8ccb4046f0b8031378ca85d66f7bc6f5d7453f7970292470fd&req=dSkhFs57nIRbX%2FMW1HO4zdjYyRBJtUK4HQG1sQGi%2F4ggvDW2PDEOvLIuVJDH%0ApY70IpAw2Jf5XmLsCFI%3D%0A)](https://downloads.intercomcdn.com/i/o/t4j1iryr/1960751546/546eadbc1eb3dbc9104dc34b563b/Screenshot+2026-01-19+at+11_36_53.png?expires=1780497900&signature=500ecaaf99aa9d8ccb4046f0b8031378ca85d66f7bc6f5d7453f7970292470fd&req=dSkhFs57nIRbX%2FMW1HO4zdjYyRBJtUK4HQG1sQGi%2F4ggvDW2PDEOvLIuVJDH%0ApY70IpAw2Jf5XmLsCFI%3D%0A)

- Upload an image that you either generated with Arcads, or use one of yours! You can also prompt it straight from the platform!

[![](https://downloads.intercomcdn.com/i/o/t4j1iryr/2431060141/4bf040af06fa0607565e708a5e41/Screen+Shot+2026-05-28+at+2_22_58+AM.png?expires=1780497900&signature=ae0a7d5c1200e23fa1fef3330134571f0181bff25249bcefa7067a65a0c0083d&req=diQkF8l4nYBbWPMW1HO4zdNfEF0Z%2F9%2FVJG4kwao4auKIgUMY1v2CV1jF9KWI%0Aikdxhrj%2FN0ebNo2tph4%3D%0A)](https://downloads.intercomcdn.com/i/o/t4j1iryr/2431060141/4bf040af06fa0607565e708a5e41/Screen+Shot+2026-05-28+at+2_22_58+AM.png?expires=1780497900&signature=ae0a7d5c1200e23fa1fef3330134571f0181bff25249bcefa7067a65a0c0083d&req=diQkF8l4nYBbWPMW1HO4zdNfEF0Z%2F9%2FVJG4kwao4auKIgUMY1v2CV1jF9KWI%0Aikdxhrj%2FN0ebNo2tph4%3D%0A)

You can add guidance on **how the actor should speak and behave** directly in the prompt.

For example:

*“Make the actor talk with excitement and energy, looking directly at the camera, with a friendly and engaging tone.”*

Once your instructions are ready, simply **click Turn into Talking Actor** to generate the video.

[![](https://downloads.intercomcdn.com/i/o/t4j1iryr/1960755603/f78ac8831f6ca384a578f2ec44c0/Screenshot%2B2026-01-19%2Bat%2B11_39_03.png?expires=1780497900&signature=81df9370e4098dc9c2617d7a012435d8fa8fcbad88a4e3353023e6e61855bbef&req=dSkhFs57mIdfWvMW1HO4zQrn%2Ffv9POPU1A%2FwcVua2B62M0gnRQewzeL7uiyx%0Ajge6jxCUK%2FaolkpEC1A%3D%0A)](https://downloads.intercomcdn.com/i/o/t4j1iryr/1960755603/f78ac8831f6ca384a578f2ec44c0/Screenshot%2B2026-01-19%2Bat%2B11_39_03.png?expires=1780497900&signature=81df9370e4098dc9c2617d7a012435d8fa8fcbad88a4e3353023e6e61855bbef&req=dSkhFs57mIdfWvMW1HO4zQrn%2Ffv9POPU1A%2FwcVua2B62M0gnRQewzeL7uiyx%0Ajge6jxCUK%2FaolkpEC1A%3D%0A)

Then **pick a voice of your choice**, and click **Pick Voice**.

[![](https://downloads.intercomcdn.com/i/o/t4j1iryr/1960759512/2372e89da77bc7542d9f25fda4d8/Screenshot+2026-01-19+at+11_40_32.png?expires=1780497900&signature=ec3baf3138338ea1e5f616443cb8940a3adc4773901d7edeaf477d8b2b4dc942&req=dSkhFs57lIReW%2FMW1HO4zcXuXyJjKEtLS3CZC9a9De2aYk27GbnjPcPJj17V%0AWervne3nsEPA6c8vFy4%3D%0A)](https://downloads.intercomcdn.com/i/o/t4j1iryr/1960759512/2372e89da77bc7542d9f25fda4d8/Screenshot+2026-01-19+at+11_40_32.png?expires=1780497900&signature=ec3baf3138338ea1e5f616443cb8940a3adc4773901d7edeaf477d8b2b4dc942&req=dSkhFs57lIReW%2FMW1HO4zcXuXyJjKEtLS3CZC9a9De2aYk27GbnjPcPJj17V%0AWervne3nsEPA6c8vFy4%3D%0A)

It will then **generate a preview** for you.

[![](https://downloads.intercomcdn.com/i/o/t4j1iryr/1960775009/c4f0d7dde397901e01b161cf1eb2/Screenshot+2026-01-19+at+11_48_17.png?expires=1780497900&signature=a87bd9a3f05fbef2c201fa98810ba7f33cba1c92f5f915d8d3816223349c9f91&req=dSkhFs55mIFfUPMW1HO4zfCeHd%2BND6VOBtAIkhMa4gjbxEb9ieaKjw2ahH4%2F%0ADhE7dpOPKu7KXTO1aL0%3D%0A)](https://downloads.intercomcdn.com/i/o/t4j1iryr/1960775009/c4f0d7dde397901e01b161cf1eb2/Screenshot+2026-01-19+at+11_48_17.png?expires=1780497900&signature=a87bd9a3f05fbef2c201fa98810ba7f33cba1c92f5f915d8d3816223349c9f91&req=dSkhFs55mIFfUPMW1HO4zfCeHd%2BND6VOBtAIkhMa4gjbxEb9ieaKjw2ahH4%2F%0ADhE7dpOPKu7KXTO1aL0%3D%0A)

The actor is now **ready to be used** 🎉 Ensure the actor has completed the training process before it appears in the 'My Actors' folder. It usually takes 2-4 hours.

You can find it under **Talking Actor → My Actors**. Custom actors are private to your workspace and cannot be accessed by other users, ensuring privacy and security. If you encounter issues locating your actor, ensure the training process is complete or check the Custom Actors section of your workspace.

[![](https://downloads.intercomcdn.com/i/o/t4j1iryr/1960776386/e900206aecc44455e0a897751a7d/Screenshot+2026-01-19+at+11_48_56.png?expires=1780497900&signature=4e1caa532951bde8da1530749854c8f50edcf6f46a51242c455215eb4bd817cd&req=dSkhFs55m4JXX%2FMW1HO4zWDPmejEpm4C5jnNtKX0adt6vzJ%2BbGlVB49w2wph%0AMBS8neroK8Nm4aq7Nzc%3D%0A)](https://downloads.intercomcdn.com/i/o/t4j1iryr/1960776386/e900206aecc44455e0a897751a7d/Screenshot+2026-01-19+at+11_48_56.png?expires=1780497900&signature=4e1caa532951bde8da1530749854c8f50edcf6f46a51242c455215eb4bd817cd&req=dSkhFs55m4JXX%2FMW1HO4zWDPmejEpm4C5jnNtKX0adt6vzJ%2BbGlVB49w2wph%0AMBS8neroK8Nm4aq7Nzc%3D%0A)

---

## PROCESS 3: Using CLONE Option

- This allows you to use a video as a reference for creating a custom actor. This is recommended if you want the Custom Actor to move more fluidly and with higher fidelity.

[![](https://downloads.intercomcdn.com/i/o/t4j1iryr/2431075283/4194ad2934400ed4b3380a4e84de/Screen+Shot+2026-05-28+at+2_26_20+AM.png?expires=1780497900&signature=1fd1bf8c72798316ef59048e3e789076fc32df8f0aa6d87f4b78ecd48c2a68c0&req=diQkF8l5mINXWvMW1HO4zW3YPygT%2FNaMtux6sZH4%2BmvAhQ4bvb7MjFkSrpEU%0AHt1TnizXs3%2BrqIhkn9I%3D%0A)](https://downloads.intercomcdn.com/i/o/t4j1iryr/2431075283/4194ad2934400ed4b3380a4e84de/Screen+Shot+2026-05-28+at+2_26_20+AM.png?expires=1780497900&signature=1fd1bf8c72798316ef59048e3e789076fc32df8f0aa6d87f4b78ecd48c2a68c0&req=diQkF8l5mINXWvMW1HO4zW3YPygT%2FNaMtux6sZH4%2BmvAhQ4bvb7MjFkSrpEU%0AHt1TnizXs3%2BrqIhkn9I%3D%0A)

Strict requirements tied to the reference video to achieve best results:
​
Accepted file formats: .mp4 / .mov
Max file size is: 100MB
Minimum video reference length: 2 minutes
​
Speaking:

- Speak continuously throughout the video
- Say anything you like (for example, talk about your company or your product)
- Full, uninterrupted speech is required for accurate voice and lip-sync training

Framing:

- Face must be fully visible at all times
- The mouth must never be covered
- Keep a natural, stable framing
- Avoid abrupt head turns or jerky movements

Expression and Tone:

- Speak naturally
- Use the tone you want your avatar to replicate (professional, casual, enthusiastic, etc.)
  ​

---

Related Articles

[How to create a talking actor video (no product)?](https://intercom.help/arcads/en/articles/13239650-how-to-create-a-talking-actor-video-no-product)[How to Clone Yourself Into a Talking Actor?](https://intercom.help/arcads/en/articles/13239662-how-to-clone-yourself-into-a-talking-actor)[How to show a product in a video ?](https://intercom.help/arcads/en/articles/13281882-how-to-show-a-product-in-a-video)[Understanding Omnihuman 1.5, Audio-Driven, and Arcads 1.0](https://intercom.help/arcads/en/articles/13429441-understanding-omnihuman-1-5-audio-driven-and-arcads-1-0)[How Are Credits Counted?](https://intercom.help/arcads/en/articles/13725589-how-are-credits-counted)
