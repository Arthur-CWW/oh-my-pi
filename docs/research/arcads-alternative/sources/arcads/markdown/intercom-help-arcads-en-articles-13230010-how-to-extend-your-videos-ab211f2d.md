# How to extend your videos ? | Arcads Help Center

- URL: https://intercom.help/arcads/en/articles/13230010-how-to-extend-your-videos
- Final URL: https://intercom.help/arcads/en/articles/13230010-how-to-extend-your-videos
- Status: 200
- Content-Type: text/html; charset=utf-8
- Extracted: 2026-06-03T14:16:18.564661+00:00
- Description: Make longer videos in just a few steps!

---

#

# **Overview**

All the most performant AI video generation models are aggregated within **Arcads**.

Each model comes with its own strengths and limitations, but they all share one common characteristic:

Every AI video model has a maximum video length.

This article explains:

- The maximum video duration supported by each model on Arcads
- Why these limits exist
- Proven methods to create videos **longer than 30 seconds** despite those constraints

## **Why AI Models Have Video Length Limits?**

AI video models generate content frame by frame using heavy compute resources. To maintain:

- visual consistency
- audio sync
- facial realism
- rendering speed

each model enforces a **maximum clip duration**.

---

## **Video Length Limits by Model (Recap)**

Exact limits may evolve over time — always refer to the model selector inside Arcads for the most up-to-date values.

|  |  |
| --- | --- |
| Model | Max lenght (per clip) |
| Sora 2 pro | 20 sec |
| Veo 3.1 | 8 sec |
| Kling 3.0 | 15 sec |
| Arcads 1.0 | No limit, but best for scripts that go equal or above 1500 characters limit (>= 1min) |
| Audio Driven | No limit, but best for scripts that go equal or less than 600 characters (>= 45sec) |
| Omnihuman 1.5 | No limit, but best for scripts that go equal or less than 400 characters limit (>= 30sec) |

**When to Use Each Model ?**

# User-Generated Content (UGC) Model Selection Criteria

For UGC video creation, consider the following:

- For **stable and natural motion**, the Audio-Driven model is the top choice, especially for longer scripts requiring professional polish.
- For **shorter scripts**, Sora 2 Pro provides excellent results, ensuring a balance between cinematic quality and naturalness.
- Be mindful of the OmniHuman model's tendency for exaggerated movements, which might not suit videos requiring high visual stability.

## **Visual Video Models**

These models are designed to generate **pure visual clips** (motion, scenes, product shots). They work best for short, high-impact sequences and should be combined together for longer videos.

- **Sora 2 Pro** Use for **cinematic scenes**, storytelling shots, or high-quality visuals where realism matters. Best for premium-looking clips up to 12 seconds. Additionally, Sora 2 Pro is optimal for creating natural UGC videos with shorter scripts, delivering visually appealing and concise outputs.
- **Sora 2**  Think of it as Sora 2 Pro's fast little sibling. Great for quick drafts, testing ideas, and everyday clips when you don't need the full cinematic treatment. Lets you iterate fast before going Pro.
- **Veo 3.1** Ideal for **fast-paced hooks** and dynamic motion. Use it when you need attention in the first seconds of an ad or video.
- **Kling 3.0 and 2.6** Best suited for **product visuals and smooth transitions**. A good balance between motion and visual stability.
- Seedance 1.5 Best for human movement and character animation. Use it when your clip involves people dancing, walking, or any expressive body motion. Handles natural movement better than most other models.
- Grok Video Can go up to 15 seconds. Model that can produce longest output so far among the options.

---

## **Face Cam Models**

These models are optimized to generate **talking human avatars** (UGC-style, testimonials, explanations). They rely on script length rather than seconds.

- **Arcads 1.0** Use for **long-form talking head videos**: product explanations, tutorials, structured messaging. Best choice when you need **30–45s+** of continuous speech.
- **Audio Driven** Best for **short, voice-led clips** with a natural speaking rhythm. Ideal for concise messages, intros, or mid-video segments. It is particularly effective for creating stable and professional-looking UGC content due to its ability to eliminate exaggerated movements and unwanted camera motion.
- **Omnihuman 1.5** Designed for **very short UGC-style hooks** and punchlines. Perfect for social ads, openings, or quick reactions However, it may produce exaggerated actor movements and visuals, making it less suitable for videos requiring stable visual effects. For maintaining consistency in actor and voice representation across multiple videos, Arcads provides tools such as reference images for actors and voice settings for seamless transitions between clips.

## **How to extend your videos?**

## **Option 1 : Face cam Models (Arcads 1.0, Audio driven, Omnihuman 1.5) ?**

If your initial video was created using one of the models above, you can easily extend it by generating additional clips.

To do so:

1. Select **the same model**
2. Choose **the same actor**
3. Keep **the same voice**
4. Write a **new script** for the next segment

Each generated clip will maintain **100% actor and voice consistency** with the original video. To maintain voice consistency across multiple videos, open the video preview of a clip that uses the desired voice, check the voice details displayed, and use the identified voice settings for your next video. Similarly, for actor consistency, create an image as a reference for the actor, hover over it, click the three-dot icon, and select "Video" to start creating a video with the chosen actor.

Once all clips are generated, simply combine them using **any third-party video editing tool** outside of Arcads to create a longer, seamless video.

This approach is the recommended way to create videos longer than the model’s per-clip limit while preserving visual and audio continuity. Additionally, saving frequently used voice and actor settings as templates can streamline future projects and ensure consistency.

## **Option 2: Visual Video Models (Sora 2 pro, Veo3.1, Kling 2.6)**

How to extend a video, from **a specific frame ?**

If your initial video was created using one of the **Visual Video Models** (Sora 2 Pro, Veo 3.1, or Kling 2.6), follow these steps:

1. Click on your generated video
2. Select **Take Snapshot**

[![](https://downloads.intercomcdn.com/i/o/t4j1iryr/1901428405/a1ad0433c848c84d863f480f7391/image.png?expires=1780497900&signature=e80a5b7e9ea1383e2c3b2c84ad0970ed544ff84ea5470bf7445c0eeeb5af0e21&req=dSknF818lYVfXPMW1HO4zSPaHlYAkYafeSgeyLtFgjHyimWRt54va3fnCd%2Fw%0AXFo2lweXjEh4s8HbnIM%3D%0A)](https://downloads.intercomcdn.com/i/o/t4j1iryr/1901428405/a1ad0433c848c84d863f480f7391/image.png?expires=1780497900&signature=e80a5b7e9ea1383e2c3b2c84ad0970ed544ff84ea5470bf7445c0eeeb5af0e21&req=dSknF818lYVfXPMW1HO4zSPaHlYAkYafeSgeyLtFgjHyimWRt54va3fnCd%2Fw%0AXFo2lweXjEh4s8HbnIM%3D%0A)

**3.** Choose the frame where you want the next video to start, then click **Pick Frame**.

[![](https://downloads.intercomcdn.com/i/o/t4j1iryr/1901428585/6e958e7a341192cace07e64f3ea7/image.png?expires=1780497900&signature=cc0c89b25f13464c5397a6a6777d2af6331025456ba9807564b936f38eb1022b&req=dSknF818lYRXXPMW1HO4zXumEn0dw3Gzjx2fal27R87HKYsfCvHK9tmdhPWh%0AasAyrzY%2FgVP8u2cuZbk%3D%0A)](https://downloads.intercomcdn.com/i/o/t4j1iryr/1901428585/6e958e7a341192cace07e64f3ea7/image.png?expires=1780497900&signature=cc0c89b25f13464c5397a6a6777d2af6331025456ba9807564b936f38eb1022b&req=dSknF818lYRXXPMW1HO4zXumEn0dw3Gzjx2fal27R87HKYsfCvHK9tmdhPWh%0AasAyrzY%2FgVP8u2cuZbk%3D%0A)

4. The selected frame will be extracted and saved as an image.

[![](https://downloads.intercomcdn.com/i/o/t4j1iryr/1901428750/d1b8ad1506dadacdb96b2836bde7/image.png?expires=1780497900&signature=e3078f5254386cc3acbf488c677308106e856ba619f8a9d8211839098c303db9&req=dSknF818lYZaWfMW1HO4zbwdcj3huX4UFELJexC%2BLBReaJvnxw7r5tlv3vDh%0AT6psoyXzILC4S%2FDrVzw%3D%0A)](https://downloads.intercomcdn.com/i/o/t4j1iryr/1901428750/d1b8ad1506dadacdb96b2836bde7/image.png?expires=1780497900&signature=e3078f5254386cc3acbf488c677308106e856ba619f8a9d8211839098c303db9&req=dSknF818lYZaWfMW1HO4zbwdcj3huX4UFELJexC%2BLBReaJvnxw7r5tlv3vDh%0AT6psoyXzILC4S%2FDrVzw%3D%0A)

5. Click **Transform to Video**.

You can now generate another clip starting from the selected frame. This ensures scene, context, and actor consistency across clips.

[![](https://downloads.intercomcdn.com/i/o/t4j1iryr/1901429013/211c8b525efd7aebb74ecd494638/image.png?expires=1780497900&signature=405f8d06a2b1d0bfaa290ca80fd9a06418de7dde108ea1764c73bd956b1d3b06&req=dSknF818lIFeWvMW1HO4zVOUdT7xQotk4p0M5ig15lc8MW7NJcD8pgIzJ%2FRh%0Awa04248o0s3Stfr74rk%3D%0A)](https://downloads.intercomcdn.com/i/o/t4j1iryr/1901429013/211c8b525efd7aebb74ecd494638/image.png?expires=1780497900&signature=405f8d06a2b1d0bfaa290ca80fd9a06418de7dde108ea1764c73bd956b1d3b06&req=dSknF818lIFeWvMW1HO4zVOUdT7xQotk4p0M5ig15lc8MW7NJcD8pgIzJ%2FRh%0Awa04248o0s3Stfr74rk%3D%0A)

## **Additional Tips**

Since this method uses models such as Veo 3.1, Kling 2.6, and Sora 2 Pro—which do not allow direct voice control—you may experience voice inconsistencies across clips.

In such cases, we recommend using **ElevenLabs** to standardize the voice. You can upload your video to ElevenLabs, select **Voice Changer**, and apply the same voice across the entire video for consistent audio output.

[![](https://downloads.intercomcdn.com/i/o/t4j1iryr/1901429207/0ddecbeb4b8c6bfb42964dc76216/image.png?expires=1780497900&signature=81bb753a0b3082021205819632bd6a79e76fe9a56871a9e21dd278e5b778f3be&req=dSknF818lINfXvMW1HO4zT%2BwjIyeZU6yi3VzjjGQxcrQTvwGiqcJvVSnr%2Bkn%0Axkw758TyQi30%2FTXADy4%3D%0A)](https://downloads.intercomcdn.com/i/o/t4j1iryr/1901429207/0ddecbeb4b8c6bfb42964dc76216/image.png?expires=1780497900&signature=81bb753a0b3082021205819632bd6a79e76fe9a56871a9e21dd278e5b778f3be&req=dSknF818lINfXvMW1HO4zT%2BwjIyeZU6yi3VzjjGQxcrQTvwGiqcJvVSnr%2Bkn%0Axkw758TyQi30%2FTXADy4%3D%0A)

**How to continue a video without selecting a specific frame ?**

To continue a video without picking a specific frame, simply choose the **extend** option and do not select any keyframe. In this case, the system will automatically use the **last moments of the existing video** as context and continue the scene naturally from there.

This approach works best when you want a **smooth, natural continuation** of the same action, setting, and dialogue. The model will preserve visual consistency such as camera angle, lighting, and character behavior, and extend the video forward in time.

1. Select your video, and click “extend Video”

[![](https://downloads.intercomcdn.com/i/o/t4j1iryr/1901429409/d1cd3e369ba9e4d9b5f44d6925a5/image.png?expires=1780497900&signature=8792ff873ec2dc1ae867cec5b17543f0888a2587ab39a03301143a15faf32f94&req=dSknF818lIVfUPMW1HO4zd7Z%2FYF4vre%2BJMSFXgvDlm37fXu8Ae2pZC5cSnTp%0AS%2BuWLL4ch8e%2BiFvuH9U%3D%0A)](https://downloads.intercomcdn.com/i/o/t4j1iryr/1901429409/d1cd3e369ba9e4d9b5f44d6925a5/image.png?expires=1780497900&signature=8792ff873ec2dc1ae867cec5b17543f0888a2587ab39a03301143a15faf32f94&req=dSknF818lIVfUPMW1HO4zd7Z%2FYF4vre%2BJMSFXgvDlm37fXu8Ae2pZC5cSnTp%0AS%2BuWLL4ch8e%2BiFvuH9U%3D%0A)

2.Prompt the next video

[![](https://downloads.intercomcdn.com/i/o/t4j1iryr/1901429538/c75651e72d06e6041e7b8600279b/image.png?expires=1780497900&signature=19ee47a746537dbb63286de394a46a9925129aed6f0092553f69c00cf8451dd2&req=dSknF818lIRcUfMW1HO4zb0LueJQulUnbE%2BhOSHBspM8w%2BJzqxBfTfLe3nrD%0A2ybdpxS2ddb%2BptnurrU%3D%0A)](https://downloads.intercomcdn.com/i/o/t4j1iryr/1901429538/c75651e72d06e6041e7b8600279b/image.png?expires=1780497900&signature=19ee47a746537dbb63286de394a46a9925129aed6f0092553f69c00cf8451dd2&req=dSknF818lIRcUfMW1HO4zb0LueJQulUnbE%2BhOSHBspM8w%2BJzqxBfTfLe3nrD%0A2ybdpxS2ddb%2BptnurrU%3D%0A)

The video will be extended by **7 seconds**

This process can take a **30-second video as input maximum total length of 37 seconds**

---

Related Articles

[How to create a talking actor video (no product)?](https://intercom.help/arcads/en/articles/13239650-how-to-create-a-talking-actor-video-no-product)[How to show a product in a video ?](https://intercom.help/arcads/en/articles/13281882-how-to-show-a-product-in-a-video)[How Are Credits Counted?](https://intercom.help/arcads/en/articles/13725589-how-are-credits-counted)[What is the Workflow feature?](https://intercom.help/arcads/en/articles/14284875-what-is-the-workflow-feature)[Getting Started with Arcads](https://intercom.help/arcads/en/articles/14531683-getting-started-with-arcads)
