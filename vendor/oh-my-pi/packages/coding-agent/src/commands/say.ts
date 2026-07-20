/**
 * Synthesize text with the local TTS engine and play it (or save it with --out).
 *
 * Demonstrates the on-device speech stack end to end: the first run downloads
 * the configured local model, synthesis happens in the TTS worker subprocess,
 * and the resulting WAV is either played through the speakers or written to disk.
 */
import * as os from "node:os";
import * as path from "node:path";
import { getProjectDir, Snowflake } from "@oh-my-pi/pi-utils";
import { Effect, Option } from "effect";
import { Argument, Command, Flag } from "effect/unstable/cli";
import chalk from "chalk";
import { Settings, settings } from "../config/settings";
import { playAudioFile, removeTempFile } from "../tts/player";
import { shutdownTtsClient, ttsClient } from "../tts/tts-client";
import { encodeWav } from "../tts/wav";

export default Command.make(
	"say",
	{
		text: Argument.string("text").pipe(Argument.withDescription("Text to speak")),
		voice: Flag.optional(Flag.string("voice").pipe(Flag.withDescription("Voice id"))),
		model: Flag.optional(Flag.string("model").pipe(Flag.withDescription("Local TTS model key"))),
		out: Flag.optional(
			Flag.string("out").pipe(Flag.withAlias("o"), Flag.withDescription("Write WAV to this path instead of playing")),
		),
	},
	config =>
		Effect.promise(async () => {
			const text = config.text;
			const out = Option.getOrUndefined(config.out);

			await Settings.init({ cwd: getProjectDir() });
			const model = Option.getOrUndefined(config.model) ?? settings.get("tts.localModel");
			const voice = Option.getOrUndefined(config.voice) ?? settings.get("tts.localVoice");

			let exitCode = 0;
			const unsubscribe = ttsClient.onProgress(event => {
				if (event.status === "progress" && typeof event.progress === "number") {
					process.stderr.write(
						`\r${chalk.dim(`downloading ${event.file ?? model}: ${Math.round(event.progress)}%`)}`,
					);
				} else if (event.status === "done" || event.status === "ready") {
					// Clear the progress line once the download finishes.
					process.stderr.write("\r\x1b[K");
				}
			});

			try {
				const audio = await ttsClient.synthesize(model, text, { voice });
				if (!audio) {
					process.stderr.write(
						chalk.red(
							`error: could not synthesize with local TTS model "${model}". ` +
								"Run `omp setup speech` to install it.\n",
						),
					);
					exitCode = 1;
					return;
				}

				const wav = encodeWav(audio.pcm, audio.sampleRate);
				const durationSec = audio.pcm.length / audio.sampleRate;

				if (out) {
					await Bun.write(out, wav);
					process.stdout.write(
						`${chalk.green("saved")} ${out} ` +
							`${chalk.dim(`(${voice}, ${model}, ${durationSec.toFixed(1)}s, ${wav.byteLength} bytes)`)}\n`,
					);
					return;
				}

				const tmp = path.join(os.tmpdir(), `omp-say-${Snowflake.next()}.wav`);
				await Bun.write(tmp, wav);
				try {
					await playAudioFile(tmp);
					process.stdout.write(
						`${chalk.green("spoke")} ${chalk.dim(`(${voice}, ${model}, ${durationSec.toFixed(1)}s)`)}\n`,
					);
				} finally {
					await removeTempFile(tmp);
				}
			} catch (err) {
				process.stderr.write(chalk.red(`error: ${err instanceof Error ? err.message : String(err)}\n`));
				exitCode = 1;
			} finally {
				unsubscribe();
				await shutdownTtsClient();
			}

			if (exitCode !== 0) process.exit(exitCode);
		}),
).pipe(
	Command.withDescription("Synthesize text with the local TTS engine and play it through the speakers"),
	Command.withExamples([
		{ command: 'omp say "hello world"' },
		{ command: 'omp say "hello world" --out /tmp/hello.wav' },
		{ command: 'omp say "bonjour" --voice af_heart --model kokoro' },
	]),
);
