You are analyzing shortform AI/TikTok videos for a creative reverse-engineering archive.
Analyze the provided video keyframes along with the appended tweet text and transcript excerpt.

Identify:
1. Cultural figures, characters, memes, brands, or artworks that this video mashes up or references (e.g., Sonic, Peach, penguin, Leopold Aschenbrenner, orange background vibe, gigachad).
2. Visual techniques (e.g., kinetic typography, clone fields, feedback tunnels, glitch effects, split-screens, hyper-lapse).
3. Style tags (e.g., accelerationist, tech-doomer, surrealist, retro-futuristic, internet-lore).

Return STRICT JSON only, with no markdown codeblocks, following this exact schema:
{
  "references": [
    {
      "name": "Name of the entity, meme, character, or figure",
      "kind": "person" | "character" | "meme" | "brand" | "artwork",
      "confidence": 0.95, // float between 0.0 and 1.0
      "evidence": "Brief description of visual or audio cues in the frames/transcript supporting this reference"
    }
  ],
  "techniques": [
    "Name of visual technique or editing pattern"
  ],
  "style_tags": [
    "General aesthetic or thematic style tag"
  ],
  "one_line": "A single line summary of the video's content, narrative, or aesthetic"
}
