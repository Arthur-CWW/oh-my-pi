import React from "react";
import { Composition, registerRoot } from "remotion";
import type { CalculateMetadataFunction } from "remotion";
import {
  TiktokRecreate,
  tiktokRecreateSchema,
} from "./compositions/TiktokRecreate";
import type { TiktokRecreateProps } from "./compositions/TiktokRecreate";

export const calculateTiktokRecreateMetadata: CalculateMetadataFunction<
  TiktokRecreateProps
> = ({ props }) => {
  return {
    durationInFrames: Math.max(1, props.durationInFrames),
    fps: props.fps ?? 30,
    width: props.width ?? 1080,
    height: props.height ?? 1920,
  };
};

export const RemotionRoot: React.FC = () => {
  return (
    <Composition
      id="TiktokRecreate"
      component={TiktokRecreate}
      durationInFrames={3480}
      fps={30}
      width={1080}
      height={1920}
      schema={tiktokRecreateSchema}
      calculateMetadata={calculateTiktokRecreateMetadata}
      defaultProps={{
        sourceVideoId: "",
        title: "",
        transcript: "",
        durationInFrames: 3480,
        segments: [],
      }}
    />
  );
};

registerRoot(RemotionRoot);
